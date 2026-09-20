"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const file = name => path.join(root, name);
const exists = name => fs.existsSync(file(name));
const read = name => fs.readFileSync(file(name), "utf8");
const write = (name, content) => {
  const target = file(name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  console.log(`[1.49] ${name} mis à jour.`);
};

const required = [
  "index.html",
  "scoreboard-screen-v1.css",
  "scoreboard-screen-v1.js",
  "public-files.json",
  "package.json",
  "ci-check.cjs",
  "cleanup-frontend-build.cjs",
  "README.md"
];
for (const name of required) {
  if (!exists(name)) throw new Error(`Fichier requis absent: ${name}`);
}

const pkg = JSON.parse(read("package.json"));
const version = String(pkg.version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Version package.json invalide ou absente.");
}

// ---------------------------------------------------------------------------
// PASSE 1 — répare le build et absorbe le patch Résultats dans son propriétaire.
// ---------------------------------------------------------------------------
let html = read("index.html");

// Asset fantôme : absent du dépôt et de public-files.json.
html = html.replace(
  /^\s*<link\s+rel=["']stylesheet["']\s+href=["']\/shop-header-quest-lines\.css[^"']*["']\s*\/?>\s*\r?\n/im,
  ""
);

// Déplace le CSS du bandeau Résultats depuis le <style> inline vers le CSS écran.
const cssMarker = "/* =========================================================\n       Résultats de manche — bandeau partagé";
const cssStart = html.indexOf(cssMarker);
if (cssStart >= 0) {
  const styleClose = html.indexOf("  </style>", cssStart);
  if (styleClose < 0) {
    throw new Error("Fin du bloc <style> introuvable pour le bandeau Résultats.");
  }

  const resultsCss = html.slice(cssStart, styleClose).trimEnd();
  let scoreboardCss = read("scoreboard-screen-v1.css");
  if (!scoreboardCss.includes("Résultats de manche — bandeau partagé")) {
    scoreboardCss = `${scoreboardCss.trimEnd()}\n\n${resultsCss}\n`;
    write("scoreboard-screen-v1.css", scoreboardCss);
  }
  html = html.slice(0, cssStart) + html.slice(styleClose);
}

// Le renderer Résultats utilise directement l'icône finale.
let scoreboardJs = read("scoreboard-screen-v1.js");
const scoreboardJsNext = scoreboardJs.replace(
  '<img src="/lobby-exit.png" alt="">',
  '<img src="/back-arrow.png" alt="">'
);
if (scoreboardJsNext !== scoreboardJs) {
  scoreboardJs = scoreboardJsNext;
  write("scoreboard-screen-v1.js", scoreboardJs);
}

// Supprime uniquement le patch JS Résultats ajouté à la fin de index.html.
const resultScriptRe = /\n\s*<script>\s*\(\(\)\s*=>\s*\{\s*["']use strict["'];[\s\S]*?let\s+resultsHeaderScheduled\s*=\s*false;[\s\S]*?function\s+resultsHeaderStart\s*\(\)[\s\S]*?<\/script>\s*(?=\n\s*<\/body>)/m;
if (resultScriptRe.test(html)) {
  html = html.replace(resultScriptRe, "\n");
}
write("index.html", html);

// ---------------------------------------------------------------------------
// PASSE 2 — garde-fous de maintenance sans impact visuel ou gameplay.
// ---------------------------------------------------------------------------

// GitHub Actions : les erreurs sont détectées avant Render.
const workflow = `name: P'tit Bac CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n\n      - name: Node 22\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n\n      - name: Install dependencies\n        run: npm ci\n\n      - name: Tests\n        run: npm test\n\n      - name: Architecture and asset checks\n        run: npm run check\n`;
write(path.join(".github", "workflows", "ci.yml"), workflow);

// Empêche de versionner les artefacts de build et les données locales.
const gitignore = `node_modules/\n.env\n.env.*\n!.env.example\n.DS_Store\n*.log\n\n# Données locales / fallback de développement\nwallets.json\nrooms.json\nvalidation-cache-v2.json\n\n# Assets et bundles générés pendant le build\n.ptb-assets/\nptb-category-avatar-patches.css\nptb-ui-wheel-patches.css\nptb-late-patches.css\nptb-core-client.js\nptb-ui-patches.js\nptb-late-client.js\n`;
write(".gitignore", gitignore);

// Le fallback du builder doit suivre la version applicative actuelle.
let cleanup = read("cleanup-frontend-build.cjs");
cleanup = cleanup.replace(/String\(pkg\?\.version \|\| "\d+\.\d+\.\d+"\)/g, `String(pkg?.version || "${version}")`);
cleanup = cleanup.replace(/return "\d+\.\d+\.\d+";/g, `return "${version}";`);
write("cleanup-frontend-build.cjs", cleanup);

// README : seulement l'état courant et le nom du module réellement utilisé.
let readme = read("README.md");
readme = readme.replace(/Version applicative\s*:\s*\*\*\d+\.\d+\.\d+\*\*/i, `Version applicative : **${version}**`);
readme = readme.replace(/`quick-match\.js`\s*:\s*recherche de partie rapide/g, "`quick-match-v2.js` : recherche de partie rapide");
write("README.md", readme);

// Test de non-régression dédié à la stabilisation 1.49.
const stabilisationTest = [
  '"use strict";',
  '',
  'const assert = require("node:assert/strict");',
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  'const test = require("node:test");',
  '',
  'const root = __dirname;',
  'const read = name => fs.readFileSync(path.join(root, name), "utf8");',
  '',
  'test("stabilisation 1.49 : build et écran Résultats restent propres", () => {',
  '  const pkg = JSON.parse(read("package.json"));',
  '  const html = read("index.html");',
  '  const scoreboardJs = read("scoreboard-screen-v1.js");',
  '  const scoreboardCss = read("scoreboard-screen-v1.css");',
  '  const readme = read("README.md");',
  '  const expectedVersion = "Version applicative : **" + pkg.version + "**";',
  '',
  '  assert.doesNotMatch(html, /shop-header-quest-lines\\.css/);',
  '  assert.doesNotMatch(html, /resultsHeaderObserver|resultsHeaderStart/);',
  '  assert.match(scoreboardJs, /id="resExit"[\\s\\S]*?src="\\/back-arrow\\.png"/);',
  '  assert.match(scoreboardCss, /Résultats de manche — bandeau partagé/);',
  '  assert.ok(readme.includes(expectedVersion));',
  '  assert.equal(fs.existsSync(path.join(root, ".github", "workflows", "ci.yml")), true);',
  '  assert.equal(fs.existsSync(path.join(root, ".gitignore")), true);',
  '});',
  ''
].join("\n");
write("stabilisation-149.test.cjs", stabilisationTest);

// ---------------------------------------------------------------------------
// Vérifications finales avant de laisser le dépôt être commité.
// ---------------------------------------------------------------------------
const finalHtml = read("index.html");
const finalJs = read("scoreboard-screen-v1.js");
const finalCss = read("scoreboard-screen-v1.css");
const finalReadme = read("README.md");

if (/shop-header-quest-lines\.css/i.test(finalHtml)) {
  throw new Error("La référence fantôme shop-header-quest-lines.css est encore présente.");
}
if (/resultsHeaderObserver|resultsHeaderStart/.test(finalHtml)) {
  throw new Error("L'ancien patch JS Résultats est encore présent dans index.html.");
}
if (!finalJs.includes('<img src="/back-arrow.png" alt="">')) {
  throw new Error("scoreboard-screen-v1.js n'utilise pas back-arrow.png.");
}
if (!finalCss.includes("Résultats de manche — bandeau partagé")) {
  throw new Error("Le CSS du bandeau Résultats n'est pas dans scoreboard-screen-v1.css.");
}
if (!finalReadme.includes(`Version applicative : **${version}**`)) {
  throw new Error("README.md n'est pas aligné avec package.json.");
}

console.log("\n[1.49] Passes 1 + 2 appliquées avec succès.");
console.log("[1.49] Vérifie ensuite avec : npm test && npm run check");
