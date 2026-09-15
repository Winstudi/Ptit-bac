"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
const production = process.argv.includes("--production");

const REQUIRED_BUILD_STEPS = [
  "e2-shared-db-build.cjs",
  "e3-functional-fixes-build.cjs",
  "e4-render-events-build.cjs",
  "e5-socket-security-build.cjs",
  "cleanup-frontend-build.cjs"
];

const GENERATED_PUBLIC_FILES = new Set([
  "/letter-wheel-spin.wav",
  "/ptb-category-avatar-patches.css",
  "/ptb-ui-wheel-patches.css",
  "/ptb-late-patches.css",
  "/ptb-core-client.js",
  "/ptb-ui-patches.js",
  "/ptb-late-client.js"
]);

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
    if (!pkg?.scripts?.[script]) {
      fail(`script npm manquant: ${script}`);
    }
  }
}

function checkRenderChain() {
  const render = read("render.yaml");
  let previous = -1;

  for (const step of REQUIRED_BUILD_STEPS) {
    if (!exists(step)) {
      fail(`script de build absent: ${step}`);
    }

    const index = render.indexOf(`node ${step}`);
    if (index < 0) {
      fail(`render.yaml n'exécute pas ${step}.`);
    }

    if (index <= previous) {
      fail(`ordre de build incorrect autour de ${step}.`);
    }

    previous = index;
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
    if (route) routes.add(route);
  }

  return [...routes].sort();
}

function checkPublicFiles() {
  const list = JSON.parse(read("public-files.json"));

  if (!Array.isArray(list)) {
    fail("public-files.json doit contenir un tableau.");
  }

  const duplicates = list.filter(
    (item, index) => list.indexOf(item) !== index
  );

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

    if (!exists(file) && !GENERATED_PUBLIC_FILES.has(route)) {
      missingOnDisk.push(route);
    }
  }

  if (missingOnDisk.length) {
    fail(`fichiers publics absents: ${missingOnDisk.join(", ")}`);
  }

  const indexRoutes = localRoutesFromIndex(read("index.html"));
  const missingFromAllowlist = indexRoutes.filter(route => !publicSet.has(route));

  if (missingFromAllowlist.length) {
    fail(
      `assets de index.html absents de public-files.json: ` +
      missingFromAllowlist.join(", ")
    );
  }

  return {
    publicCount: list.length,
    indexCount: indexRoutes.length
  };
}

function checkCoreFiles() {
  const required = [
    "server.js",
    "app.js",
    "style.css",
    "index.html",
    "public-files.json",
    "db.js",
    "socket-security.js",
    "room-mode-rules.js",
    "game-economy.js",
    "inventory-service.js",
    "progression-service.js"
  ];

  const missing = required.filter(name => !exists(name));
  if (missing.length) {
    fail(`fichiers cœur manquants: ${missing.join(", ")}`);
  }
}

function checkProductionTransform() {
  if (!production) return;

  const server = read("server.js");
  const app = read("app.js");

  const requiredServerMarkers = [
    'require("./db.js")',
    "installSocketSecurity(io);",
    "validAnswerCount",
    "countdownRoomCode"
  ];

  for (const marker of requiredServerMarkers) {
    if (!server.includes(marker)) {
      fail(`transformation production absente de server.js: ${marker}`);
    }
  }

  for (const marker of [
    "ptitbac:screen-rendered",
    "ptitbac:dom-updated",
    "ptbSharedDomObserver"
  ]) {
    if (!app.includes(marker)) {
      fail(`transformation E4 absente de app.js: ${marker}`);
    }
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

    if (!source.includes('require("./db.js")')) {
      fail(`${name} n'utilise pas db.js après E2.`);
    }

    if (source.includes('require("pg")') || source.includes("new Pool(")) {
      fail(`${name} crée encore un Pool PostgreSQL après E2.`);
    }
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
      fail(`${name} possède encore un MutationObserver individuel après E4.`);
    }
  }
}

function main() {
  checkCoreFiles();
  checkPackage();
  checkRenderChain();
  const syntaxCount = syntaxCheckAll();
  const publicInfo = checkPublicFiles();
  checkProductionTransform();

  console.log(
    `[CI] OK — ${syntaxCount} fichiers JS/CJS validés, ` +
    `${publicInfo.publicCount} fichiers publics, ` +
    `${publicInfo.indexCount} assets locaux dans index.html` +
    `${production ? ", transformations production validées" : ""}.`
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
