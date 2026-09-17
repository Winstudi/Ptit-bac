"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SERVER_FILE = path.join(__dirname, "server.js");
const TARGET_VERSION = "v2.6.0";

function fail(message) {
  throw new Error(`Validation v2.6: ${message}`);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) fail(`ancre introuvable (${label}).`);
  if (source.indexOf(search, first + search.length) >= 0) {
    fail(`ancre non unique (${label}).`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    fail(`${label}: ${matches.length} occurrence(s), 1 attendue.`);
  }
  return source.replace(regex, replacement);
}

function assertJavaScriptSyntax(source, filename) {
  try {
    new vm.Script(String(source || ""), { filename });
  } catch (err) {
    fail(`syntaxe invalide après patch (${filename}): ${err.message}`);
  }
}

function patchServerSource(input) {
  let source = String(input || "");

  const alreadyComplete =
    source.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    source.includes('require("./validation-engine-v26.cjs")') &&
    source.includes("validationEngine.markPendingUnverified(") &&
    source.includes("OPENAI_VALIDATION_BATCH_SIZE) || 12") &&
    !source.includes("neutralCategories.has(category)");

  if (alreadyComplete) return { source, changed:false };

  if (!source.includes('require("./validation-cache-v25.cjs")')) {
    fail("la v2.5 du cache doit être appliquée avant la v2.6");
  }
  if (!source.includes('require("./public-bot-engine-v1.cjs")')) {
    fail("les bots publics actuels doivent être appliqués avant la v2.6");
  }

  source = replaceOnce(
    source,
    'const validationEngine = require("./validation-engine-v24.cjs");',
    'const validationEngine = require("./validation-engine-v26.cjs");',
    "moteur helper v2.6"
  );

  source = replaceOnce(
    source,
    'const VALIDATION_ENGINE_VERSION = "v2.5.0";',
    `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
    "version moteur"
  );

  source = replaceRegexOnce(
    source,
    /const AUTO_VALIDATION_TIMEOUT_MS = Math\.max\([\s\S]*?\n\);\nconst AUTO_VALIDATION_HARD_LIMIT_MS = Math\.max\([\s\S]*?\n\);/,
    `const AUTO_VALIDATION_TIMEOUT_MS = Math.max(
  4000,
  Math.min(
    10000,
    Number(process.env.AUTO_VALIDATION_TIMEOUT_MS) || 7500
  )
);
const AUTO_VALIDATION_HARD_LIMIT_MS = Math.min(
  32000,
  Math.max(
    18000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 24000,
    AUTO_VALIDATION_TIMEOUT_MS * 2 + 3500
  )
);`,
    "timeouts cohérents"
  );

  source = replaceRegexOnce(
    source,
    /const OPENAI_VALIDATION_BATCH_SIZE = Math\.max\([\s\S]*?\n\);\nconst OPENAI_VALIDATION_CONCURRENCY =/,
    `const OPENAI_VALIDATION_BATCH_SIZE = Math.max(
  5,
  Math.min(
    16,
    Number(process.env.OPENAI_VALIDATION_BATCH_SIZE) || 12
  )
);
const OPENAI_VALIDATION_CONCURRENCY =`,
    "taille lots v2.6"
  );

  const fallback = `function completeValidationFallback(
  room,
  roundAtStart,
  {
    code = "validation_fallback",
    message = "Certaines réponses n’ont pas pu être vérifiées à temps."
  } = {}
) {
  const current = rooms.get(room?.code);
  if (
    !current ||
    current !== room ||
    current.phase !== "validation" ||
    current.roundIndex !== roundAtStart ||
    !current.validation ||
    current.validation.status === "complete"
  ) {
    return false;
  }

  const validation = current.validation;

  // v2.6 : un problème sur UNE réponse ne neutralise plus les autres joueurs
  // de la même catégorie. Les décisions déjà obtenues restent intactes.
  validationEngine.markPendingUnverified(validation.items, {
    code,
    source:"fallback",
    resetConfidence:true
  });
  validation.neutralCategories = [];
  validation.status = "complete";
  validation.error = {
    code,
    status:null,
    message
  };

  if (validation.watchdogId) {
    clearTimeout(validation.watchdogId);
    validation.watchdogId = null;
  }

  emitRoom(current);

  setTimeout(() => {
    const latest = rooms.get(current.code);
    if (
      latest === current &&
      latest.phase === "validation" &&
      latest.roundIndex === roundAtStart
    ) {
      finalizeRound(latest);
    }
  }, 650);

  return true;
}`;

  source = replaceRegexOnce(
    source,
    /function completeValidationFallback\([\s\S]*?\n\}\n\nasync function runAutomaticValidation/,
    `${fallback}\n\nasync function runAutomaticValidation`,
    "fallback individuel"
  );

  source = replaceRegexOnce(
    source,
    /  const neutralCategories = new Set\(validation\.neutralCategories \|\| \[\]\);\n  for \(const item of validation\.items\) \{\n    if \(item\.status === "pending"\) neutralCategories\.add\(item\.category\);\n  \}\n\n  if \(neutralCategories\.size\) \{[\s\S]*?\n    validation\.neutralCategories = \[\.\.\.neutralCategories\];\n  \}/,
    `  // Une ambiguïté restante concerne uniquement l'item en question.
  // Les réponses déjà validées/refusées gardent leur décision et leurs points.
  validationEngine.markPendingUnverified(validation.items, {
    code:"review_unresolved",
    source:"ai_review",
    resetConfidence:false
  });
  validation.neutralCategories = [];`,
    "fin de validation individuelle"
  );

  source = source.replace(
    '  const neutralCategories = new Set(room.validation?.neutralCategories || []);\n\n  room.players.forEach(player => {',
    '  room.players.forEach(player => {'
  );
  source = source.replace(
    '      if (neutralCategories.has(category)) return;\n',
    ''
  );

  // Le cache v2.5 est volontairement isolé par version : v2.6 ne réutilise
  // pas les anciennes décisions potentiellement issues du comportement global.

  const requiredMarkers = [
    `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
    'require("./validation-engine-v26.cjs")',
    "validationEngine.markPendingUnverified(",
    "Number(process.env.OPENAI_VALIDATION_BATCH_SIZE) || 12",
    "AUTO_VALIDATION_TIMEOUT_MS * 2 + 3500",
    "validation.neutralCategories = [];"
  ];

  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) fail(`patch incomplet (${marker})`);
  }
  if (source.includes("neutralCategories.has(category)")) {
    fail("ancien scoring par catégorie neutre encore présent");
  }

  assertJavaScriptSyntax(source, "server.js");
  return { source, changed:true };
}

function applyPatch() {
  if (!fs.existsSync(SERVER_FILE)) fail("server.js introuvable.");

  const initial = fs.readFileSync(SERVER_FILE, "utf8");
  const v26Ready =
    initial.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    initial.includes('require("./validation-engine-v26.cjs")');

  // Ne pas relancer les anciens patchers une fois v2.6 appliquée : v2.5 appelle
  // encore v2.4 et attend son ancienne version exacte.
  if (!v26Ready) {
    require("./apply-public-bots-v1.cjs").applyPatch();
  }

  const before = fs.readFileSync(SERVER_FILE, "utf8");
  const result = patchServerSource(before);

  if (result.changed) {
    const tmp = `${SERVER_FILE}.validation-v26.tmp`;
    fs.writeFileSync(tmp, result.source, "utf8");
    fs.renameSync(tmp, SERVER_FILE);
  }

  console.log(
    `Validation ${TARGET_VERSION}: correction individuelle active ` +
    "(plus d'effet domino, budget IA renforcé, délais cohérents)."
  );
}

if (require.main === module) applyPatch();

module.exports = {
  TARGET_VERSION,
  patchServerSource,
  applyPatch
};
