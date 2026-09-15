"use strict";

const GLOBAL_POLICY = Object.freeze({
  limit: 150,
  windowMs: 10_000,
  scope: "socket",
  message: "Trop de requêtes. Réessaie dans quelques secondes."
});

const ADMIN_DEFAULT_POLICY = Object.freeze({
  limit: 60,
  windowMs: 60_000,
  scope: "identity",
  message: "Trop de requêtes administrateur."
});

const EVENT_POLICIES = Object.freeze({
  "admin:claim": Object.freeze({
    limit: 5,
    windowMs: 10 * 60_000,
    scope: "network",
    message: "Trop de tentatives admin. Réessaie plus tard."
  }),

  "admin:status": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Trop de requêtes admin."
  }),

  "chat:send": Object.freeze({
    limit: 15,
    windowMs: 10_000,
    scope: "identity",
    message: "Tu envoies des messages trop rapidement."
  }),

  "chat:report": Object.freeze({
    limit: 4,
    windowMs: 10 * 60_000,
    scope: "identity",
    message: "Trop de signalements rapprochés."
  }),

  "chat:bootstrap": Object.freeze({
    limit: 20,
    windowMs: 60_000,
    scope: "socket",
    message: "Le chat est actualisé trop rapidement."
  }),

  "chat:list": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Le chat est actualisé trop rapidement."
  }),

  "chat:history": Object.freeze({
    limit: 60,
    windowMs: 60_000,
    scope: "socket",
    message: "Cette conversation est actualisée trop rapidement."
  }),

  "friends:send": Object.freeze({
    limit: 8,
    windowMs: 60_000,
    scope: "identity",
    message: "Trop de demandes d’amis envoyées."
  }),

  "friends:bootstrap": Object.freeze({
    limit: 20,
    windowMs: 60_000,
    scope: "socket",
    message: "La liste d’amis est actualisée trop rapidement."
  }),

  "friends:list": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "La liste d’amis est actualisée trop rapidement."
  }),

  "players:report": Object.freeze({
    limit: 4,
    windowMs: 10 * 60_000,
    scope: "identity",
    message: "Trop de signalements rapprochés."
  }),

  "profile:update": Object.freeze({
    limit: 6,
    windowMs: 60_000,
    scope: "identity",
    message: "Le profil est modifié trop rapidement."
  }),

  "room:create": Object.freeze({
    limit: 12,
    windowMs: 60_000,
    scope: "network",
    message: "Trop de salons créés. Réessaie dans un instant."
  }),

  "room:join": Object.freeze({
    limit: 40,
    windowMs: 60_000,
    scope: "network",
    message: "Trop de tentatives pour rejoindre un salon."
  }),

  "room:reconnect": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Trop de reconnexions."
  }),

  "lobby:startCountdown": Object.freeze({
    limit: 6,
    windowMs: 30_000,
    scope: "socket",
    message: "Le lancement est demandé trop rapidement."
  }),

  "wallet:init": Object.freeze({
    limit: 20,
    windowMs: 60_000,
    scope: "socket",
    message: "Initialisation du portefeuille trop fréquente."
  }),

  "economy:get": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Actualisation de l’économie trop fréquente."
  }),

  "economy:rewardedAdDev": Object.freeze({
    limit: 6,
    windowMs: 60_000,
    scope: "identity",
    message: "Récompense publicitaire demandée trop rapidement."
  }),

  "progression:get": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Actualisation de la progression trop fréquente."
  })
});

const NON_ADMIN_PAYLOAD_LIMIT = 64 * 1024;
const ADMIN_PAYLOAD_LIMIT = 750 * 1024;
const MAX_BUCKET_AGE = 12 * 60_000;

function safeText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function walletToken(value) {
  const token = safeText(value, 64);
  return /^[a-f0-9]{48}$/i.test(token) ? token.toLowerCase() : "";
}

function clientNetworkKey(socket) {
  const direct = safeText(
    socket?.handshake?.address ||
    socket?.conn?.remoteAddress ||
    "",
    80
  );

  const forwarded = safeText(
    String(socket?.handshake?.headers?.["x-forwarded-for"] || "")
      .split(",")[0],
    80
  );

  return [direct, forwarded].filter(Boolean).join("|") ||
    safeText(socket?.id, 80) ||
    "unknown";
}

function knownSocketToken(socket) {
  return walletToken(
    socket?.data?.walletToken ||
    socket?.data?.ptitWalletToken ||
    socket?.data?.ptitChatWalletToken ||
    ""
  );
}

function identityKey(socket, payload) {
  return (
    walletToken(payload?.walletToken) ||
    knownSocketToken(socket) ||
    safeText(socket?.id, 80) ||
    clientNetworkKey(socket)
  );
}

