"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("./validation-engine-v23.cjs");
const { patchServerSource } = require("./apply-validation-v23.cjs");

test("les seuils stricts restent différents selon le type de catégorie", () => {
  assert.deepEqual(
    engine.decisionThresholds("subjective"),
    { valid: 76, invalid: 78 }
  );
  assert.deepEqual(
    engine.decisionThresholds("factual"),
    { valid: 82, invalid: 80 }
  );
  assert.deepEqual(
    engine.decisionThresholds("lexical"),
    { valid: 88, invalid: 82 }
  );
});

test("le schéma IA v2.3 supprime l'explication libre systématique", () => {
  const schema = engine.validationSchema("validation_test");
  const item = schema.schema.properties.results.items;

  assert.equal(item.additionalProperties, false);
  assert.equal("explanation" in item.properties, false);
  assert.deepEqual(
    item.required,
    [
      "id",
      "verdict",
      "confidence",
      "reason_code",
      "canonical_answer",
      "correction"
    ]
  );
});

test("le budget de sortie est nettement plus compact que l'ancien moteur", () => {
  assert.ok(engine.outputTokenBudget(20, false) < 20 * 150);
  assert.ok(engine.outputTokenBudget(20, true) < 20 * 150);
  assert.ok(engine.outputTokenBudget(60, false) <= 3600);
});

test("les lots s'exécutent en parallèle sans dépasser la concurrence", async () => {
  let active = 0;
  let maxActive = 0;

  const result = await engine.mapWithConcurrency(
    [1, 2, 3, 4, 5, 6],
    3,
    async value => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return value * 10;
    }
  );

  assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
  assert.equal(maxActive, 3);
});

test("le patch v2.3 est idempotent et retire le seuil rapide à 76 %", () => {
  const fixture = `
} = require("./game-loop-rules.js");
const {
  DEFAULT_COINS,
const VALIDATION_ENGINE_VERSION = "v2.2.0";
const AUTO_VALIDATION_HARD_LIMIT_MS = Math.max(
  10000,
  Math.min(
    25000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 18000
  )
);
function validationSchema(name) {
  return {
    type: "json_schema",
    schema: {}
  };
}

const VALIDATION_SYSTEM_PROMPT = \`
prompt
\`;
max_output_tokens: Math.max(900, Math.min(6000, items.length * 150))
function decisionThresholds(category) {
  const type = categoryRule(category).type;
  if (type === "subjective") return { valid: 76, invalid: 78 };
  if (type === "lexical") return { valid: 88, invalid: 82 };
  return { valid: 82, invalid: 80 };
}

function normalizeAiResult(raw) {
  return raw;
}
async function validateInBatches(items, letter, options = {}) {
  const all = [];
  const batchSize = Math.max(1, Math.min(15, Number(process.env.OPENAI_VALIDATION_BATCH_SIZE) || 15));
  for (let i = 0; i < items.length; i += batchSize) {
    all.push(...items.slice(i, i + batchSize));
  }
  return all;
}

function completeValidationFallback() {}
          // Mode rapide : une décision explicite >= 76% évite un second appel.
          // La seconde passe est réservée aux véritables cas ambigus.
          if (normalized.verdict === "valid" && normalized.confidence >= 76) {
            applyAiDecision(item, result, letter, "ai_primary_fast");
          } else if (normalized.verdict === "invalid" && normalized.confidence >= 76) {
            applyAiDecision(item, result, letter, "ai_primary_fast");
          } else {
            needsReview.push(item);
          }
`;

  const first = patchServerSource(fixture);
  assert.equal(first.changed, true);
  assert.match(first.source, /VALIDATION_ENGINE_VERSION = "v2\.3\.0"/);
  assert.match(first.source, /OPENAI_VALIDATION_CONCURRENCY/);
  assert.match(first.source, /mapWithConcurrency/);
  assert.doesNotMatch(first.source, /ai_primary_fast/);

  const second = patchServerSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});
