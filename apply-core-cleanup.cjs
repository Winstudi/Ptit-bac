"use strict";

/*
 * P'tit Bac — Core cleanup V1
 *
 * Usage:
 *   1) Place ce fichier à la racine du dépôt P'tit-bac.
 *   2) Lance: node apply-core-cleanup.cjs
 *
 * Le script:
 *   - modifie uniquement server.js, frame-sync-server.js et package.json;
 *   - vérifie que les motifs attendus existent avant toute écriture;
 *   - lance node --check + les tests quick-match;
 *   - restaure automatiquement les fichiers d'origine si une vérification échoue.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = path.resolve(process.argv[2] || __dirname);
const serverPath = path.join(root, "server.js");
const framePath = path.join(root, "frame-sync-server.js");
const packagePath = path.join(root, "package.json");
const quickMatchPath = path.join(root, "quick-match.js");
const quickTestPath = path.join(root, "quick-match.test.cjs");

const EXPECTED_SERVER_BLOB = "fc341702dcdf39abed851861abf357d5c1e0943c";

function fail(message) {
  throw new Error(message);
}

function readRequired(file) {
  if (!fs.existsSync(file)) fail(`Fichier introuvable: ${path.basename(file)}`);
  return fs.readFileSync(file, "utf8");
}

function gitBlobSha(text) {
  const body = Buffer.from(text, "utf8");
  const head = Buffer.from(`blob ${body.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([head, body])).digest("hex");
}

function countText(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let at = 0;
  while (true) {
    at = source.indexOf(needle, at);
    if (at < 0) return count;
    count += 1;
    at += needle.length;
  }
}

function replaceExact(source, label, from, to, expectedCount = 1) {
  const count = countText(source, from);
  if (count !== expectedCount) {
    fail(`${label}: attendu ${expectedCount} occurrence(s), trouvé ${count}. Aucun fichier n'a été modifié.`);
  }
  return source.split(from).join(to);
}

function replaceRegex(source, label, regex, replacement, expectedCount = 1) {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const probe = new RegExp(regex.source, flags);
  const matches = [...source.matchAll(probe)];
  if (matches.length !== expectedCount) {
    fail(`${label}: attendu ${expectedCount} occurrence(s), trouvé ${matches.length}. Aucun fichier n'a été modifié.`);
  }
  return source.replace(new RegExp(regex.source, flags), replacement);
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${label} a échoué${details ? ":\n" + details : "."}`);
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (output) console.log(output);
}

function assertContains(source, needle, label) {
  if (!source.includes(needle)) fail(`Vérification finale échouée: ${label}`);
}

function assertNotContains(source, needle, label) {
  if (source.includes(needle)) fail(`Vérification finale échouée: ${label}`);
}

const originals = {
  server: readRequired(serverPath),
  frame: readRequired(framePath),
  pkg: readRequired(packagePath)
};

if (!fs.existsSync(quickMatchPath)) fail("quick-match.js est introuvable.");
if (!fs.existsSync(quickTestPath)) fail("quick-match.test.cjs est introuvable.");

const currentBlob = gitBlobSha(originals.server);
if (currentBlob !== EXPECTED_SERVER_BLOB) {
  console.warn(
    `[attention] server.js n'a plus exactement le SHA audité (${EXPECTED_SERVER_BLOB}).\n` +
    `SHA actuel: ${currentBlob}\n` +
    "Le script continue uniquement si TOUS les motifs structurels attendus correspondent exactement."
  );
}

let server = originals.server;

// 1) Le serveur importe désormais un helper pur pour valider les cadres.
server = replaceExact(
  server,
  "Import normalizeFrameId",
  'const { Pool } = require("pg");\n\nconst app = express();',
  'const { Pool } = require("pg");\nconst { normalizeFrameId } = require("./frame-sync-server.js");\n\nconst app = express();'
);

// 2) /health ne doit être déclaré qu'une seule fois.
server = replaceExact(
  server,
  "Route /health dupliquée",
  'app.get("/health", (req, res) => res.json({ ok: true, version: BUILD_VERSION }));\n',
  ""
);

// 3) Les règles réelles sont inscrites dans server.js, plus dans un préchargeur.
server = replaceExact(
  server,
  "Coût relance lettre",
  "const LETTER_REROLL_COST = 10;",
  "const LETTER_REROLL_COST = 20;"
);
server = replaceExact(
  server,
  "Coût relance catégories",
  "const CATEGORY_REROLL_COST = 10;",
  "const CATEGORY_REROLL_COST = 20;"
);

// 4) frameId fait partie du modèle public des joueurs.
server = replaceExact(
  server,
  "frameId dans publicPlayer",
  '    avatar: p.avatar || "",\n    friendCode: p.friendCode || ""',
  '    avatar: p.avatar || "",\n    frameId: normalizeFrameId(p.frameId),\n    friendCode: p.friendCode || ""'
);

// 5) Création / arrivée : le cadre est stocké directement sur le joueur.
server = replaceExact(
  server,
  "Signature createGameRoom",
  'function createGameRoom(socket, { name, rounds = 1, duration = 60, categoryCount = 6, categoryDifficulty = "medium", avatar, friendCode, walletToken }, cb = () => {}, mode = "private") {',
  'function createGameRoom(socket, { name, rounds = 1, duration = 60, categoryCount = 6, categoryDifficulty = "medium", avatar, frameId, friendCode, walletToken }, cb = () => {}, mode = "private") {'
);

server = replaceExact(
  server,
  "frameId dans les joueurs humains",
  '      avatar: (typeof avatar === "string" && avatar.startsWith("data:image/") && avatar.includes(";base64,") && avatar.length <= 450000) ? avatar : Array.from(String(avatar || "")).slice(0, 8).join(""),\n      friendCode:',
  '      avatar: (typeof avatar === "string" && avatar.startsWith("data:image/") && avatar.includes(";base64,") && avatar.length <= 450000) ? avatar : Array.from(String(avatar || "")).slice(0, 8).join(""),\n      frameId: normalizeFrameId(frameId),\n      friendCode:',
  2
);

server = replaceExact(
  server,
  "Signature joinGameRoom",
  'function joinGameRoom(socket, { code, name, avatar, friendCode, walletToken }, cb = () => {}, matchmaking = false) {',
  'function joinGameRoom(socket, { code, name, avatar, frameId, friendCode, walletToken }, cb = () => {}, matchmaking = false) {'
);

// 6) La partie rapide est réellement en difficulté moyenne dans le code source.
server = replaceExact(
  server,
  "Difficulté quick",
  'if (!peers.length) createGameRoom(entry.socket, {...entry.profile, rounds:1, duration:60, categoryCount:6, categoryDifficulty:"beginner"}, reply, "quick");',
  'if (!peers.length) createGameRoom(entry.socket, {...entry.profile, rounds:1, duration:60, categoryCount:6, categoryDifficulty:"medium"}, reply, "quick");'
);

// 7) Reconnexion : le cadre actuel du client est resynchronisé proprement.
server = replaceExact(
  server,
  "Payload reconnect",
  '  socket.on("room:reconnect", ({ code, playerId, walletToken }, cb = () => {}) => {',
  '  socket.on("room:reconnect", ({ code, playerId, walletToken, frameId }, cb = () => {}) => {'
);

server = replaceExact(
  server,
  "Application frameId reconnect",
  '    if (!player.isBot && (!walletToken || player.walletToken !== walletToken)) return cb({ ok: false });\n\n    setPlayerSocket(room, player, socket);',
  '    if (!player.isBot && (!walletToken || player.walletToken !== walletToken)) return cb({ ok: false });\n\n    player.frameId = normalizeFrameId(frameId);\n    setPlayerSocket(room, player, socket);'
);

// 8) Mise à jour cosmétique officielle côté serveur, autorisée uniquement au membre lui-même.
server = replaceExact(
  server,
  "Handler cosmetics:sync",
  '  });\n\n\n  socket.on("room:leave", (payload, cb = () => {}) => {',
  `  });

  socket.on("cosmetics:sync", (payload = {}, cb = () => {}) => {
    const { room, player } = requireMember(socket, payload);
    if (!room || !player) return cb({ ok: false, error: "Joueur introuvable." });

    const nextFrameId = normalizeFrameId(payload.frameId);
    const changed = player.frameId !== nextFrameId;
    player.frameId = nextFrameId;

    if (changed) emitRoom(room);
    cb({ ok: true, playerId: player.id, frameId: player.frameId });
  });


  socket.on("room:leave", (payload, cb = () => {}) => {`
);

// 9) Les relances restent autorisées en partie rapide, comme dans le comportement actuel.
server = replaceExact(
  server,
  "Garde quick des relances",
  '    if (room?.mode === "quick") return socket.emit("toast", "Les relances sont désactivées en partie rapide.");\n',
  "",
  2
);

// Helper pur : aucun patch global de Node ou de Socket.IO.
const frameHelper = `"use strict";

/*
 * P'tit Bac — validation serveur des cadres cosmétiques.
 *
 * Ce module est volontairement pur:
 * - aucun patch de Module._extensions;
 * - aucun patch de Server.prototype;
 * - aucun remplacement du code source de server.js au démarrage.
 */

