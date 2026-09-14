"use strict";

/*
 * P'tit Bac — synchronisation réseau des cadres cosmétiques.
 *
 * Ce module est préchargé par Node avant server.js. Il n'altère pas la
 * logique des salons : il mémorise seulement le cadre envoyé par chaque
 * client et l'ajoute aux états publics des joueurs.
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

/*
 * Partie rapide V5 :
 * - les relances lettre/catégories sont autorisées aussi en mode quick ;
 * - leur coût réel serveur passe de 10 à 20 pièces.
 *
 * server.js reste intact dans le dépôt : ce préchargeur transforme uniquement
 * ces trois règles au moment où Node compile server.js.
 */
const nativeJsLoader = Module._extensions[".js"];
const targetServer = path.resolve(__dirname, "server.js");

Module._extensions[".js"] = function ptbV5ServerRules(module, filename) {
  if (path.resolve(filename) !== targetServer) {
    return nativeJsLoader(module, filename);
  }

  let source = fs.readFileSync(filename, "utf8");

  source = source
    .replace(
      /const LETTER_REROLL_COST\s*=\s*\d+\s*;/,
      "const LETTER_REROLL_COST = 20;"
    )
    .replace(
      /const CATEGORY_REROLL_COST\s*=\s*\d+\s*;/,
      "const CATEGORY_REROLL_COST = 20;"
    )
    .replace(
      /\s*if \(room\?\.mode === ["']quick["']\) return socket\.emit\(["']toast["'], ["']Les relances sont désactivées en partie rapide\.["']\);/g,
      ""
    );

  return module._compile(source, filename);
};

const { Server } = require("socket.io");

const ALLOWED_FRAMES = new Set([
  "",
  "frame_purple_flame",
  "frame_ice",
  "frame_gold",
  "frame_nature"
]);

const frameBySocketId = new Map();
const playerBySocketId = new Map();
const frameByPlayerId = new Map();

function normalizeFrameId(value) {
  const id = String(value || "").trim();
  return ALLOWED_FRAMES.has(id) ? id : "";
}

function rememberSocketFrame(socketId, frameId) {
  const id = String(socketId || "");
  if (!id) return "";

  const clean = normalizeFrameId(frameId);
  frameBySocketId.set(id, clean);
  return clean;
}

function bindPlayerToSocket(socketId, playerId, frameId) {
  const sid = String(socketId || "");
  const pid = String(playerId || "").trim();
  if (!sid || !pid) return;

  const clean = rememberSocketFrame(sid, frameId);
  playerBySocketId.set(sid, pid);
  frameByPlayerId.set(pid, clean);
}

function enrichState(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.players)) {
    return state;
  }

  return {
    ...state,
    players: state.players.map(player => {
      if (!player || typeof player !== "object") return player;

      const playerId = String(player.id || "");
      const hasSyncedFrame = frameByPlayerId.has(playerId);
      const frameId = hasSyncedFrame
        ? frameByPlayerId.get(playerId)
        : normalizeFrameId(player.frameId);

      return {
        ...player,
        frameId: frameId || ""
      };
    })
  };
}

function enrichResponse(response) {
  if (!response || typeof response !== "object" || !response.state) {
    return response;
  }

  return {
    ...response,
    state: enrichState(response.state)
  };
}

