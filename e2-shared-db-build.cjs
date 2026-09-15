"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function write(name, source) {
  fs.writeFileSync(path.join(root, name), source, "utf8");
}

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`E2: motif introuvable pour ${label}.`);
  }
  return next;
}

function alreadyShared(source) {
  return (
    source.includes('require("./db.js")') &&
    !source.includes('new Pool(') &&
    !source.includes('require("pg")')
  );
}

function patchStandardHook(name) {
  let source = read(name);
  if (alreadyShared(source)) return false;

  source = replaceOnce(
    source,
    'const { Pool } = require("pg");',
    'const { getPool } = require("./db.js");',
    `${name} import PostgreSQL`
  );

  source = replaceOnce(
    source,
    /const pool = DATABASE_URL\s*\?\s*new Pool\(\{[\s\S]*?\n\s*\}\)\s*:\s*null;/,
    "const pool = getPool();",
    `${name} création Pool`
  );

  write(name, source);
  return true;
}

function patchFriendCode() {
  const name = "friend-code-v2-hook.js";
  let source = read(name);
  if (alreadyShared(source)) return false;

  source = replaceOnce(
    source,
    'const { Pool } = require("pg");',
    'const { getPool } = require("./db.js");',
    `${name} import PostgreSQL`
  );

  source = replaceOnce(
    source,
    /\n  const pool = new Pool\(\{[\s\S]*?\n  \}\);/,
    "\n  const pool = getPool();",
    `${name} création Pool`
  );

  write(name, source);
  return true;
}

function patchServer() {
  const name = "server.js";
  let source = read(name);

  if (
    source.includes('const { getPool: getDbPool } = require("./db.js");') &&
    !source.includes("new Pool(") &&
    !source.includes('const { Pool } = require("pg");')
  ) {
    return false;
  }

  source = replaceOnce(
    source,
    'const { Pool } = require("pg");',
    'const { getPool: getDbPool } = require("./db.js");',
    "server.js import PostgreSQL"
  );

  source = replaceOnce(
    source,
    /pgPool = new Pool\(\{[\s\S]*?\n\s*\}\);/,
    [
      "pgPool = getDbPool();",
      '    if (!pgPool) throw new Error("DATABASE_URL manquant");'
    ].join("\n    "),
    "server.js création Pool"
  );

  /*
   * Avant E2, le fallback portefeuille fermait uniquement le Pool propre au
   * serveur. Désormais le Pool appartient aussi aux amis/chat/admin : il ne
   * faut surtout plus le fermer lors d'un simple fallback wallet.
   */
  source = source.replace(
    /\n\s*try \{ await pgPool\?\.end\(\); \} catch \{\}/,
    ""
  );

  write(name, source);
  return true;
}

function assertShared(name) {
  const source = read(name);

  if (!source.includes('require("./db.js")')) {
    throw new Error(`E2: ${name} n'utilise pas db.js.`);
  }

  if (source.includes('require("pg")') || source.includes("new Pool(")) {
    throw new Error(`E2: ${name} crée encore son propre Pool.`);
  }

  // Vérification syntaxique sans exécuter le module.
  new Function(source);
}

function main() {
  const required = [
    "server.js",
    "friends-hook.js",
    "chat-hook.js",
    "admin-hook.js",
    "player-report-hook.js",
    "friend-code-v2-hook.js",
    "db.js"
  ];

  for (const name of required) {
    if (!fs.existsSync(path.join(root, name))) {
      throw new Error(`E2: fichier manquant: ${name}`);
    }
  }

  const changed = [];

  if (patchServer()) changed.push("server.js");
  if (patchStandardHook("friends-hook.js")) changed.push("friends-hook.js");
  if (patchStandardHook("chat-hook.js")) changed.push("chat-hook.js");
  if (patchStandardHook("admin-hook.js")) changed.push("admin-hook.js");
  if (patchStandardHook("player-report-hook.js")) changed.push("player-report-hook.js");
  if (patchFriendCode()) changed.push("friend-code-v2-hook.js");

  for (const name of required.slice(0, 6)) {
    assertShared(name);
  }

  const dbSource = read("db.js");
  const constructors = (dbSource.match(/\bnew Pool\(/g) || []).length;
  if (constructors !== 1) {
    throw new Error(`E2: db.js doit contenir exactement un constructeur Pool (${constructors}).`);
  }

  console.log(
    `[E2] Pool PostgreSQL partagé actif. ${changed.length} fichier(s) adapté(s).`
  );
  console.log(
    "[E2] server + amis + chat + admin + signalements + codes amis utilisent db.js."
  );
}

try {
  main();
} catch (error) {
  console.error("[E2] ERREUR:", error?.stack || error?.message || error);
  process.exitCode = 1;
}
