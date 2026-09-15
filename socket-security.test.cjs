"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EVENT_POLICIES,
  NON_ADMIN_PAYLOAD_LIMIT,
  createRateLimiter,
  installSocketSecurity
} = require("./socket-security.js");

function fakeIo() {
  return {
    connectionMiddleware: null,
    use(fn) {
      this.connectionMiddleware = fn;
    }
  };
}

function fakeSocket({
  id = "socket-1",
  address = "10.0.0.1",
  forwarded = "203.0.113.10"
} = {}) {
  return {
    id,
    data: {},
    handshake: {
      address,
      headers: {
        "x-forwarded-for": forwarded
      }
    },
    packetMiddleware: null,
    use(fn) {
      this.packetMiddleware = fn;
    }
  };
}

function connect(io, socket) {
  let connected = false;
  io.connectionMiddleware(socket, () => {
    connected = true;
  });
  assert.equal(connected, true);
  assert.equal(typeof socket.packetMiddleware, "function");
}

function send(socket, event, payload = {}, callback = null) {
  let dispatched = false;
  let response = null;

  const packet = [event, payload];

  if (callback !== false) {
    packet.push(value => {
      response = value;
    });
  }

  socket.packetMiddleware(packet, () => {
    dispatched = true;
  });

  return {
    dispatched,
    response
  };
}

test("admin:claim est limité après 5 tentatives", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const security = installSocketSecurity(io);
  connect(io, socket);

  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      send(socket, "admin:claim", {
        walletToken: "a".repeat(48),
        code: "mauvais"
      }).dispatched,
      true
    );
  }

  const blocked = send(socket, "admin:claim", {
    walletToken: "a".repeat(48),
    code: "encore"
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.rateLimited, true);

  security.stop();
});

test("chat:send protège contre le spam rapide", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const security = installSocketSecurity(io);
  connect(io, socket);

  const limit = EVENT_POLICIES["chat:send"].limit;

  for (let index = 0; index < limit; index += 1) {
    assert.equal(
      send(socket, "chat:send", {
        walletToken: "b".repeat(48),
        friendId: "ami",
        content: "bonjour"
      }).dispatched,
      true
    );
  }

  const blocked = send(socket, "chat:send", {
    walletToken: "b".repeat(48),
    friendId: "ami",
    content: "spam"
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.rateLimited, true);

  security.stop();
});

test("une connexion déjà liée ne peut pas changer de walletToken", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  socket.data.walletToken = "c".repeat(48);

  const security = installSocketSecurity(io);
  connect(io, socket);

  const blocked = send(socket, "economy:get", {
    walletToken: "d".repeat(48)
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.error, "Session invalide.");

  const allowed = send(socket, "economy:get", {
    walletToken: "c".repeat(48)
  });

  assert.equal(allowed.dispatched, true);

  security.stop();
});

test("les payloads non-admin trop volumineux sont rejetés", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const security = installSocketSecurity(io);
  connect(io, socket);

  const blocked = send(socket, "chat:send", {
    walletToken: "e".repeat(48),
    content: "x".repeat(NON_ADMIN_PAYLOAD_LIMIT + 2048)
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.error, "Requête trop volumineuse.");

  security.stop();
});

test("le rate limiter remet le compteur à zéro après la fenêtre", () => {
  let clock = 1_000;
  const limiter = createRateLimiter({
    now: () => clock
  });

  const policy = {
    limit: 2,
    windowMs: 1_000
  };

  assert.equal(limiter.consume("x", policy).allowed, true);
  assert.equal(limiter.consume("x", policy).allowed, true);
  assert.equal(limiter.consume("x", policy).allowed, false);

  clock += 1_001;

  assert.equal(limiter.consume("x", policy).allowed, true);
});
