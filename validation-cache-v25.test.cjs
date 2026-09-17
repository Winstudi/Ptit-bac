"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cache = require("./validation-cache-v25.cjs");
const {
  patchServerSource,
  patchMigrationsSource
} = require("./apply-validation-v25.cjs");

function payload(version, status = "valid", updatedAt = Date.now()) {
  return {
    engineVersion: version,
    status,
    reason: "recognized",
    correction: "",
    canonicalAnswer: "",
    confidence: 96,
    explanation: "",
    updatedAt
  };
}

test("le cache RAM se comporte comme un LRU borné", () => {
  const map = new Map();
  // Le helper impose un minimum de 100 entrées : on remplit donc 101 clés.
  for (let i = 0; i < 100; i++) {
    cache.put(map, `k${i}`, payload("v2.5.0", "valid", i + 1), 100);
  }
  assert.equal(map.size, 100);
  assert.ok(cache.touch(map, "k0"));
  cache.put(map, "k100", payload("v2.5.0", "valid", 101), 100);
  assert.equal(map.size, 100);
  assert.equal(map.has("k0"), true);
  assert.equal(map.has("k1"), false);
});

test("le trim mémoire borne aussi les écritures directes du serveur", () => {
  const map = new Map();
  for (let i = 0; i < 130; i++) map.set(`d${i}`, payload("v2.5.0", "valid", i + 1));
  cache.trim(map, 100);
  assert.equal(map.size, 100);
  assert.equal(map.has("d0"), false);
  assert.equal(map.has("d129"), true);
});

test("une ligne PostgreSQL d'une autre version n'est jamais réutilisée", () => {
  const row = {
    cache_key: "x",
    engine_version: "v2.4.0",
    payload: payload("v2.4.0"),
    updated_at: 1
  };
  assert.equal(cache.fromDatabaseRow(row, "v2.5.0"), null);
  assert.equal(cache.fromDatabaseRow(row, "v2.4.0")?.status, "valid");
});

test("l'upsert PostgreSQL reste paramétré et ne concatène pas les réponses", () => {
  const query = cache.buildUpsertQuery([
    ["v2.5.0|mot|bonjour", payload("v2.5.0")],
    ["v2.5.0|animal|chat", payload("v2.5.0", "invalid")]
  ]);
  assert.equal(query.count, 2);
  assert.equal(query.values.length, 8);
  assert.match(query.text, /ON CONFLICT\(cache_key\)/);
  assert.doesNotMatch(query.text, /bonjour|animal|chat/);
});

test("la migration ajoute une table et un index idempotents", () => {
  const fixture = `
  await pool.query(\`
    CREATE TABLE IF NOT EXISTS public.ptitbac_learned_answers(
      answer_key text PRIMARY KEY
    )
  \`);

  await pool.query(\`
    CREATE TABLE IF NOT EXISTS public.ptitbac_answer_reports(
      id text PRIMARY KEY
    )
  \`);
`;
  const first = patchMigrationsSource(fixture);
  assert.equal(first.changed, true);
  assert.match(first.source, /ptitbac_validation_cache/);
  assert.match(first.source, /ptitbac_validation_cache_engine_updated_idx/);
  const second = patchMigrationsSource(first.source);
  assert.equal(second.changed, false);
});

test("le patch serveur v2.5 ajoute la persistance sans toucher au flux de jeu", () => {
  const fixture = `
const validationEngine = require("./validation-engine-v24.cjs");
const VALIDATION_ENGINE_VERSION = "v2.4.0";
const VALIDATION_CACHE_FILE = path.join(__dirname, "validation-cache-v2.json");
function loadValidationCache() {
  try {
    if (!fs.existsSync(VALIDATION_CACHE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(VALIDATION_CACHE_FILE, "utf8"));
    for (const [key, value] of Object.entries(data || {})) {
      if (value && ["valid", "invalid"].includes(value.status)) validationCache.set(key, value);
    }
  } catch (err) {
    console.warn("Impossible de charger validation-cache-v2.json:", err.message);
  }
}

function saveValidationCache() {
  try {
    const tmp = \`${"${VALIDATION_CACHE_FILE}.tmp"}\`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(validationCache), null, 2));
    fs.renameSync(tmp, VALIDATION_CACHE_FILE);
  } catch (err) {
    console.warn("Impossible de sauvegarder validation-cache-v2.json:", err.message);
  }
}

loadValidationCache();
const cached = validationCache.get(validationCacheKey(item.category, item.answer));
app.get("/api/validation-health", async (req, res) => {
  res.json({
    cacheEntries: validationCache.size,
    learnedAnswers: learnedAnswers.size
  });
});
async function startApplication() {
  try {
    await initWalletPersistence();
    await initLearningPersistence();
    await initRoomPersistence();
    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        \`Mémoire IA: ${"${pgPool ? \"PostgreSQL\" : \"JSON local\"}"} \` +
        \`(${"${learnedAnswers.size}"} réponse(s) apprise(s))\`
      );
    });
  } catch (err) {}
}
`;

  const first = patchServerSource(fixture);
  assert.equal(first.changed, true);
  assert.match(first.source, /VALIDATION_ENGINE_VERSION = "v2\.5\.0"/);
  assert.match(first.source, /initValidationCachePersistence/);
  assert.match(first.source, /getValidationCacheEntry/);
  assert.match(first.source, /cacheStorage:/);
  assert.match(first.source, /await initValidationCachePersistence\(\);/);
  assert.doesNotMatch(first.source, /\nloadValidationCache\(\);/);

  const second = patchServerSource(first.source);
  assert.equal(second.changed, false);
});
