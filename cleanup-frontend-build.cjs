"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const wheelPath = path.join(root, "letter-wheel-v1.js");
const soundPath = path.join(root, "letter-wheel-spin.wav");
const appPath = path.join(root, "app.js");
const stylePath = path.join(root, "style.css");
const indexPath = path.join(root, "index.html");
const publicFilesPath = path.join(root, "public-files.json");

function log(message) {
  console.log(`[Frontend cleanup] ${message}`);
}

/* =========================================================
   D1 / D1.2 — roue
   ========================================================= */

function removeWheelFxInjector(source) {
  const startMarker = "  function ensureWheelFxStyles() {";
  const nextMarker = "  /* =========================================================\n     Son de la roue — V4 iOS";
  const start = source.indexOf(startMarker);
  if (start < 0) return { source, changed: false };

  const end = source.indexOf(nextMarker, start);
  if (end < 0) {
    log("bloc CSS dynamique détecté mais fin introuvable : laissé intact.");
    return { source, changed: false };
  }

  return {
    source: source.slice(0, start) + source.slice(end),
    changed: true
  };
}

function extractWheelAudio(source) {
  const pattern =
    /  const WHEEL_SPIN_AUDIO\s*=\s*\n\s*"data:audio\/wav;base64,([A-Za-z0-9+/=]+)";/;

  const match = source.match(pattern);
  if (!match) {
    return { source, changed: false, bytes: 0 };
  }

  let audio;
  try {
    audio = Buffer.from(match[1], "base64");
  } catch {
    log("audio base64 illisible : version intégrée conservée.");
    return { source, changed: false, bytes: 0 };
  }

  const isWave =
    audio.length >= 12 &&
    audio.subarray(0, 4).toString("ascii") === "RIFF" &&
    audio.subarray(8, 12).toString("ascii") === "WAVE";

  if (!isWave) {
    log("audio extrait non reconnu comme WAV : version intégrée conservée.");
    return { source, changed: false, bytes: 0 };
  }

  fs.writeFileSync(soundPath, audio);

  const replacement =
    '  const WHEEL_SPIN_AUDIO = "/letter-wheel-spin.wav";';

  return {
    source: source.replace(match[0], replacement),
    changed: true,
    bytes: audio.length
  };
}

function removeDeadWheelLines(source) {
  let result = source;

  // Le CSS est désormais chargé par letter-wheel-fx-v1.css.
  result = result.replace(
    /\n\s*ensureWheelFxStyles\(\);\s*\n/,
    "\n"
  );

  // Helper historique non utilisé dans la roue actuelle.
  if ((result.match(/\beaseOutQuint\b/g) || []).length === 1) {
    result = result.replace(
      /^\s*const easeOutQuint = .*?;\s*\n/m,
      ""
    );
  }

  return result;
}

function cleanupWheel() {
  if (!fs.existsSync(wheelPath)) {
    log("letter-wheel-v1.js absent : nettoyage roue ignoré.");
    return;
  }

  const original = fs.readFileSync(wheelPath, "utf8");
  let source = original;

  const fx = removeWheelFxInjector(source);
  source = fx.source;

  const audio = extractWheelAudio(source);
  source = audio.source;

  source = removeDeadWheelLines(source);

  if (source !== original) {
    fs.writeFileSync(wheelPath, source, "utf8");
    const saved =
      Buffer.byteLength(original) -
      Buffer.byteLength(source);

    log(
      `letter-wheel-v1.js allégé de ` +
      `${(saved / 1024).toFixed(1)} Ko.`
    );
  } else {
    log(
      "aucune transformation nécessaire sur " +
      "letter-wheel-v1.js."
    );
  }

  if (audio.bytes > 0) {
    log(
      `son de roue extrait : ` +
      `${(audio.bytes / 1024).toFixed(1)} Ko ` +
      `-> letter-wheel-spin.wav.`
    );
  }

  if (fx.changed) {
    log(
      "ancien injecteur CSS de la roue supprimé " +
      "du build servi."
    );
  }
}

/* =========================================================
   D2 — app.js
   On garde le noyau partagé, mais on retire du build servi
   les anciens écrans remplacés par les modules V1/V2/V4.
   ========================================================= */

