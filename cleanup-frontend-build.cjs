"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const wheelPath = path.join(root, "letter-wheel-v1.js");
const soundPath = path.join(root, "letter-wheel-spin.wav");
const appPath = path.join(root, "app.js");

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

function main() {
  cleanupWheel();
  cleanupApp();
}

main();
