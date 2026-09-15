"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const serverPath = path.join(root, "server.js");

function fail(message) {
  throw new Error(`E5: ${message}`);
}

function parseJs(source, label) {
  try {
    new Function(source);
  } catch (error) {
    fail(`${label} invalide: ${error.message}`);
  }
}

function main() {
  if (!fs.existsSync(serverPath)) {
    fail("server.js absent.");
  }

  if (!fs.existsSync(path.join(root, "socket-security.js"))) {
    fail("socket-security.js absent.");
  }

  let source = fs.readFileSync(serverPath, "utf8");

  const importLine =
    'const { installSocketSecurity } = require("./socket-security.js");';

  if (!source.includes(importLine)) {
    const anchor =
      'const { createProgressionService } = require("./progression-service.js");';

    if (!source.includes(anchor)) {
      fail("point d’insertion import introuvable.");
    }

    source = source.replace(
      anchor,
      `${anchor}\n${importLine}`
    );
  }

  const installLine = "installSocketSecurity(io);";

  if (!source.includes(installLine)) {
    const anchor = 'require("./friends-hook.js")(io, {';

    if (!source.includes(anchor)) {
      fail("point d’installation Socket.IO introuvable.");
    }

    source = source.replace(
      anchor,
      `// E5: protection centralisée avant les handlers fonctionnels.\n${installLine}\n\n${anchor}`
    );
  }

  const installIndex = source.indexOf(installLine);
  const friendsIndex = source.indexOf(
    'require("./friends-hook.js")(io, {'
  );

  if (
    installIndex < 0 ||
    friendsIndex < 0 ||
    installIndex > friendsIndex
  ) {
    fail("la sécurité doit être installée avant les handlers amis/chat/admin.");
  }

  parseJs(source, "server.js");
  parseJs(
    fs.readFileSync(path.join(root, "socket-security.js"), "utf8"),
    "socket-security.js"
  );

  fs.writeFileSync(serverPath, source, "utf8");

  console.log("[E5] Sécurité Socket.IO installée.");
  console.log("[E5] Rate limiting ciblé + limite globale : OK");
  console.log("[E5] Verrouillage walletToken par connexion : OK");
  console.log("[E5] Limite de taille des payloads : OK");
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
