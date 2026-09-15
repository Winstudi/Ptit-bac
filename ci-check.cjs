"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
const production = process.argv.includes("--production");

const BUILD_GENERATED_PUBLIC_FILES = Object.freeze({
  "/ptb-category-avatar-patches.css": "cleanup-frontend-build.cjs",
  "/ptb-ui-wheel-patches.css": "cleanup-frontend-build.cjs",
  "/ptb-late-patches.css": "cleanup-frontend-build.cjs",
  "/ptb-core-client.js": "cleanup-frontend-build.cjs",
  "/ptb-ui-patches.js": "cleanup-frontend-build.cjs",
  "/ptb-late-client.js": "cleanup-frontend-build.cjs"
});

const DYNAMIC_INDEX_PREFIXES = ["/socket.io/"];
const OBSOLETE_BUILD_SCRIPTS = [
  "apply-e1-source-cleanup.cjs",
  "e2-shared-db-build.cjs",
  "e3-functional-fixes-build.cjs",
  "e4-render-events-build.cjs",
  "e5-socket-security-build.cjs"
];

function fail(message) {
  throw new Error(`[CI] ${message}`);
}

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function exists(name) {
  return fs.existsSync(path.join(root, name));
}

function syntaxCheckAll() {
  const files = fs.readdirSync(root)
    .filter(name => /\.(?:js|cjs)$/i.test(name))
    .sort();

  for (const name of files) {
    try {
      execFileSync(process.execPath, ["--check", path.join(root, name)], {
        stdio: "pipe"
      });
    } catch (error) {
      const stderr = String(error?.stderr || "").trim();
      fail(`syntaxe invalide dans ${name}${stderr ? `\n${stderr}` : ""}`);
    }
  }

  return files.length;
}

function checkPackage() {
  const pkg = JSON.parse(read("package.json"));

  if (pkg?.engines?.node !== "22.x") {
    fail("package.json doit rester sur Node 22.x.");
  }

  for (const script of ["test", "check", "check:production"]) {
    if (!pkg?.scripts?.[script]) fail(`script npm manquant: ${script}`);
  }
}

function checkRenderChain() {
  const render = read("render.yaml");

  for (const required of [
    "npm ci",
    "npm test",
    "npm run check",
    "node cleanup-frontend-build.cjs",
    "npm run check:production"
  ]) {
    if (!render.includes(required)) {
      fail(`render.yaml doit contenir: ${required}`);
    }
  }

  for (const obsolete of OBSOLETE_BUILD_SCRIPTS) {
    if (render.includes(`node ${obsolete}`)) {
      fail(`render.yaml exécute encore l'ancien patch ${obsolete}.`);
    }
  }

  if (!render.includes("healthCheckPath: /health")) {
    fail("Render doit conserver /health comme health check.");
  }
}

function localRoutesFromIndex(html) {
  const routes = new Set();
  const regex = /(?:src|href)=["'](\/[^"'?#]+)(?:\?[^"']*)?["']/gi;
  let match;

  while ((match = regex.exec(html))) {
    const route = String(match[1] || "").trim();
    if (!route) continue;
    if (DYNAMIC_INDEX_PREFIXES.some(prefix => route.startsWith(prefix))) continue;
    routes.add(route);
  }

  return [...routes].sort();
}

function checkGeneratedPublicFiles() {
  const cleanupSource = read("cleanup-frontend-build.cjs");

  for (const [route, generator] of Object.entries(BUILD_GENERATED_PUBLIC_FILES)) {
    if (!exists(generator)) fail(`générateur absent pour ${route}: ${generator}`);
    const fileName = route.slice(1);
    if (!cleanupSource.includes(fileName)) {
      fail(`${route} est déclaré comme généré, mais ${generator} ne contient pas ${fileName}.`);
    }
  }
}

function checkPublicFiles() {
  const list = JSON.parse(read("public-files.json"));
  if (!Array.isArray(list)) fail("public-files.json doit contenir un tableau.");

  const duplicates = list.filter((item, index) => list.indexOf(item) !== index);
  if (duplicates.length) {
    fail(`doublons dans public-files.json: ${[...new Set(duplicates)].join(", ")}`);
  }

  const publicSet = new Set(list);
  const missingOnDisk = [];

  for (const route of list) {
    if (typeof route !== "string" || !route.startsWith("/")) {
      fail(`route publique invalide: ${String(route)}`);
    }

    const file = route.slice(1);
    if (!file) continue;
    const generated = Boolean(BUILD_GENERATED_PUBLIC_FILES[route]);
    if (!exists(file) && !generated) missingOnDisk.push(route);
  }

  if (missingOnDisk.length) {
    fail(`fichiers publics absents: ${missingOnDisk.join(", ")}`);
  }

  const indexRoutes = localRoutesFromIndex(read("index.html"));
  const missingFromAllowlist = indexRoutes.filter(route => !publicSet.has(route));
  if (missingFromAllowlist.length) {
    fail(`assets de index.html absents de public-files.json: ${missingFromAllowlist.join(", ")}`);
  }

  return { publicCount:list.length, indexCount:indexRoutes.length };
}