function skipQuoted(source, start, quote) {
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === quote) return i;
  }

  return source.length - 1;
}

function skipLineComment(source, start) {
  const end = source.indexOf("\n", start + 2);
  return end < 0 ? source.length - 1 : end;
}

function skipBlockComment(source, start) {
  const end = source.indexOf("*/", start + 2);
  return end < 0 ? source.length - 1 : end + 1;
}

function looksLikeRegexStart(source, slashIndex) {
  let i = slashIndex - 1;

  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;

  return /[({[=,:;!?&|+\-*%^~<>]/.test(source[i]);
}

function skipRegexLiteral(source, start) {
  let inClass = false;

  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === "[") {
      inClass = true;
      continue;
    }

    if (ch === "]") {
      inClass = false;
      continue;
    }

    if (ch === "/" && !inClass) {
      while (
        i + 1 < source.length &&
        /[a-z]/i.test(source[i + 1])
      ) {
        i += 1;
      }

      return i;
    }
  }

  return source.length - 1;
}

function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(source, i, ch);
      continue;
    }

    if (ch === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }

    if (ch === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }

    if (
      ch === "/" &&
      next !== "/" &&
      next !== "*" &&
      looksLikeRegexStart(source, i)
    ) {
      i = skipRegexLiteral(source, i);
      continue;
    }

    if (ch === open) {
      depth += 1;
      continue;
    }

    if (ch === close) {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function findFunctionRange(source, name) {
  const escaped =
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const pattern =
    new RegExp(
      `(^|\\n)function\\s+${escaped}\\s*\\(`,
      "m"
    );

  const match = pattern.exec(source);
  if (!match) return null;

  const start =
    match.index +
    (match[1] ? match[1].length : 0);

  const parenStart =
    source.indexOf("(", start);

  if (parenStart < 0) return null;

  const parenEnd =
    findMatchingDelimiter(
      source,
      parenStart,
      "(",
      ")"
    );

  if (parenEnd < 0) return null;

  const braceStart =
    source.indexOf("{", parenEnd + 1);

  if (braceStart < 0) return null;

  const braceEnd =
    findMatchingDelimiter(
      source,
      braceStart,
      "{",
      "}"
    );

  if (braceEnd < 0) return null;

  return {
    start,
    end: braceEnd + 1
  };
}

function replaceFunction(source, name, replacement) {
  const range =
    findFunctionRange(source, name);

  if (!range) {
    return {
      source,
      changed: false,
      removedBytes: 0
    };
  }

  const before =
    source.slice(range.start, range.end);

  if (before.trim() === replacement.trim()) {
    return {
      source,
      changed: false,
      removedBytes: 0
    };
  }

  const next =
    source.slice(0, range.start) +
    replacement +
    source.slice(range.end);

  return {
    source: next,
    changed: true,
    removedBytes:
      Buffer.byteLength(before) -
      Buffer.byteLength(replacement)
  };
}

const LOADING_SCREEN =
  "'<main class=\"screen center-screen\">" +
  "<p role=\"status\">Chargement…</p>" +
  "</main>'";

const GAME_LOADING_SCREEN =
  "'<main class=\"screen center-screen\">" +
  "<p role=\"status\">Chargement de la partie…</p>" +
  "</main>'";

const APP_RENDER_REPLACEMENTS = Object.freeze({
  renderHome:
`function renderHome() {
  setScreen(${LOADING_SCREEN});
}`,

  renderProfile:
`function renderProfile() {
  return renderHome();
}`,

  renderShop:
`function renderShop() {
  return renderHome();
}`,

  renderCategoriesInfo:
`function renderCategoriesInfo() {
  return renderHome();
}`,

  renderHowTo:
`function renderHowTo() {
  return renderHome();
}`,

  renderNameForm:
`function renderNameForm() {
  return renderHome();
}`,

  renderJoinForm:
`function renderJoinForm() {
  return renderHome();
}`,

  renderLobby:
`function renderLobby() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  openLobbySettingPopover:
`function openLobbySettingPopover() {
  // Conservé comme compatibilité ; le lobby V5 gère ses réglages.
}`,

  renderCategorySelection:
`function renderCategorySelection() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  renderLetterSelection:
`function renderLetterSelection() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  renderRound:
`function renderRound() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  renderRoundWaiting:
`function renderRoundWaiting() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  renderValidation:
`function renderValidation() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  renderScoreboard:
`function renderScoreboard() {
  setScreen(${GAME_LOADING_SCREEN});
}`,

  renderFinished:
`function renderFinished() {
  setScreen(${GAME_LOADING_SCREEN});
}`
});

function cleanupApp() {
  if (!fs.existsSync(appPath)) {
    log("app.js absent : nettoyage D2 ignoré.");
    return;
  }

  const original =
    fs.readFileSync(appPath, "utf8");

  let source = original;
  let totalRemoved = 0;
  const changed = [];
  const missing = [];

  for (
    const [name, replacement]
    of Object.entries(APP_RENDER_REPLACEMENTS)
  ) {
    const result =
      replaceFunction(
        source,
        name,
        replacement
      );

    source = result.source;

    if (result.changed) {
      changed.push(name);
      totalRemoved +=
        Math.max(
          0,
          result.removedBytes
        );
    } else {
      missing.push(name);
    }
  }

  // Ancien alias conservé mais réduit à sa forme minimale.
  source = source.replace(
    /function renderCoins\(\)\s*\{\s*renderShop\(\);\s*\}/,
    "function renderCoins() { return renderShop(); }"
  );

  if (!changed.length) {
    log(
      "app.js : aucun ancien renderer à réduire " +
      "(déjà nettoyé ou structure différente)."
    );
    return;
  }

  /*
    Garde-fous : le noyau partagé doit rester présent.
    Si l'un de ces symboles disparaît, on ne touche pas au fichier.
  */
  const requiredCore = [
    "const socket = io();",
    "const session = {",
    "function getProfile(",
    "function saveProfile(",
    "function getCoins(",
    "function setWalletState(",
    "function initWallet(",
    "function toast(",
    "function saveSession(",
    "function clearSession(",
    "function me(",
    "function escapeHtml(",
    "function categoryIcon(",
    "function setScreen(",
    "function render()",
    "function difficultyLabel(",
    "function answerKey(",
    "function gameExitModal("
  ];

  const brokenCore =
    requiredCore.filter(
      marker => !source.includes(marker)
    );

  if (brokenCore.length) {
    log(
      "D2 annulé : noyau app.js incomplet après " +
      `transformation (${brokenCore.join(", ")}).`
    );
    return;
  }

  fs.writeFileSync(
    appPath,
    source,
    "utf8"
  );

  const before =
    Buffer.byteLength(original);

  const after =
    Buffer.byteLength(source);

  log(
    `app.js : ${changed.length} anciens écrans ` +
    `réduits en fallbacks de sécurité.`
  );

  log(
    `app.js : ${(before / 1024).toFixed(1)} Ko -> ` +
    `${(after / 1024).toFixed(1)} Ko ` +
    `(-${((before - after) / 1024).toFixed(1)} Ko).`
  );

  log(
    "écrans remplacés : " +
    changed.join(", ") +
    "."
  );

  if (missing.length) {
    log(
      "déjà absents / non reconnus : " +
      missing.join(", ") +
      "."
    );
  }
}


/* =========================================================
   D3 — style.css
   Supprime uniquement les règles des anciens écrans qui ont
   été remplacés par les modules dédiés actuellement chargés.
   Les styles globaux et les sélecteurs encore utilisés restent.
   ========================================================= */

const LEGACY_STYLE_SELECTOR_PATTERNS = Object.freeze([
  /\.home-v129(?:\b|-)/,
  /\.home-v130(?:\b|-)/,
  /\.home-v150(?:\b|-)/,
  /\.profile-v150(?:\b|-)/,

  /\.v141-/,
  /\.v143-/,
  /\.v146-/,
  /\.v147-/,

  /\.letter-pick(?:-screen\b|-)/,
  /\.letter-wheel(?:\b|-)/,
  /\.v135-/,
  /\.v137-/,

  /\.play-screen\b/,
  /\.play-/,

  /\.validation-auto-v131\b/,
  /\.validation-auto-/,
  /\.auto-review-/,
  /\.auto-validation-/,
  /\.auto-check-/,

  /\.round-results-v132\b/,
  /\.round-results-v133\b/,
  /\.round-results-/,
  /\.v133-/,

  /\.final-v134\b/,
  /\.final-v134-/
]);

function isLegacyStyleSelector(selector) {
  const value = String(selector || "").trim();
  if (!value) return false;

  return LEGACY_STYLE_SELECTOR_PATTERNS.some(
    pattern => pattern.test(value)
  );
}

function splitCssSelectorList(selectorText) {
  const values = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let quote = "";

  for (let i = 0; i < selectorText.length; i += 1) {
    const char = selectorText[i];

    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }

      if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      paren += 1;
      continue;
    }

    if (char === ")") {
      paren = Math.max(0, paren - 1);
      continue;
    }

    if (char === "[") {
      bracket += 1;
      continue;
    }

    if (char === "]") {
      bracket = Math.max(0, bracket - 1);
      continue;
    }

    if (
      char === "," &&
      paren === 0 &&
      bracket === 0
    ) {
      values.push(
        selectorText.slice(start, i).trim()
      );
      start = i + 1;
    }
  }

  values.push(
    selectorText.slice(start).trim()
  );

  return values.filter(Boolean);
}

