"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const engine = require("./validation-engine-v26.cjs");
const { patchServerSource } = require("./apply-validation-v26.cjs");

test("le budget Structured Output est renforcé", () => {
  assert.equal(engine.outputTokenBudget(1, false), 900);
  assert.ok(engine.outputTokenBudget(12, false) >= 1700);
  assert.ok(engine.outputTokenBudget(12, true) > engine.outputTokenBudget(12, false));
  assert.ok(engine.outputTokenBudget(100, true) <= 5200);
});

test("le fallback ne touche que les réponses encore pending", () => {
  const items = [
    { id:"a", category:"Animal", status:"valid", aiConfidence:96 },
    { id:"b", category:"Animal", status:"pending", aiConfidence:62 },
    { id:"c", category:"Animal", status:"invalid", aiConfidence:94 }
  ];

  const changed = engine.markPendingUnverified(items, {
    code:"validation_timeout",
    source:"fallback",
    resetConfidence:true
  });

  assert.equal(changed, 1);
  assert.equal(items[0].status, "valid");
  assert.equal(items[0].aiConfidence, 96);
  assert.equal(items[1].status, "unverified");
  assert.equal(items[1].reason, "validation_timeout");
  assert.equal(items[1].aiConfidence, 0);
  assert.equal(items[2].status, "invalid");
});

test("une ambiguïté finale conserve la confiance obtenue", () => {
  const items = [{ status:"pending", aiConfidence:74, primaryDecision:{ verdict:"uncertain" } }];
  engine.markPendingUnverified(items, {
    code:"review_unresolved",
    source:"ai_review",
    resetConfidence:false
  });
  assert.equal(items[0].status, "unverified");
  assert.equal(items[0].aiConfidence, 74);
  assert.equal("primaryDecision" in items[0], false);
});

function serverFixture() {
  return String.raw`
const validationEngine = require("./validation-engine-v24.cjs");
const validationCacheStore = require("./validation-cache-v25.cjs");
const publicBotEngine = require("./public-bot-engine-v1.cjs");
const VALIDATION_ENGINE_VERSION = "v2.5.0";
const AUTO_VALIDATION_TIMEOUT_MS = Math.max(
  5000,
  Math.min(
    15000,
    Number(process.env.AUTO_VALIDATION_TIMEOUT_MS) || 9000
  )
);
const AUTO_VALIDATION_HARD_LIMIT_MS = Math.max(
  10000,
  Math.min(
    25000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 18000
  )
);
const OPENAI_VALIDATION_BATCH_SIZE = Math.max(
  5,
  Math.min(
    30,
    Number(process.env.OPENAI_VALIDATION_BATCH_SIZE) || 20
  )
);
const OPENAI_VALIDATION_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.OPENAI_VALIDATION_CONCURRENCY) || 3));
function completeValidationFallback(
  room,
  roundAtStart,
  { code = "validation_fallback", message = "Certaines réponses n’ont pas pu être vérifiées à temps." } = {}
) {
  const current = rooms.get(room?.code);
  if (!current || current !== room || current.phase !== "validation" || current.roundIndex !== roundAtStart || !current.validation || current.validation.status === "complete") return false;
  const validation = current.validation;
  const neutralCategories = new Set((validation.items || []).filter(item => item.status === "pending").map(item => item.category));
  for (const item of validation.items || []) {
    if (!neutralCategories.has(item.category)) continue;
    item.status = "unverified";
    item.reason = code;
    item.validationSource = "fallback";
    item.aiConfidence = 0;
    item.correction = "";
    delete item.primaryDecision;
  }
  validation.neutralCategories = [...new Set([...(validation.neutralCategories || []), ...neutralCategories])];
  validation.status = "complete";
  validation.error = { code, status:null, message };
  if (validation.watchdogId) { clearTimeout(validation.watchdogId); validation.watchdogId = null; }
  emitRoom(current);
  setTimeout(() => {
    const latest = rooms.get(current.code);
    if (latest === current && latest.phase === "validation" && latest.roundIndex === roundAtStart) finalizeRound(latest);
  }, 650);
  return true;
}

async function runAutomaticValidation(room, roundAtStart) {
  const validation = room.validation;
  const neutralCategories = new Set(validation.neutralCategories || []);
  for (const item of validation.items) {
    if (item.status === "pending") neutralCategories.add(item.category);
  }

  if (neutralCategories.size) {
    for (const item of validation.items) {
      if (!neutralCategories.has(item.category)) continue;
      item.status = "unverified";
      item.reason = item.reason || "review_unresolved";
      item.validationSource = item.validationSource || "ai_review";
      item.aiConfidence = Number(item.aiConfidence || 0);
      item.correction = "";
      delete item.primaryDecision;
    }
    validation.neutralCategories = [...neutralCategories];
  }
}

function finalizeRound(room) {
  const round = room.roundIndex;
  const scores = {};
  const neutralCategories = new Set(room.validation?.neutralCategories || []);

  room.players.forEach(player => {
    let gained = 0;
    room.categories.forEach(category => {
      if (neutralCategories.has(category)) return;
      const auto = room.validation.autoResults[player.id]?.[category];
      if (auto) return;
      const item = room.validation.items.find(i => i.playerId === player.id && i.category === category);
      if (item?.status === "valid") gained += 1;
    });
    player.score += gained;
    scores[player.id] = gained;
  });
}
`;
}

test("le patch v2.6 supprime l'effet domino par catégorie", () => {
  const result = patchServerSource(serverFixture());
  assert.equal(result.changed, true);
  assert.match(result.source, /VALIDATION_ENGINE_VERSION = "v2\.6\.0"/);
  assert.match(result.source, /validation-engine-v26\.cjs/);
  assert.match(result.source, /markPendingUnverified/);
  assert.doesNotMatch(result.source, /neutralCategories\.has\(category\)/);
  assert.match(result.source, /validation\.neutralCategories = \[\];/);
  new vm.Script(result.source);
});

test("le patch augmente les délais et réduit les lots par défaut", () => {
  const result = patchServerSource(serverFixture());
  assert.match(result.source, /AUTO_VALIDATION_TIMEOUT_MS\) \|\| 7500/);
  assert.match(result.source, /AUTO_VALIDATION_HARD_LIMIT_MS\) \|\| 24000/);
  assert.match(result.source, /AUTO_VALIDATION_TIMEOUT_MS \* 2 \+ 3500/);
  assert.match(result.source, /OPENAI_VALIDATION_BATCH_SIZE\) \|\| 12/);
});

test("le patch est idempotent sur sa sortie", () => {
  const first = patchServerSource(serverFixture());
  const second = patchServerSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});