function installSocketPatch(socket) {
  if (!socket || socket.__ptbFrameSyncServerV1) return;

  Object.defineProperty(socket, "__ptbFrameSyncServerV1", {
    value: true,
    enumerable: false,
    configurable: false
  });

  const nativeOn = socket.on.bind(socket);
  const nativeEmit = socket.emit.bind(socket);

  const incomingProfileEvents = new Set([
    "room:create",
    "room:join",
    "room:reconnect",
    "quick:join"
  ]);

  socket.on = function frameAwareOn(event, listener) {
    if (!incomingProfileEvents.has(String(event)) || typeof listener !== "function") {
      return nativeOn(event, listener);
    }

    return nativeOn(event, function frameAwareIncoming(...args) {
      const payload =
        args[0] && typeof args[0] === "object" && !Array.isArray(args[0])
          ? args[0]
          : {};

      const requestedFrame = rememberSocketFrame(socket.id, payload.frameId);
      const callbackIndex = args.findIndex((arg, index) => index > 0 && typeof arg === "function");

      if (callbackIndex >= 0) {
        const clientCallback = args[callbackIndex];

        args[callbackIndex] = function frameAwareCallback(response, ...rest) {
          if (response?.ok) {
            const playerId =
              String(response.playerId || "").trim() ||
              (String(event) === "room:reconnect"
                ? String(payload.playerId || "").trim()
                : "");

            if (playerId) {
              bindPlayerToSocket(socket.id, playerId, requestedFrame);
            }
          }

          return clientCallback(enrichResponse(response), ...rest);
        };
      }

      return listener.apply(this, args);
    });
  };

  socket.emit = function frameAwareEmit(event, ...args) {
    const eventName = String(event);

    if (eventName === "quick:matched") {
      const result = args[0];

      if (result?.playerId) {
        bindPlayerToSocket(
          socket.id,
          result.playerId,
          frameBySocketId.get(socket.id) || ""
        );
      }

      if (result && typeof result === "object") {
        args[0] = enrichResponse(result);
      }
    } else if (eventName === "room:state" && args[0]) {
      args[0] = enrichState(args[0]);
    }

    return nativeEmit(event, ...args);
  };

  // Mise à jour volontaire du cosmétique équipé. Le joueur ne peut mettre à
  // jour que l'identité déjà liée à sa propre socket.
  nativeOn("cosmetics:sync", (payload = {}, cb = () => {}) => {
    const playerId = playerBySocketId.get(socket.id) || "";
    const frameId = rememberSocketFrame(socket.id, payload.frameId);

    if (playerId) {
      frameByPlayerId.set(playerId, frameId);
    }

    if (typeof cb === "function") {
      cb({ ok: true, playerId, frameId });
    }
  });

  nativeOn("disconnect", () => {
    frameBySocketId.delete(socket.id);
    playerBySocketId.delete(socket.id);
    // frameByPlayerId est volontairement conservé : un joueur hors ligne doit
    // garder son cadre visible jusqu'à sa reconnexion ou la fin du processus.
  });
}

// Chaque gestionnaire de connexion déclaré par server.js / quick-match.js
// reçoit une socket déjà équipée du patch ci-dessus.
const nativeServerOn = Server.prototype.on;
Server.prototype.on = function frameAwareServerOn(event, listener) {
  if (String(event) !== "connection" || typeof listener !== "function") {
    return nativeServerOn.call(this, event, listener);
  }

  return nativeServerOn.call(this, event, function frameAwareConnection(socket, ...rest) {
    installSocketPatch(socket);
    return listener.call(this, socket, ...rest);
  });
};

// server.js envoie les états de salon avec io.to(socketId).emit(...). On
// enrichit donc aussi les BroadcastOperator créés par Server#to.
const nativeServerTo = Server.prototype.to;
Server.prototype.to = function frameAwareTo(room) {
  const operator = nativeServerTo.call(this, room);

  if (!operator || operator.__ptbFrameSyncOperatorV1) {
    return operator;
  }

  const nativeOperatorEmit = operator.emit.bind(operator);

  Object.defineProperty(operator, "__ptbFrameSyncOperatorV1", {
    value: true,
    enumerable: false,
    configurable: false
  });

  operator.emit = function frameAwareOperatorEmit(event, ...args) {
    if (String(event) === "room:state" && args[0]) {
      args[0] = enrichState(args[0]);
    }

    return nativeOperatorEmit(event, ...args);
  };

  return operator;
};

module.exports = {
  normalizeFrameId,
  enrichState
};