function cssFindMatchingBrace(source, start) {
  let depth = 0;
  let quote = "";

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }

      if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);

      if (end < 0) return -1;

      i = end + 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function cssNextStructuralToken(source, start) {
  let quote = "";
  let paren = 0;
  let bracket = 0;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }

      if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);

      if (end < 0) {
        return {
          index: source.length,
          token: ""
        };
      }

      i = end + 1;
      continue;
    }

    if (char === "(") {
      paren += 1;
      continue;
    }

    if (char === ")") {
      paren = Math.max(0, paren - 1);
      continue;
    }

    if (char === "[") {
      bracket += 1;
      continue;
    }

    if (char === "]") {
      bracket = Math.max(0, bracket - 1);
      continue;
    }

    if (
      paren === 0 &&
      bracket === 0 &&
      (char === "{" || char === ";")
    ) {
      return {
        index: i,
        token: char
      };
    }
  }

  return {
    index: source.length,
    token: ""
  };
}

function cleanCssSegment(source, stats) {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const leadingStart = cursor;

    while (
      cursor < source.length &&
      /\s/.test(source[cursor])
    ) {
      cursor += 1;
    }

    if (
      source[cursor] === "/" &&
      source[cursor + 1] === "*"
    ) {
      const commentEnd =
        source.indexOf("*/", cursor + 2);

      if (commentEnd < 0) {
        output += source.slice(leadingStart);
        break;
      }

      output +=
        source.slice(
          leadingStart,
          commentEnd + 2
        );

      cursor = commentEnd + 2;
      continue;
    }

    if (cursor >= source.length) {
      output += source.slice(leadingStart);
      break;
    }

    const preludeStart = cursor;
    const structure =
      cssNextStructuralToken(
        source,
        preludeStart
      );

    if (!structure.token) {
      output += source.slice(leadingStart);
      break;
    }

    const prefix =
      source.slice(
        leadingStart,
        preludeStart
      );

    const prelude =
      source.slice(
        preludeStart,
        structure.index
      );

    if (structure.token === ";") {
      output +=
        prefix +
        prelude +
        ";";

      cursor = structure.index + 1;
      continue;
    }

    const braceStart =
      structure.index;

    const braceEnd =
      cssFindMatchingBrace(
        source,
        braceStart
      );

    if (braceEnd < 0) {
      throw new Error(
        "Accolade CSS fermante introuvable."
      );
    }

    const body =
      source.slice(
        braceStart + 1,
        braceEnd
      );

    const trimmedPrelude =
      prelude.trim();

    if (trimmedPrelude.startsWith("@")) {
      const lower =
        trimmedPrelude.toLowerCase();

      const recursiveAtRule =
        lower.startsWith("@media") ||
        lower.startsWith("@supports") ||
        lower.startsWith("@container") ||
        lower.startsWith("@layer") ||
        lower.startsWith("@document");

      if (recursiveAtRule) {
        const cleanedBody =
          cleanCssSegment(
            body,
            stats
          );

        if (cleanedBody.trim()) {
          output +=
            prefix +
            prelude +
            "{" +
            cleanedBody +
            "}";
        } else {
          stats.rulesRemoved += 1;
        }
      } else {
        // @keyframes, @font-face, @property, etc.
        // restent inchangés : aucun risque de casser une animation partagée.
        output +=
          prefix +
          prelude +
          "{" +
          body +
          "}";
      }

      cursor = braceEnd + 1;
      continue;
    }

    const selectors =
      splitCssSelectorList(prelude);

    const kept =
      selectors.filter(
        selector =>
          !isLegacyStyleSelector(
            selector
          )
      );

    const removedCount =
      selectors.length -
      kept.length;

    if (removedCount > 0) {
      stats.selectorsRemoved +=
        removedCount;
    }

    if (!kept.length) {
      stats.rulesRemoved += 1;
      cursor = braceEnd + 1;
      continue;
    }

    if (
      kept.length !==
      selectors.length
    ) {
      stats.rulesTrimmed += 1;
    }

    output +=
      prefix +
      kept.join(",\n") +
      "{" +
      body +
      "}";

    cursor = braceEnd + 1;
  }

  return output;
}