const ALLOWED_FRAMES = new Set([
  "",
  "frame_purple_flame",
  "frame_ice",
  "frame_gold",
  "frame_nature"
]);

function normalizeFrameId(value) {
  const id = String(value || "").trim();
  return ALLOWED_FRAMES.has(id) ? id : "";
}

module.exports = {
  ALLOWED_FRAMES,
  normalizeFrameId
};
`;

// package.json conserve les tests actuels, mais n'utilise plus le préchargeur.
let pkg;
try {
  pkg = JSON.parse(originals.pkg);
} catch (err) {
  fail(`package.json invalide avant modification: ${err.message}`);
}

pkg.scripts ||= {};
pkg.scripts.start = "node server.js";
pkg.scripts.dev = "node --watch server.js";
pkg.scripts.test ||= "node --test quick-match.test.cjs";

const packageText = JSON.stringify(pkg, null, 2) + "\n";

// Vérifications statiques AVANT écriture.
assertContains(server, "const LETTER_REROLL_COST = 20;", "coût lettre = 20");
assertContains(server, "const CATEGORY_REROLL_COST = 20;", "coût catégories = 20");
assertContains(server, 'categoryDifficulty:"medium"', "quick = medium");
assertContains(server, 'socket.on("cosmetics:sync"', "handler cosmetics:sync");
assertContains(server, "frameId: normalizeFrameId(p.frameId)", "frameId public");
assertNotContains(server, "Les relances sont désactivées en partie rapide.", "ancienne interdiction quick supprimée");

const backups = {
  server: originals.server,
  frame: originals.frame,
  pkg: originals.pkg
};

try {
  fs.writeFileSync(serverPath, server, "utf8");
  fs.writeFileSync(framePath, frameHelper, "utf8");
  fs.writeFileSync(packagePath, packageText, "utf8");

  console.log("✓ Fichiers modifiés. Vérification de la syntaxe…");
  runNode(["--check", "server.js"], "node --check server.js");
  runNode(["--check", "frame-sync-server.js"], "node --check frame-sync-server.js");
  runNode(["--check", "quick-match.js"], "node --check quick-match.js");

  console.log("✓ Syntaxe valide. Lancement des tests matchmaking…");
  runNode(["--test", "quick-match.test.cjs"], "Tests quick-match");

  const finalFrame = fs.readFileSync(framePath, "utf8");
  assertNotContains(finalFrame, "Module._extensions", "plus de patch Module._extensions");
  assertNotContains(finalFrame, "Server.prototype", "plus de patch Server.prototype");

  console.log("");
  console.log("✅ Nettoyage serveur P'tit Bac terminé.");
  console.log("Fichiers modifiés:");
  console.log("  - server.js");
  console.log("  - frame-sync-server.js");
  console.log("  - package.json");
  console.log("");
  console.log("Comportement conservé:");
  console.log("  - relance lettre: 20 pièces");
  console.log("  - relance catégories: 20 pièces");
  console.log("  - relances autorisées en partie rapide");
  console.log("  - difficulté rapide: medium");
  console.log("  - cadres synchronisés dans room:state");
  console.log("");
  console.log("Tu peux maintenant supprimer apply-core-cleanup.cjs.");
} catch (err) {
  try { fs.writeFileSync(serverPath, backups.server, "utf8"); } catch {}
  try { fs.writeFileSync(framePath, backups.frame, "utf8"); } catch {}
  try { fs.writeFileSync(packagePath, backups.pkg, "utf8"); } catch {}

  console.error("");
  console.error("❌ Correctif annulé. Les fichiers d'origine ont été restaurés.");
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
}