function checkCoreFiles() {
  const required = [
    ".gitignore",
    "server.js",
    "app.js",
    "style.css",
    "index.html",
    "public-files.json",
    "db.js",
    "socket-security.js",
    "letter-wheel-spin.wav",
    "room-mode-rules.js",
    "game-economy.js",
    "inventory-service.js",
    "progression-service.js"
  ];

  const missing = required.filter(name => !exists(name));
  if (missing.length) fail(`fichiers cœur manquants: ${missing.join(", ")}`);
}

function checkIntegratedBackend() {
  const server = read("server.js");

  for (const marker of [
    'require("./db.js")',
    'require("./socket-security.js")',
    "installSocketSecurity(io);",
    "validAnswerCount",
    "countdownRoomCode"
  ]) {
    if (!server.includes(marker)) fail(`server.js n'intègre pas encore: ${marker}`);
  }

  if (server.includes('require("pg")') || server.includes("new Pool(")) {
    fail("server.js crée encore son propre Pool PostgreSQL.");
  }

  const sharedDbFiles = [
    "friends-hook.js",
    "chat-hook.js",
    "admin-hook.js",
    "player-report-hook.js",
    "friend-code-v2-hook.js"
  ];

  for (const name of sharedDbFiles) {
    const source = read(name);
    if (!source.includes('require("./db.js")')) fail(`${name} n'utilise pas db.js.`);
    if (source.includes('require("pg")') || source.includes("new Pool(")) {
      fail(`${name} crée encore son propre Pool PostgreSQL.`);
    }
  }
}

function checkIntegratedFrontend() {
  const app = read("app.js");
  const wheel = read("letter-wheel-v1.js");
  const style = read("style.css");

  for (const marker of [
    "ptitbac:screen-rendered",
    "ptitbac:dom-updated",
    "ptbSharedDomObserver"
  ]) {
    if (!app.includes(marker)) fail(`app.js n'intègre pas E4: ${marker}`);
  }

  const observerModules = [
    "avatar-system-v1.js",
    "avatar-pages-fix-v1.js",
    "progression-client.js",
    "lobby-polish-v1.js",
    "ui-fixes-v3.js"
  ];

  for (const name of observerModules) {
    if (read(name).includes("new MutationObserver(")) {
      fail(`${name} possède encore un MutationObserver individuel.`);
    }
  }

  if (wheel.includes("data:audio/wav;base64")) {
    fail("letter-wheel-v1.js contient encore l'audio base64.");
  }
  if (wheel.includes("function ensureWheelFxStyles()")) {
    fail("letter-wheel-v1.js contient encore l'ancien injecteur CSS.");
  }
  if (!wheel.includes('"/letter-wheel-spin.wav"')) {
    fail("letter-wheel-v1.js n'utilise pas letter-wheel-spin.wav.");
  }

  const wav = fs.readFileSync(path.join(root, "letter-wheel-spin.wav"));
  if (
    wav.length <= 44 ||
    wav.subarray(0,4).toString("ascii") !== "RIFF" ||
    wav.subarray(8,12).toString("ascii") !== "WAVE"
  ) {
    fail("letter-wheel-spin.wav est invalide.");
  }

  if (!app.includes("Chargement de la partie")) {
    fail("app.js ne contient pas les fallbacks modernes attendus.");
  }

  if (Buffer.byteLength(app) > 70 * 1024) {
    fail("app.js contient encore trop de rendu legacy (>70 Ko). ");
  }
  if (Buffer.byteLength(style) > 170 * 1024) {
    fail("style.css contient encore trop de CSS legacy (>170 Ko). ");
  }
}

function checkProductionBundles() {
  if (!production) return;

  for (const route of Object.keys(BUILD_GENERATED_PUBLIC_FILES)) {
    if (!exists(route.slice(1))) fail(`bundle de production absent: ${route}`);
  }
}

function reportObsoleteScripts() {
  const present = OBSOLETE_BUILD_SCRIPTS.filter(exists);
  if (present.length) {
    console.warn(`[CI] Info: scripts de migration encore présents mais inutilisés: ${present.join(", ")}`);
  }
}

function main() {
  checkCoreFiles();
  checkPackage();
  checkGeneratedPublicFiles();
  checkRenderChain();
  checkIntegratedBackend();
  checkIntegratedFrontend();

  const syntaxCount = syntaxCheckAll();
  const publicInfo = checkPublicFiles();
  checkProductionBundles();
  reportObsoleteScripts();

  console.log(
    `[CI] OK — ${syntaxCount} fichiers JS/CJS validés, ` +
    `${publicInfo.publicCount} fichiers publics, ` +
    `${publicInfo.indexCount} assets locaux dans index.html` +
    `${production ? ", bundles production validés" : ""}.`
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
