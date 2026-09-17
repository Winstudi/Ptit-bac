"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { patchServerSource } = require("./apply-validation-v27.cjs");

function fixture() {
  return String.raw`
const validationEngine = require("./validation-engine-v26.cjs");
const VALIDATION_ENGINE_VERSION = "v2.6.0";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_VALIDATION_MODEL = process.env.OPENAI_VALIDATION_MODEL || "gpt-5-mini";
const OPENAI_VALIDATION_REVIEW_MODEL = process.env.OPENAI_VALIDATION_REVIEW_MODEL || OPENAI_VALIDATION_MODEL;

const AUTO_VALIDATION_TIMEOUT_MS = Math.max(
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
);

async function testOpenAIConnection() {
  const body = {
    model: OPENAI_VALIDATION_MODEL,
    store: false,
    input: "Réponds uniquement: OK",
    max_output_tokens: 32
  };
  return body;
}

async function callValidationModel(items, letter, { review = false } = {}) {
  const body = {
    model: review ? OPENAI_VALIDATION_REVIEW_MODEL : OPENAI_VALIDATION_MODEL,
    store: false,
    reasoning: { effort: review ? "medium" : "low" },
    input: JSON.stringify(items)
  };
  return body;
}
`;
}

test("la v2.7 passe la correction par défaut sur GPT-5.6 Luna", () => {
  const result = patchServerSource(fixture());
  assert.equal(result.changed, true);
  assert.match(result.source, /DEFAULT_VALIDATION_MODEL = "gpt-5\.6-luna"/);
  assert.match(result.source, /configured === "gpt-5-mini"/);
  assert.match(result.source, /VALIDATION_ENGINE_VERSION = "v2\.7\.0"/);
});

test("la première passe n'utilise plus de reasoning coûteux en latence", () => {
  const result = patchServerSource(fixture());
  assert.match(result.source, /effort: review \? "low" : "none"/);
  assert.match(result.source, /reasoning: \{ effort: "none" \}/);
});

test("le timeout laisse plus de marge sans bloquer une manche trop longtemps", () => {
  const result = patchServerSource(fixture());
  assert.match(result.source, /AUTO_VALIDATION_TIMEOUT_MS\) \|\| 11000/);
  assert.match(result.source, /AUTO_VALIDATION_HARD_LIMIT_MS\) \|\| 30000/);
  assert.match(result.source, /AUTO_VALIDATION_TIMEOUT_MS \* 2 \+ 5000/);
});

test("le serveur généré reste syntaxiquement valide", () => {
  const result = patchServerSource(fixture());
  new vm.Script(result.source);
});

test("le patch est idempotent", () => {
  const first = patchServerSource(fixture());
  const second = patchServerSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});
