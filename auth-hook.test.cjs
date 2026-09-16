"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const installAccountAuth = require("./auth-hook.js");

function fakeIo() {
  return {
    handlers: {},
    on(event, handler) { this.handlers[event] = handler; }
  };
}

function fakeSocket() {
  return {
    data: {},
    handlers: {},
    on(event, handler) { this.handlers[event] = handler; }
  };
}

function invoke(socket, event, payload) {
  return new Promise(resolve => socket.handlers[event](payload, resolve));
}

test("auth-hook branche inscription, connexion, reprise et déconnexion", async () => {
  const calls = [];
  const service = {
    register: async payload => { calls.push(["register", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48) } }; },
    login: async payload => { calls.push(["login", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48) } }; },
    resume: async payload => { calls.push(["resume", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48) } }; },
    logout: async payload => { calls.push(["logout", payload]); return { ok:true }; }
  };

  const io = fakeIo();
  installAccountAuth(io, { service });
  const socket = fakeSocket();
  io.handlers.connection(socket);

  assert.equal((await invoke(socket, "auth:register", { email:"a@b.fr" })).ok, true);
  assert.equal((await invoke(socket, "auth:login", { email:"a@b.fr" })).ok, true);
  assert.equal((await invoke(socket, "auth:resume", { sessionToken:"x" })).ok, true);
  assert.equal((await invoke(socket, "auth:logout", { sessionToken:"x" })).ok, true);
  assert.deepEqual(calls.map(item => item[0]), ["register", "login", "resume", "logout"]);
});
