"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SERVER_FILE = path.join(__dirname, "server.js");
const TARGET_VERSION = "v2.3.0";

function fail(message) {
  throw new Error(`Validation v2.3: ${message}`);
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
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g"))];
  if (matches.length !== 1) {
    fail(`${label}: ${matches.length} occurrence(s), 1 attendue.`);
  }
  return source.replace(regex, replacement);
}

function patchServerSource(input) {
  let source = String(input || "");

  if (
    source.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    source.includes('require("./validation-engine-v23.cjs")')
  ) {
    return { source, changed: false };
  }

  source = replaceOnce(
    source,
    '} = require("./game-loop-rules.js");\nconst {\n  DEFAULT_COINS,',
    '} = require("./game-loop-rules.js");\nconst validationEngine = require("./validation-engine-v23.cjs");\nconst {\n  DEFAULT_COINS,',
    "import validation-engine-v23"
  );

  source = replaceOnce(
    source,
    'const VALIDATION_ENGINE_VERSION = "v2.2.0";',
    `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
    "version moteur"
  );

  const hardLimitBlock = `const AUTO_VALIDATION_HARD_LIMIT_MS = Math.max(
  10000,
  Math.min(
    25000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 18000
  )
);`;

  source = replaceOnce(
    source,
    hardLimitBlock,
    `${hardLimitBlock}
const OPENAI_VALIDATION_BATCH_SIZE = Math.max(
  5,
  Math.min(
    30,
    Number(process.env.OPENAI_VALIDATION_BATCH_SIZE) || 20
  )
);
const OPENAI_VALIDATION_CONCURRENCY = Math.max(
  1,
  Math.min(
    4,
    Number(process.env.OPENAI_VALIDATION_CONCURRENCY) || 3
  )
);`,
    "configuration lots/concurrence"
  );

  source = replaceRegexOnce(
    source,
    /function validationSchema\(name\) \{[\s\S]*?\n\}\n\nconst VALIDATION_SYSTEM_PROMPT = `/,
    `function validationSchema(name) {
  return validationEngine.validationSchema(name);
}

const VALIDATION_SYSTEM_PROMPT = \``,
    "schéma Structured Outputs compact"
  );

  source = replaceOnce(
    source,
    'max_output_tokens: Math.max(900, Math.min(6000, items.length * 150))',
    'max_output_tokens: validationEngine.outputTokenBudget(items.length, review)',
    "budget tokens"
  );

  source = replaceRegexOnce(
    source,
    /function decisionThresholds\(category\) \{[\s\S]*?\n\}\n\nfunction normalizeAiResult/,
    `function decisionThresholds(category) {
  return validationEngine.decisionThresholds(categoryRule(category).type);
}

function normalizeAiResult`,
    "seuils de décision"
  );

  source = replaceRegexOnce(
    source,
    /async function validateInBatches\(items, letter, options = \{\}\) \{[\s\S]*?\n\}\n\nfunction completeValidationFallback/,
    `async function validateInBatches(items, letter, options = {}) {
  const batches = [];
  for (let i = 0; i < items.length; i += OPENAI_VALIDATION_BATCH_SIZE) {
    batches.push(items.slice(i, i + OPENAI_VALIDATION_BATCH_SIZE));
  }

  const groupedResults = await validationEngine.mapWithConcurrency(
    batches,
    OPENAI_VALIDATION_CONCURRENCY,
    async batch => {
      let results = null;
      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          results = await callValidationModel(batch, letter, options);
          break;
        } catch (err) {
          lastError = err;
          if (!err?.retryable || attempt >= 2) throw err;
          await wait(450 * attempt);
        }
      }

      if (!results) {
        throw lastError || new OpenAIRequestError(
          "Aucun résultat de validation",
          { code: "missing_results", retryable: true }
        );
      }

      const returnedIds = new Set(
        results.map(result => result?.id).filter(Boolean)
      );

      if (batch.some(item => !returnedIds.has(item.id))) {
        throw new OpenAIRequestError(
          "Réponse IA incomplète",
          { code: "incomplete_results", retryable: true }
        );
      }

      return results;
    }
  );

  return groupedResults.flat();
}

function completeValidationFallback`,
    "validation parallèle"
  );

  source = replaceRegexOnce(
    source,
    /          \/\/ Mode rapide : une décision explicite >= 76% évite un second appel\.\n          \/\/ La seconde passe est réservée aux véritables cas ambigus\.\n          if \(normalized\.verdict === "valid" && normalized\.confidence >= 76\) \{\n            applyAiDecision\(item, result, letter, "ai_primary_fast"\);\n          \} else if \(normalized\.verdict === "invalid" && normalized\.confidence >= 76\) \{\n            applyAiDecision\(item, result, letter, "ai_primary_fast"\);\n          \} else \{\n            needsReview\.push\(item\);\n          \}/,
    `          // v2.3 : aucun seuil universel à 76 %.
          // Si la décision n'atteint pas le seuil propre à sa catégorie,
          // elle passe en seconde vérification.
          needsReview.push(item);`,
    "suppression seuil rapide universel"
  );

  return { source, changed: true };
}

function applyPatch() {
  if (!fs.existsSync(SERVER_FILE)) {
    fail("server.js introuvable.");
  }

  const before = fs.readFileSync(SERVER_FILE, "utf8");
  const result = patchServerSource(before);

  if (!result.changed) {
    console.log(`Validation ${TARGET_VERSION}: server.js déjà à jour.`);
    return;
  }

  const temp = `${SERVER_FILE}.validation-v23.tmp`;
  fs.writeFileSync(temp, result.source, "utf8");
  fs.renameSync(temp, SERVER_FILE);

  console.log(
    `Validation ${TARGET_VERSION}: moteur appliqué à server.js ` +
    "(lots parallèles, seuils stricts, sortie IA compacte)."
  );
}

if (require.main === module) {
  applyPatch();
}

module.exports = {
  TARGET_VERSION,
  patchServerSource,
  applyPatch
};