function bracesAreBalanced(source) {
  let depth = 0;
  let quote = "";

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }

      if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);

      if (end < 0) return false;

      i = end + 1;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth < 0) return false;
  }

  return depth === 0 && !quote;
}

function cleanupStyle() {
  if (!fs.existsSync(stylePath)) {
    log(
      "style.css absent : nettoyage D3 ignoré."
    );
    return;
  }

  const original =
    fs.readFileSync(
      stylePath,
      "utf8"
    );

  const stats = {
    rulesRemoved: 0,
    rulesTrimmed: 0,
    selectorsRemoved: 0
  };

  let cleaned;

  try {
    cleaned =
      cleanCssSegment(
        original,
        stats
      );
  } catch (error) {
    log(
      "D3 annulé : " +
      (error?.message || error)
    );
    return;
  }

  const criticalSelectors = [
    ".screen",
    ".toast",
    ".btn",
    ".category-pick-screen"
  ];

  const missingCritical =
    criticalSelectors.filter(
      selector =>
        original.includes(selector) &&
        !cleaned.includes(selector)
    );

  if (missingCritical.length) {
    log(
      "D3 annulé : styles critiques " +
      "introuvables après nettoyage (" +
      missingCritical.join(", ") +
      ")."
    );
    return;
  }

  if (!bracesAreBalanced(cleaned)) {
    log(
      "D3 annulé : accolades CSS " +
      "déséquilibrées après nettoyage."
    );
    return;
  }

  const before =
    Buffer.byteLength(original);

  const after =
    Buffer.byteLength(cleaned);

  if (
    after >= before ||
    stats.selectorsRemoved === 0
  ) {
    log(
      "style.css : aucun ancien style " +
      "à retirer."
    );
    return;
  }

  fs.writeFileSync(
    stylePath,
    cleaned,
    "utf8"
  );

  log(
    `style.css : ${(before / 1024).toFixed(1)} Ko -> ` +
    `${(after / 1024).toFixed(1)} Ko ` +
    `(-${((before - after) / 1024).toFixed(1)} Ko).`
  );

  log(
    "D3 : " +
    `${stats.rulesRemoved} règle(s) supprimée(s), ` +
    `${stats.rulesTrimmed} règle(s) mixte(s) nettoyée(s), ` +
    `${stats.selectorsRemoved} sélecteur(s) legacy retiré(s).`
  );
}


