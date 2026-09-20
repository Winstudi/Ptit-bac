"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const write = (name, content) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  console.log(`[1.49] ${name} mis à jour.`);
};
const exists = name => fs.existsSync(path.join(root, name));

const required = [
  "index.html",
  "scoreboard-screen-v1.css",
  "scoreboard-screen-v1.js",
  "public-files.json",
  "package.json",
  "ci-check.cjs"
];
for (const name of required) {
  if (!exists(name)) throw new Error(`Fichier requis absent: ${name}`);
}

// 1) Corrige l'asset fantôme qui peut faire échouer npm run check.
let html = read("index.html");
html = html.replace(
  /^\s*<link\s+rel=["']stylesheet["']\s+href=["']\/shop-header-quest-lines\.css[^"']*["']\s*\/?>\s*\r?\n/im,
  ""
);

// 2) Déplace le CSS du bandeau Résultats vers le fichier propriétaire.
const cssMarker = "/* =========================================================\n       Résultats de manche — bandeau partagé";
const styleClose = "  </style>";
const cssStart = html.indexOf(cssMarker);
if (cssStart >= 0) {
  const cssEnd = html.indexOf(styleClose, cssStart);
  if (cssEnd < 0) throw new Error("Fin du bloc <style> introuvable pour le bandeau Résultats.");

  const resultsCss = html.slice(cssStart, cssEnd).trimEnd();
  let scoreboardCss = read("scoreboard-screen-v1.css");

  if (!scoreboardCss.includes("Résultats de manche — bandeau partagé")) {
    scoreboardCss = scoreboardCss.trimEnd() + "\n\n" + resultsCss + "\n";
    write("scoreboard-screen-v1.css", scoreboardCss);
  }

  html = html.slice(0, cssStart) + html.slice(cssEnd);
}

// 3) Le renderer Résultats utilise directement la bonne flèche.
let scoreboardJs = read("scoreboard-screen-v1.js");
const beforeArrow = scoreboardJs;
scoreboardJs = scoreboardJs.replace(
  '<img src="/lobby-exit.png" alt="">',
  '<img src="/back-arrow.png" alt="">'
);
if (scoreboardJs !== beforeArrow) {
  write("scoreboard-screen-v1.js", scoreboardJs);
}

// 4) Supprime le patch JS global du bandeau Résultats et son MutationObserver.
const resultScriptRe = /\n\s*<script>\s*\(\(\)\s*=>\s*\{\s*["']use strict["'];[\s\S]*?let\s+resultsHeaderScheduled\s*=\s*false;[\s\S]*?function\s+resultsHeaderStart\s*\(\)[\s\S]*?<\/script>\s*(?=\n\s*<\/body>)/m;
if (resultScriptRe.test(html)) {
  html = html.replace(resultScriptRe, "\n");
}

write("index.html", html);

// 5) Ajoute une CI GitHub pour bloquer les futurs commits cassés avant Render.
const workflow = `name: P'tit Bac CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n\n      - name: Node 22\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n\n      - name: Install dependencies\n        run: npm ci\n\n      - name: Tests\n        run: npm test\n\n      - name: Architecture and asset checks\n        run: npm run check\n`;
write(path.join(".github", "workflows", "ci.yml"), workflow);

// 6) Vérifications ciblées de la migration.
const finalHtml = read("index.html");
const finalJs = read("scoreboard-screen-v1.js");
const finalCss = read("scoreboard-screen-v1.css");

if (/shop-header-quest-lines\.css/i.test(finalHtml)) {
  throw new Error("La référence à shop-header-quest-lines.css est encore présente.");
}
if (/resultsHeaderObserver|resultsHeaderStart/.test(finalHtml)) {
  throw new Error("L'ancien patch JS Résultats est encore présent dans index.html.");
}
if (!finalJs.includes('<img src="/back-arrow.png" alt="">')) {
  throw new Error("scoreboard-screen-v1.js n'utilise pas encore back-arrow.png.");
}
if (!finalCss.includes("Résultats de manche — bandeau partagé")) {
  throw new Error("Le CSS du bandeau Résultats n'a pas été déplacé.");
}

console.log("\n[1.49] Première passe de stabilisation appliquée avec succès.");
console.log("[1.49] Lance maintenant : npm test && npm run check");