function scopeKey(socket, payload, scope) {
  if (scope === "network") return `network:${clientNetworkKey(socket)}`;
  if (scope === "identity") return `identity:${identityKey(socket, payload)}`;
  return `socket:${safeText(socket?.id, 80) || clientNetworkKey(socket)}`;
}

function payloadBytes(payload) {
  if (payload == null) return 0;

  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function packetCallback(packet) {
  const candidate = packet?.[packet.length - 1];
  return typeof candidate === "function" ? candidate : null;
}

function rateLimitResponse(policy, retryAfterMs) {
  return {
    ok: false,
    rateLimited: true,
    error: policy?.message || GLOBAL_POLICY.message,
    retryAfterMs: Math.max(1, Math.ceil(Number(retryAfterMs) || 1))
  };
}

function createRateLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();

  function consume(key, policy) {
    const current = now();
    const limit = Math.max(1, Math.floor(Number(policy?.limit) || 1));
    const windowMs = Math.max(1000, Math.floor(Number(policy?.windowMs) || 1000));

    let bucket = buckets.get(key);

    if (!bucket || current - bucket.startedAt >= windowMs) {
      bucket = {
        startedAt: current,
        lastSeenAt: current,
        count: 0
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    bucket.lastSeenAt = current;

    const allowed = bucket.count <= limit;
    const retryAfterMs = allowed
      ? 0
      : Math.max(1, windowMs - (current - bucket.startedAt));

    return {
      allowed,
      count: bucket.count,
      limit,
      retryAfterMs
    };
  }

  function prune() {
    const current = now();

    for (const [key, bucket] of buckets) {
      if (current - bucket.lastSeenAt > MAX_BUCKET_AGE) {
        buckets.delete(key);
      }
    }
  }

  return {
    consume,
    prune,
    size: () => buckets.size
  };
}

function installSocketSecurity(io, options = {}) {
  if (!io?.use) {
    throw new TypeError("Socket.IO requis");
  }

  const limiter = options.limiter || createRateLimiter();
  const policies = options.policies || EVENT_POLICIES;
  const globalPolicy = options.globalPolicy || GLOBAL_POLICY;

  io.use((socket, nextConnection) => {
    socket.use((packet, dispatch) => {
      const eventName = safeText(packet?.[0], 100);
      const payload =
        packet?.[1] &&
        typeof packet[1] === "object" &&
        !Array.isArray(packet[1])
          ? packet[1]
          : {};

      const callback = packetCallback(packet);

      if (!eventName) {
        callback?.({
          ok: false,
          error: "Requête invalide."
        });
        return;
      }

      // Une connexion déjà liée à un portefeuille ne peut pas changer
      // silencieusement d'identité en envoyant un autre walletToken.
      const boundToken = knownSocketToken(socket);
      const suppliedToken = walletToken(payload.walletToken);

      if (boundToken && suppliedToken && boundToken !== suppliedToken) {
        callback?.({
          ok: false,
          error: "Session invalide."
        });
        return;
      }

      const maxPayload =
        eventName.startsWith("admin:")
          ? ADMIN_PAYLOAD_LIMIT
          : NON_ADMIN_PAYLOAD_LIMIT;

      if (payloadBytes(payload) > maxPayload) {
        callback?.({
          ok: false,
          error: "Requête trop volumineuse."
        });
        return;
      }

      const globalKey =
        `${scopeKey(socket, payload, globalPolicy.scope)}:__global__`;

      const globalResult =
        limiter.consume(globalKey, globalPolicy);

      if (!globalResult.allowed) {
        callback?.(
          rateLimitResponse(
            globalPolicy,
            globalResult.retryAfterMs
          )
        );
        return;
      }

      const policy =
        policies[eventName] ||
        (eventName.startsWith("admin:") ? ADMIN_DEFAULT_POLICY : null);

      if (policy) {
        const key =
          `${scopeKey(socket, payload, policy.scope)}:${eventName}`;

        const result =
          limiter.consume(key, policy);

        if (!result.allowed) {
          callback?.(
            rateLimitResponse(
              policy,
              result.retryAfterMs
            )
          );
          return;
        }
      }

      dispatch();
    });

    nextConnection();
  });

  const pruneTimer = setInterval(
    () => limiter.prune(),
    60_000
  );
  pruneTimer.unref?.();

  return {
    limiter,
    stop() {
      clearInterval(pruneTimer);
    }
  };
}

module.exports = {
  GLOBAL_POLICY,
  ADMIN_DEFAULT_POLICY,
  EVENT_POLICIES,
  NON_ADMIN_PAYLOAD_LIMIT,
  ADMIN_PAYLOAD_LIMIT,
  walletToken,
  clientNetworkKey,
  knownSocketToken,
  identityKey,
  scopeKey,
  payloadBytes,
  createRateLimiter,
  installSocketSecurity
};
