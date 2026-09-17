"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const engine = require("./validation-engine-v24.cjs");
const { patchServerSource } = require("./apply-validation-v24.cjs");

function fixtureServer() {
  return `"use strict";
const {
  shouldRefundEntryOnLeave,
  isFinalScoreboard,
  nextHostCandidate,
  canAdvanceScoreboard
} = require("./game-loop-rules.js");
const {
  DEFAULT_COINS,
  MAX_LIVES: ECONOMY_MAX_LIVES
} = require("./economy-config.js");
const VALIDATION_ENGINE_VERSION = "v2.2.0";
const OPENAI_API_KEY = "x";
const AUTO_VALIDATION_HARD_LIMIT_MS = Math.max(
  10000,
  Math.min(
    25000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 18000
  )
);
const validationCache = new Map();
const learnedAnswers = new Map();
let reportWorkerRunning = false;
function normalizeAnswer(v){return String(v||"").toLowerCase();}
function startsWithLetter(a,l){return normalizeAnswer(a).startsWith(String(l||"").toLowerCase());}
function countLetters(v){return normalizeAnswer(v).replace(/[^a-z]/g,"").length;}
function id(){return "id";}
function learnedAnswerKey(c,a){return c+":"+a;}
function validationCacheKey(c,a){return c+":"+a;}
function saveValidationCache(){}
function sanitizeOpenAIErrorMessage(v){return String(v||"");}
function localSemanticDecision(){return null;}
function categoryRule(){return {type:"factual"};}
function validationSchema(name) {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { results: { type:"array", items:{ type:"object", properties:{ explanation:{type:"string"} } } } },
      required: ["results"]
    }
  };
}

const VALIDATION_SYSTEM_PROMPT = \`
prompt
\`;
function wait(ms){return Promise.resolve(ms);}
class OpenAIRequestError extends Error {}
async function callValidationModel(){return [];}
function decisionThresholds(category) {
  const type = categoryRule(category).type;
  if (type === "subjective") return { valid: 76, invalid: 78 };
  if (type === "lexical") return { valid: 88, invalid: 82 };
  return { valid: 82, invalid: 80 };
}

function normalizeAiResult(raw) {
  if (!raw) return null;
  return {
    verdict: raw.verdict,
    confidence: raw.confidence || 0,
    reasonCode: raw.reason_code || "other",
    explanation: raw.explanation || "",
    canonicalAnswer: raw.canonical_answer || "",
    correction: raw.correction || ""
  };
}
function applyAiDecision(item, raw){ item.status=raw.verdict; item.aiConfidence=raw.confidence||0; return true; }
function shouldAcceptPrimary(item, decision) {
  const normalized = normalizeAiResult(decision);
  if (!normalized) return false;
  const limits = decisionThresholds(item.category);
  if (normalized.verdict === "valid") return normalized.confidence >= limits.valid;
  if (normalized.verdict === "invalid") return normalized.confidence >= limits.invalid;
  return false;
}
function shouldCacheDecision(item){return ["valid","invalid"].includes(item.status) && Number(item.aiConfidence||0)>=90;}
async function validateInBatches(items, letter, options = {}) {
  const all = [];
  const batchSize = Math.max(1, Math.min(15, Number(process.env.OPENAI_VALIDATION_BATCH_SIZE) || 15));
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    let results = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { results = await callValidationModel(batch, letter, options); break; }
      catch (err) { lastError = err; if (!err?.retryable || attempt >= 2) throw err; await wait(900 * attempt); }
    }
    if (!results) throw lastError || new OpenAIRequestError("missing");
    all.push(...results);
  }
  return all;
}

function completeValidationFallback() {}
async function runAutomaticValidation() {
  const normalized = {verdict:"valid", confidence:80};
  const item = {};
  const result = {};
  const needsReview = [];
  const letter = "A";
          // Mode rapide : une décision explicite >= 76% évite un second appel.
          // La seconde passe est réservée aux véritables cas ambigus.
          if (normalized.verdict === "valid" && normalized.confidence >= 76) {
            applyAiDecision(item, result, letter, "ai_primary_fast");
          } else if (normalized.verdict === "invalid" && normalized.confidence >= 76) {
            applyAiDecision(item, result, letter, "ai_primary_fast");
          } else {
            needsReview.push(item);
          }
}
function socketFixture(socket) {
  socket.on("round:submit", payload => {
    const room = payload.room;
    const player = payload.player;
    if (!room || !player || room.phase !== "round") return;
    if (Date.now() < (room.roundStartsAt || 0)) return;
    player.submitted = true;
    emitRoom(room);

    // Dès que tous les joueurs ont validé, la manche se termine.
    if (room.players.every(p => p.submitted)) endRound(room);
  });
}
function emitRoom(){}
function endRound(){}
const max_output_tokens = Math.max(900, Math.min(6000, items.length * 150));
`;
}

test("seuils stricts par type", () => {
  assert.deepEqual(engine.decisionThresholds("subjective"), { valid:76, invalid:78 });
  assert.deepEqual(engine.decisionThresholds("factual"), { valid:82, invalid:80 });
  assert.deepEqual(engine.decisionThresholds("lexical"), { valid:88, invalid:82 });
});

test("schéma compact sans explication libre", () => {
  const item = engine.validationSchema("x").schema.properties.results.items;
  assert.equal("explanation" in item.properties, false);
  assert.deepEqual(item.required, ["id","verdict","confidence","reason_code","canonical_answer","correction"]);
});

test("budget de sortie réduit", () => {
  assert.ok(engine.outputTokenBudget(20, false) < 3000);
  assert.ok(engine.outputTokenBudget(60, false) <= 3600);
});

test("concurrence bornée à trois", async () => {
  let active = 0;
  let maxActive = 0;
  const values = await engine.mapWithConcurrency([1,2,3,4,5,6], 3, async value => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return value * 2;
  });
  assert.deepEqual(values, [2,4,6,8,10,12]);
  assert.equal(maxActive, 3);
});

test("le patch v2.4 produit un JavaScript syntaxiquement valide", () => {
  const result = patchServerSource(fixtureServer());
  assert.equal(result.changed, true);
  assert.match(result.source, /VALIDATION_ENGINE_VERSION = "v2\.4\.0"/);
  assert.match(result.source, /validation-engine-v24\.cjs/);
  assert.match(result.source, /queuePlayerValidationPrewarm\(room, player\)/);
  assert.match(result.source, /mapWithConcurrency/);
  assert.doesNotMatch(result.source, /ai_primary_fast/);
  assert.doesNotMatch(result.source, /VALIDATION_SYSTEM_PROMPT = ``/);
  assert.doesNotThrow(() => new vm.Script(result.source));
});

test("le patch est idempotent", () => {
  const first = patchServerSource(fixtureServer());
  const second = patchServerSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});
