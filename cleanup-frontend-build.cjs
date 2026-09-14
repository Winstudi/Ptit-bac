"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const wheelPath = path.join(root, "letter-wheel-v1.js");
const soundPath = path.join(root, "letter-wheel-spin.wav");

function log(message) {
  console.log(`[Frontend cleanup] ${message}`);
}

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
  const pattern = /  const WHEEL_SPIN_AUDIO\s*=\s*\n\s*"data:audio\/wav;base64,([A-Za-z0-9+/=]+)";/;
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

  const replacement = '  const WHEEL_SPIN_AUDIO = "/letter-wheel-spin.wav";';
  return {
    source: source.replace(match[0], replacement),
    changed: true,
    bytes: audio.length
  };
}

function removeDeadWheelLines(source) {
  let result = source;

  // Le CSS est maintenant chargé par letter-wheel-fx-v1.css.
  result = result.replace(/\n\s*ensureWheelFxStyles\(\);\s*\n/, "\n");

  // Helper historique non utilisé dans la roue actuelle.
  if ((result.match(/\beaseOutQuint\b/g) || []).length === 1) {
    result = result.replace(/^\s*const easeOutQuint = .*?;\s*\n/m, "");
  }

  return result;
}

function main() {
  if (!fs.existsSync(wheelPath)) {
    log("letter-wheel-v1.js absent : nettoyage ignoré.");
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
    const saved = Buffer.byteLength(original) - Buffer.byteLength(source);
    log(`letter-wheel-v1.js allégé de ${(saved / 1024).toFixed(1)} Ko.`);
  } else {
    log("aucune transformation nécessaire sur letter-wheel-v1.js.");
  }

  if (audio.bytes > 0) {
    log(`son de roue extrait : ${(audio.bytes / 1024).toFixed(1)} Ko -> letter-wheel-spin.wav.`);
  }

  if (fx.changed) {
    log("ancien injecteur CSS de la roue supprimé du build servi.");
  }
}

main();