/* =========================================================
   D4 — bundles légers
   Réduit le nombre de requêtes sans changer l'ordre logique.
   Les gros écrans restent séparés.
   ========================================================= */

const D4_BUNDLES = Object.freeze([
  {
    type:"css",
    output:"ptb-category-avatar-patches.css",
    id:"",
    files:[
      "category-position-fix-v1.css",
      "category-chooser-card-v1.css",
      "shared-footer-v1.css",
      "avatar-fix-v2.css",
      "avatar-system-v1.css"
    ]
  },
  {
    type:"css",
    output:"ptb-ui-wheel-patches.css",
    id:"pbw1WheelFxStyles",
    files:[
      "ui-fixes-v3.css",
      "lobby-polish-v1.css",
      "letter-wheel-fx-v1.css"
    ]
  },
  {
    type:"css",
    output:"ptb-late-patches.css",
    id:"",
    files:[
      "category-prototype.css",
      "private-lobby.css",
      "avatar-pages-fix-v1.css"
    ]
  },
  {
    type:"js",
    output:"ptb-core-client.js",
    files:[
      "runtime-compat-v1.js",
      "avatar-system-v1.js",
      "inventory-client.js",
      "progression-client.js",
      "icon-theme-v1.js"
    ]
  },
  {
    type:"js",
    output:"ptb-ui-patches.js",
    files:[
      "ui-fixes-v3.js",
      "lobby-polish-v1.js"
    ]
  },
  {
    type:"js",
    output:"ptb-late-client.js",
    files:[
      "wallet-client.js",
      "avatar-pages-fix-v1.js"
    ]
  }
]);

function bundleBuildVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(root, "package.json"),
        "utf8"
      )
    );

    if (pkg?.version) {
      return String(pkg.version);
    }
  } catch {}

  return "1.45.0";
}

function htmlAssetPath(tag, type) {
  const attribute =
    type === "css"
      ? "href"
      : "src";

  const match =
    tag.match(
      new RegExp(
        `${attribute}=["']([^"']+)["']`,
        "i"
      )
    );

  if (!match) return "";

  return String(match[1])
    .split("?")[0]
    .replace(/^\/+/, "");
}

function findHtmlAssetTags(html, type) {
  const pattern =
    type === "css"
      ? /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi
      : /<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi;

  const tags = [];
  let match;

  while ((match = pattern.exec(html))) {
    const assetPath =
      htmlAssetPath(
        match[0],
        type
      );

    if (!assetPath) continue;

    tags.push({
      start:match.index,
      end:match.index + match[0].length,
      tag:match[0],
      path:assetPath
    });
  }

  return tags;
}

function concatBundleFiles(config) {
  const chunks = [];

  for (const file of config.files) {
    const filePath =
      path.join(root, file);

    if (!fs.existsSync(filePath)) {
      return {
        ok:false,
        error:`${file} absent`
      };
    }

    const content =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    chunks.push(
      config.type === "css"
        ? `/* ===== ${file} ===== */\n${content.trim()}\n`
        : `/* ===== ${file} ===== */\n${content.trim()}\n;\n`
    );
  }

  const content =
    chunks.join("\n");

  if (config.type === "js") {
    try {
      // Parse uniquement : aucun code navigateur n'est exécuté.
      new Function(content);
    } catch (error) {
      return {
        ok:false,
        error:
          `bundle JS invalide (${error?.message || error})`
      };
    }
  }

  return {
    ok:true,
    content
  };
}

function createBundleTag(config, version) {
  const url =
    `/${config.output}?v=${encodeURIComponent(version)}`;

  if (config.type === "css") {
    const id =
      config.id
        ? ` id="${config.id}"`
        : "";

    return (
      `<link${id} rel="stylesheet" href="${url}" />`
    );
  }

  return (
    `<script defer src="${url}"></script>`
  );
}

