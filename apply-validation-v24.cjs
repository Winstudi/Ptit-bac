"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SERVER_FILE = path.join(__dirname, "server.js");
const TARGET_VERSION = "v2.4.0";

function fail(message) {
  throw new Error(`Validation v2.4: ${message}`);
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

function patchServerSource(input) {
  let source = String(input || "");

  const alreadyComplete =
    source.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    source.includes('require("./validation-engine-v24.cjs")') &&
    source.includes("function queuePlayerValidationPrewarm(") &&
    source.includes("OPENAI_VALIDATION_CONCURRENCY") &&
    !source.includes("ai_primary_fast");

  if (alreadyComplete) return { source, changed: false };

  if (source.includes('require("./validation-engine-v23.cjs")')) {
    source = source.replace(
      'require("./validation-engine-v23.cjs")',
      'require("./validation-engine-v24.cjs")'
    );
  } else if (!source.includes('require("./validation-engine-v24.cjs")')) {
    source = replaceOnce(
      source,
      '} = require("./game-loop-rules.js");\nconst {\n  DEFAULT_COINS,',
      '} = require("./game-loop-rules.js");\nconst validationEngine = require("./validation-engine-v24.cjs");\nconst {\n  DEFAULT_COINS,',
      "import validation-engine-v24"
    );
  }

  if (!source.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`)) {
    source = replaceRegexOnce(
      source,
      /const VALIDATION_ENGINE_VERSION = "v2\.(?:2\.0|3\.0|3\.1)";/,
      `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
      "version moteur"
    );
  }

  const hardLimitBlock = `const AUTO_VALIDATION_HARD_LIMIT_MS = Math.max(
  10000,
  Math.min(
    25000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 18000
  )
);`;

  if (!source.includes("const OPENAI_VALIDATION_CONCURRENCY =")) {
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
  }

  if (!source.includes("const validationPrewarmJobs = new Map();")) {
    source = replaceOnce(
      source,
      "let reportWorkerRunning = false;",
      "let reportWorkerRunning = false;\nconst validationPrewarmJobs = new Map();",
      "registre prévalidation"
    );
  }

  source = replaceRegexOnce(
    source,
    /function validationSchema\(name\) \{[\s\S]*?\n\}\n\nconst VALIDATION_SYSTEM_PROMPT = `+/,
    'function validationSchema(name) {\n  return validationEngine.validationSchema(name);\n}\n\nconst VALIDATION_SYSTEM_PROMPT = `',
    "schéma Structured Outputs compact"
  );

  // Répare aussi une éventuelle exécution locale du patch v2.3 défectueux.
  source = source.replace(
    "const VALIDATION_SYSTEM_PROMPT = ``",
    "const VALIDATION_SYSTEM_PROMPT = `"
  );

  if (source.includes("max_output_tokens: Math.max(900, Math.min(6000, items.length * 150))")) {
    source = replaceOnce(
      source,
      "max_output_tokens: Math.max(900, Math.min(6000, items.length * 150))",
      "max_output_tokens: validationEngine.outputTokenBudget(items.length, review)",
      "budget tokens"
    );
  }

  if (!source.includes("return validationEngine.decisionThresholds(categoryRule(category).type);")) {
    source = replaceRegexOnce(
      source,
      /function decisionThresholds\(category\) \{[\s\S]*?\n\}\n\nfunction normalizeAiResult/,
      `function decisionThresholds(category) {
  return validationEngine.decisionThresholds(categoryRule(category).type);
}

function normalizeAiResult`,
      "seuils de décision"
    );
  }

  const batchAndPrewarm = `async function validateInBatches(items, letter, options = {}) {
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

function validationPrewarmKey(room, player, roundIndex) {
  return \`${"${room.code}:${roundIndex}:${player.id}"}\`;
}

function prewarmItemsForPlayer(room, player, roundIndex) {
  const letter = room.letters[roundIndex];
  const items = [];

  for (const category of room.categories) {
    const answer = String(player.answers?.[roundIndex]?.[category] || "").trim();
    if (!answer || !startsWithLetter(answer, letter)) continue;
    if (category === "Mot de 4 lettres" && countLetters(answer) !== 4) continue;

    items.push({
      id: id(),
      category,
      playerId: player.id,
      playerName: player.name,
      answer,
      status: "pending",
      reason: "",
      correction: ""
    });
  }

  return items;
}

function queuePlayerValidationPrewarm(room, player) {
  if (!OPENAI_API_KEY || !room || !player || room.phase !== "round") return null;

  const roundIndex = room.roundIndex;
  const key = validationPrewarmKey(room, player, roundIndex);
  const existing = validationPrewarmJobs.get(key);
  if (existing) return existing;

  const job = (async () => {
    const letter = room.letters[roundIndex];
    const items = prewarmItemsForPlayer(room, player, roundIndex);
    const unresolved = [];

    for (const item of items) {
      const local = localSemanticDecision(item);
      if (local) continue;

      const learned = learnedAnswers.get(
        learnedAnswerKey(item.category, item.answer)
      );
      if (
        learned &&
        ["valid", "invalid"].includes(learned.status) &&
        Number(learned.confidence || 0) >= 95
      ) {
        continue;
      }

      const cached = validationCache.get(
        validationCacheKey(item.category, item.answer)
      );
      if (cached && cached.engineVersion === VALIDATION_ENGINE_VERSION) {
        continue;
      }

      unresolved.push(item);
    }

    if (!unresolved.length) return;

    const primaryResults = await validateInBatches(
      unresolved,
      letter,
      { review: false }
    );
    const primaryById = new Map(
      primaryResults.map(result => [result.id, result])
    );
    let cacheChanged = false;

    for (const item of unresolved) {
      const result = primaryById.get(item.id);
      if (!shouldAcceptPrimary(item, result)) continue;
      if (!applyAiDecision(item, result, letter, "ai_prewarm")) continue;
      if (!shouldCacheDecision(item)) continue;

      validationCache.set(
        validationCacheKey(item.category, item.answer),
        {
          engineVersion: VALIDATION_ENGINE_VERSION,
          status: item.status,
          reason: item.reason,
          correction: item.correction || "",
          canonicalAnswer: item.canonicalAnswer || "",
          confidence: item.aiConfidence || 0,
          explanation: item.aiExplanation || "",
          updatedAt: Date.now()
        }
      );
      cacheChanged = true;
    }

    if (cacheChanged) saveValidationCache();
  })()
    .catch(err => {
      // La prévalidation est uniquement une optimisation : son échec ne doit
      // jamais modifier la manche ni afficher une erreur aux joueurs.
      console.warn(
        "Prévalidation silencieuse:",
        sanitizeOpenAIErrorMessage(err?.message)
      );
    })
    .finally(() => {
      validationPrewarmJobs.delete(key);
    });

  validationPrewarmJobs.set(key, job);
  return job;
}`;

  source = replaceRegexOnce(
    source,
    /async function validateInBatches\(items, letter, options = \{\}\) \{[\s\S]*?\n\nfunction completeValidationFallback/,
    `${batchAndPrewarm}\n\nfunction completeValidationFallback`,
    "validation parallèle et prévalidation"
  );

  if (source.includes('"ai_primary_fast"')) {
    source = replaceRegexOnce(
      source,
      /          \/\/ Mode rapide : une décision explicite >= 76% évite un second appel\.\n          \/\/ La seconde passe est réservée aux véritables cas ambigus\.\n          if \(normalized\.verdict === "valid" && normalized\.confidence >= 76\) \{\n            applyAiDecision\(item, result, letter, "ai_primary_fast"\);\n          \} else if \(normalized\.verdict === "invalid" && normalized\.confidence >= 76\) \{\n            applyAiDecision\(item, result, letter, "ai_primary_fast"\);\n          \} else \{\n            needsReview\.push\(item\);\n          \}/,
      `          // Les seuils propres à la catégorie sont désormais stricts.
          // Tout cas sous le seuil passe à la seconde vérification.
          needsReview.push(item);`,
      "suppression seuil rapide universel"
    );
  }

  if (!source.includes("queuePlayerValidationPrewarm(room, player);")) {
    source = replaceOnce(
      source,
      `    player.submitted = true;
    emitRoom(room);

    // Dès que tous les joueurs ont validé, la manche se termine.
    if (room.players.every(p => p.submitted)) endRound(room);`,
      `    player.submitted = true;
    const allSubmitted = room.players.every(p => p.submitted);

    // Prévalidation invisible : on profite du temps restant pendant que les
    // autres joueurs répondent. Le dernier joueur ne lance pas de doublon.
    if (!allSubmitted) queuePlayerValidationPrewarm(room, player);

    emitRoom(room);

    // Dès que tous les joueurs ont validé, la manche se termine.
    if (allSubmitted) endRound(room);`,
      "prévalidation au submit"
    );
  }

  return { source, changed: true };
}

function applyPatch() {
  if (!fs.existsSync(SERVER_FILE)) fail("server.js introuvable.");

  const before = fs.readFileSync(SERVER_FILE, "utf8");
  const result = patchServerSource(before);

  if (!result.changed) {
    console.log(`Validation ${TARGET_VERSION}: server.js déjà à jour.`);
    return;
  }

  const temp = `${SERVER_FILE}.validation-v24.tmp`;
  fs.writeFileSync(temp, result.source, "utf8");
  fs.renameSync(temp, SERVER_FILE);
  console.log(
    `Validation ${TARGET_VERSION}: moteur appliqué ` +
    "(lots parallèles, seuils stricts, sortie compacte, prévalidation silencieuse)."
  );
}

if (require.main === module) applyPatch();

module.exports = {
  TARGET_VERSION,
  patchServerSource,
  applyPatch
};
