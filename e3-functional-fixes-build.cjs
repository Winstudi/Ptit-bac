"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;

function filePath(name) {
  return path.join(root, name);
}

function read(name) {
  return fs.readFileSync(filePath(name), "utf8");
}

function write(name, source) {
  fs.writeFileSync(filePath(name), source, "utf8");
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) {
    return { source, changed: false };
  }

  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(`E3: motif introuvable pour ${label}.`);
  }

  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`E3: motif ambigu pour ${label}.`);
  }

  return {
    source:
      source.slice(0, first) +
      after +
      source.slice(first + before.length),
    changed: true
  };
}

function replaceRegexOnce(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) {
    return { source, changed: false };
  }

  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `E3: ${label} doit correspondre exactement une fois (${matches.length}).`
    );
  }

  return {
    source: source.replace(pattern, replacement),
    changed: true
  };
}

function parseJs(name) {
  new Function(read(name));
}

function patchProgression() {
  const name = "progression-service.js";
  let source = read(name);

  const before =
    '    const validAnswers = Math.max(0, Math.floor(Number(player.score) || 0));';

  const after = [
    '    // E3: l’XP récompense les réponses réellement validées,',
    '    // indépendamment du score/classement de la partie.',
    '    const validAnswers = Math.max(',
    '      0,',
    '      Math.floor(Number(player.validAnswerCount ?? player.score) || 0)',
    '    );'
  ].join("\n");

  const result = replaceOnce(
    source,
    before,
    after,
    "progression-service.js / réponses valides"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

function patchServer() {
  const name = "server.js";
  let source = read(name);
  let changed = false;

  {
    const before = [
      '      p.score = 0;',
      '      p.submitted = false;'
    ].join("\n");

    const after = [
      '      p.score = 0;',
      '      // E3: compteur séparé utilisé par la progression XP.',
      '      p.validAnswerCount = 0;',
      '      p.submitted = false;'
    ].join("\n");

    const result = replaceOnce(
      source,
      before,
      after,
      "server.js / remise à zéro des réponses valides"
    );

    source = result.source;
    changed ||= result.changed;
  }

  {
    const before = [
      '    player.score += gained;',
      '    scores[player.id] = gained;'
    ].join("\n");

    const after = [
      '    player.score += gained;',
      '    // E3: conserver séparément le nombre de réponses validées.',
      '    player.validAnswerCount =',
      '      Math.max(0, Number(player.validAnswerCount) || 0) + gained;',
      '    scores[player.id] = gained;'
    ].join("\n");

    const result = replaceOnce(
      source,
      before,
      after,
      "server.js / accumulation des réponses valides"
    );

    source = result.source;
    changed ||= result.changed;
  }

  {
    const before = [
      '    setTimeout(() => {',
      '      const current = rooms.get(room.code);',
      '      if (current) current.ptbCountdownUntil = 0;',
      '    }, durationMs + 1200);'
    ].join("\n");

    const after = [
      '    // E3: le serveur termine lui-même le compte à rebours.',
      '    // Le lancement ne dépend donc plus du timer du téléphone de l’hôte.',
      '    const countdownRoomCode = room.code;',
      '    const countdownPlayerId = player.id;',
      '',
      '    setTimeout(() => {',
      '      const current = rooms.get(countdownRoomCode);',
      '      if (!current) return;',
      '',
      '      current.ptbCountdownUntil = 0;',
      '      if (current.phase !== "lobby") return;',
      '',
      '      const currentHost = getPlayer(current, countdownPlayerId);',
      '      if (!currentHost?.isHost || currentHost.socketId !== socket.id) {',
      '        io.to(countdownRoomCode).emit(',
      '          "toast",',
      '          "Lancement annulé : l’hôte a quitté le salon."',
      '        );',
      '        return;',
      '      }',
      '',
      '      startGame(socket, {',
      '        code: countdownRoomCode,',
      '        playerId: countdownPlayerId',
      '      }).catch(err => {',
      '        console.error("Lancement après compte à rebours:", err.message);',
      '        socket.emit("toast", "Le lancement a échoué. Réessaie.");',
      '      });',
      '    }, durationMs);'
    ].join("\n");

    const result = replaceOnce(
      source,
      before,
      after,
      "server.js / countdown autoritaire serveur"
    );

    source = result.source;
    changed ||= result.changed;
  }

  if (changed) write(name, source);
  return changed;
}

function patchLobbyPolish() {
  const name = "lobby-polish-v1.js";
  let source = read(name);
  let changed = false;

  const blockPattern =
    /\n    const user = currentPlayer\(\);\n    const amHost =[\s\S]*?\n    }\n\n    \/\/ Filet de sécurité si l'état serveur tarde à arriver\./g;

  const replacement =
    "\n    // E3: le serveur lance maintenant la partie à la fin du countdown.\n" +
    "    // Le client ne fait plus qu’afficher l’animation.\n\n" +
    "    // Filet de sécurité si l'état serveur tarde à arriver.";

  const result = replaceRegexOnce(
    source,
    blockPattern,
    replacement,
    "le serveur lance maintenant la partie",
    "lobby-polish-v1.js / lancement client"
  );

  source = result.source;
  changed ||= result.changed;

  for (const line of [
    '  let countdownFinishTimer = null;\n',
    '    clearTimeout(countdownFinishTimer);\n',
    '    countdownFinishTimer = null;\n'
  ]) {
    if (source.includes(line)) {
      source = source.replace(line, "");
      changed = true;
    }
  }

  if (changed) write(name, source);
  return changed;
}

function patchHome() {
  const name = "home-screen-v1.js";
  let source = read(name);

  const pattern =
    /\n    const betaTrigger = document\.getElementById\("homeBrandLogo"\);[\s\S]*?\n    }\);\n(?=  }\n\n  function lockIcon)/g;

  const replacement = [
    '',
    '    // E3: ancien déclencheur admin caché supprimé.',
    '    // L’administration passe uniquement par le menu admin authentifié.',
    ''
  ].join("\n");

  const result = replaceRegexOnce(
    source,
    pattern,
    replacement,
    "ancien déclencheur admin caché supprimé",
    "home-screen-v1.js / 7 taps admin"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

function validate() {
  for (const name of [
    "progression-service.js",
    "server.js",
    "lobby-polish-v1.js",
    "home-screen-v1.js"
  ]) {
    parseJs(name);
  }

  const progression = read("progression-service.js");
  const server = read("server.js");
  const lobby = read("lobby-polish-v1.js");
  const home = read("home-screen-v1.js");

  if (!progression.includes("player.validAnswerCount ?? player.score")) {
    throw new Error("E3: progression XP non corrigée.");
  }

  if (!server.includes("p.validAnswerCount = 0;")) {
    throw new Error("E3: compteur validAnswerCount non réinitialisé.");
  }

  if (!server.includes("Math.max(0, Number(player.validAnswerCount) || 0) + gained")) {
    throw new Error("E3: compteur validAnswerCount non alimenté.");
  }

  if (!server.includes("const countdownRoomCode = room.code;")) {
    throw new Error("E3: countdown serveur non installé.");
  }

  if (lobby.includes('socket.emit("game:start"')) {
    throw new Error("E3: le client lobby lance encore game:start.");
  }

  if (home.includes("adminTapCount") || home.includes("betaTrigger")) {
    throw new Error("E3: ancien déclencheur admin encore présent.");
  }
}

function main() {
  const required = [
    "progression-service.js",
    "server.js",
    "lobby-polish-v1.js",
    "home-screen-v1.js"
  ];

  for (const name of required) {
    if (!fs.existsSync(filePath(name))) {
      throw new Error(`E3: fichier manquant: ${name}`);
    }
  }

  const changed = [];
  if (patchProgression()) changed.push("progression-service.js");
  if (patchServer()) changed.push("server.js");
  if (patchLobbyPolish()) changed.push("lobby-polish-v1.js");
  if (patchHome()) changed.push("home-screen-v1.js");

  validate();

  console.log(
    `[E3] Correctifs fonctionnels validés. ${changed.length} fichier(s) modifié(s).`
  );
  console.log("[E3] XP réponses valides : OK");
  console.log("[E3] Countdown autoritaire serveur : OK");
  console.log("[E3] Ancien accès admin 7 taps : supprimé");
}

try {
  main();
} catch (error) {
  console.error("[E3] ERREUR:", error?.stack || error?.message || error);
  process.exitCode = 1;
}