function applyBundleToHtml(html, config, version) {
  const tags =
    findHtmlAssetTags(
      html,
      config.type
    );

  const selected = [];

  for (const file of config.files) {
    const matches =
      tags.filter(
        entry =>
          entry.path === file
      );

    if (matches.length !== 1) {
      return {
        ok:false,
        html,
        error:
          `${file} doit apparaître exactement une fois dans index.html`
      };
    }

    selected.push(matches[0]);
  }

  for (let i = 1; i < selected.length; i += 1) {
    if (
      selected[i].start <=
      selected[i - 1].start
    ) {
      return {
        ok:false,
        html,
        error:
          `ordre inattendu pour ${config.output}`
      };
    }
  }

  // Vérifie qu'aucun autre stylesheet/script du même type
  // ne s'intercale entre les fichiers à fusionner.
  const selectedSet =
    new Set(
      selected.map(
        item => item.path
      )
    );

  const between =
    tags.filter(
      entry =>
        entry.start >= selected[0].start &&
        entry.end <= selected[selected.length - 1].end &&
        !selectedSet.has(entry.path)
    );

  if (between.length) {
    return {
      ok:false,
      html,
      error:
        `assets intercalés dans ${config.output}: ` +
        between.map(item => item.path).join(", ")
    };
  }

  const replacement =
    createBundleTag(
      config,
      version
    );

  let next = html;

  // Retirer de la fin vers le début pour garder les offsets valides.
  for (
    let i = selected.length - 1;
    i >= 0;
    i -= 1
  ) {
    const item =
      selected[i];

    next =
      next.slice(0, item.start) +
      (
        i === 0
          ? replacement
          : ""
      ) +
      next.slice(item.end);
  }

  return {
    ok:true,
    html:next
  };
}

function updatePublicFiles(generated) {
  if (!fs.existsSync(publicFilesPath)) {
    return false;
  }

  let list;

  try {
    list =
      JSON.parse(
        fs.readFileSync(
          publicFilesPath,
          "utf8"
        )
      );
  } catch {
    return false;
  }

  if (!Array.isArray(list)) {
    return false;
  }

  let changed = false;

  for (const file of generated) {
    const route = `/${file}`;

    if (!list.includes(route)) {
      list.push(route);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(
      publicFilesPath,
      JSON.stringify(
        list,
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  return true;
}

function bundleFrontendAssets() {
  if (!fs.existsSync(indexPath)) {
    log(
      "D4 ignoré : index.html absent."
    );
    return;
  }

  const originalHtml =
    fs.readFileSync(
      indexPath,
      "utf8"
    );

  let html =
    originalHtml;

  const version =
    bundleBuildVersion();

  const generated = [];
  const reports = [];

  for (const config of D4_BUNDLES) {
    const bundle =
      concatBundleFiles(
        config
      );

    if (!bundle.ok) {
      reports.push(
        `${config.output} ignoré : ${bundle.error}`
      );
      continue;
    }

    const htmlResult =
      applyBundleToHtml(
        html,
        config,
        version
      );

    if (!htmlResult.ok) {
      reports.push(
        `${config.output} ignoré : ${htmlResult.error}`
      );
      continue;
    }

    const outputPath =
      path.join(
        root,
        config.output
      );

    fs.writeFileSync(
      outputPath,
      bundle.content,
      "utf8"
    );

    html =
      htmlResult.html;

    generated.push(
      config.output
    );

    reports.push(
      `${config.output}: ${config.files.length} -> 1`
    );
  }

  if (!generated.length) {
    log(
      "D4 : aucun bundle généré."
    );
    return;
  }

  if (!updatePublicFiles(generated)) {
    // Sans allowlist, le serveur ne pourrait pas servir les bundles.
    // On annule donc la réécriture HTML.
    for (const file of generated) {
      try {
        fs.unlinkSync(
          path.join(
            root,
            file
          )
        );
      } catch {}
    }

    log(
      "D4 annulé : public-files.json indisponible ou invalide."
    );
    return;
  }

  fs.writeFileSync(
    indexPath,
    html,
    "utf8"
  );

  const beforeRequests =
    findHtmlAssetTags(
      originalHtml,
      "css"
    ).length +
    findHtmlAssetTags(
      originalHtml,
      "js"
    ).length;

  const afterRequests =
    findHtmlAssetTags(
      html,
      "css"
    ).length +
    findHtmlAssetTags(
      html,
      "js"
    ).length;

  log(
    "D4 : " +
    `${beforeRequests} fichiers CSS/JS -> ` +
    `${afterRequests} (-${beforeRequests - afterRequests} requêtes).`
  );

  for (const report of reports) {
    log(`D4 : ${report}`);
  }
}

function main() {
  cleanupWheel();
  cleanupApp();
  cleanupStyle();
  bundleFrontendAssets();
}

main();
