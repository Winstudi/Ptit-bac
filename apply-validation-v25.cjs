"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SERVER_FILE = path.join(__dirname, "server.js");
const MIGRATIONS_FILE = path.join(__dirname, "db-migrations.js");
const TARGET_VERSION = "v2.5.0";

function fail(message) {
  throw new Error(`Validation v2.5: ${message}`);
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

function patchMigrationsSource(input) {
  let source = String(input || "");
  if (source.includes("CREATE TABLE IF NOT EXISTS public.ptitbac_validation_cache")) {
    return { source, changed:false };
  }

  const anchor = `  await pool.query(\`
    CREATE TABLE IF NOT EXISTS public.ptitbac_answer_reports(`;
  const migration = `  // Cache durable du moteur de correction. Le payload reste versionné :
  // une nouvelle politique de validation ne réutilise jamais une ancienne décision.
  await pool.query(\`
    CREATE TABLE IF NOT EXISTS public.ptitbac_validation_cache(
      cache_key text PRIMARY KEY,
      engine_version text NOT NULL,
      payload jsonb NOT NULL,
      updated_at bigint NOT NULL
    )
  \`);
  await pool.query(\`
    CREATE INDEX IF NOT EXISTS ptitbac_validation_cache_engine_updated_idx
      ON public.ptitbac_validation_cache(engine_version, updated_at DESC)
  \`);

`;

  source = replaceOnce(source, anchor, migration + anchor, "migration cache PostgreSQL");
  return { source, changed:true };
}

function patchServerSource(input) {
  let source = String(input || "");

  const alreadyComplete =
    source.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    source.includes('require("./validation-cache-v25.cjs")') &&
    source.includes("async function initValidationCachePersistence(") &&
    source.includes("await initValidationCachePersistence();") &&
    source.includes("cacheStorage:");
  if (alreadyComplete) return { source, changed:false };

  if (!source.includes('require("./validation-engine-v24.cjs")')) {
    fail("le moteur v2.4 doit être appliqué avant la v2.5");
  }

  if (!source.includes('require("./validation-cache-v25.cjs")')) {
    source = replaceOnce(
      source,
      'const validationEngine = require("./validation-engine-v24.cjs");',
      'const validationEngine = require("./validation-engine-v24.cjs");\nconst validationCacheStore = require("./validation-cache-v25.cjs");',
      "import cache v2.5"
    );
  }

  source = replaceOnce(
    source,
    'const VALIDATION_ENGINE_VERSION = "v2.4.0";',
    `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
    "version moteur"
  );

  if (!source.includes("const VALIDATION_CACHE_MEMORY_MAX =")) {
    source = replaceOnce(
      source,
      'const VALIDATION_CACHE_FILE = path.join(__dirname, "validation-cache-v2.json");',
      `const VALIDATION_CACHE_FILE = path.join(__dirname, "validation-cache-v2.json");
const VALIDATION_CACHE_MEMORY_MAX = validationCacheStore.clampInteger(
  process.env.VALIDATION_CACHE_MEMORY_MAX,
  1000,
  50000,
  25000
);
const VALIDATION_CACHE_DB_LOAD_LIMIT = Math.min(
  VALIDATION_CACHE_MEMORY_MAX,
  validationCacheStore.clampInteger(
    process.env.VALIDATION_CACHE_DB_LOAD_LIMIT,
    1000,
    50000,
    25000
  )
);`,
      "limites cache"
    );
  }

  const persistenceBlock = `function loadValidationCacheFromFile() {
  try {
    if (!fs.existsSync(VALIDATION_CACHE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(VALIDATION_CACHE_FILE, "utf8"));
    for (const [key, value] of Object.entries(data || {})) {
      if (value?.engineVersion !== VALIDATION_ENGINE_VERSION) continue;
      validationCacheStore.put(
        validationCache,
        key,
        value,
        VALIDATION_CACHE_MEMORY_MAX
      );
    }
  } catch (err) {
    console.warn("Impossible de charger validation-cache-v2.json:", err.message);
  }
}

async function initValidationCachePersistence() {
  validationCache.clear();

  if (!pgPool) {
    loadValidationCacheFromFile();
    return;
  }

  await ensureDatabaseSchema();
  const { rows } = await pgPool.query(
    \`SELECT cache_key, engine_version, payload, updated_at
       FROM public.ptitbac_validation_cache
      WHERE engine_version=$1
      ORDER BY updated_at DESC
      LIMIT $2\`,
    [VALIDATION_ENGINE_VERSION, VALIDATION_CACHE_DB_LOAD_LIMIT]
  );

  // On réinsère du plus ancien au plus récent afin que l'ordre de la Map
  // corresponde à un petit LRU en mémoire.
  for (const row of [...rows].reverse()) {
    const payload = validationCacheStore.fromDatabaseRow(
      row,
      VALIDATION_ENGINE_VERSION
    );
    if (!payload) continue;
    validationCacheStore.put(
      validationCache,
      row.cache_key,
      payload,
      VALIDATION_CACHE_MEMORY_MAX
    );
  }

  // Les caches d'une ancienne politique ne sont jamais utilisés. Leur
  // suppression est non bloquante et n'affecte pas le démarrage du jeu.
  pgPool.query(
    "DELETE FROM public.ptitbac_validation_cache WHERE engine_version <> $1",
    [VALIDATION_ENGINE_VERSION]
  ).catch(err => console.warn("Nettoyage ancien cache IA:", err.message));
}

function getValidationCacheEntry(key) {
  return validationCacheStore.touch(validationCache, key);
}

function saveValidationCache() {
  validationCacheStore.trim(validationCache, VALIDATION_CACHE_MEMORY_MAX);

  if (!pgPool) {
    try {
      const tmp = \`${"${VALIDATION_CACHE_FILE}.tmp"}\`;
      fs.writeFileSync(
        tmp,
        JSON.stringify(Object.fromEntries(validationCache), null, 2)
      );
      fs.renameSync(tmp, VALIDATION_CACHE_FILE);
    } catch (err) {
      console.warn("Impossible de sauvegarder validation-cache-v2.json:", err.message);
    }
    return;
  }

  // Une manche contient au maximum quelques dizaines de nouvelles réponses.
  // On écrit donc seulement la queue récente du LRU et jamais tout le cache.
  const query = validationCacheStore.buildUpsertQuery(
    validationCacheStore.newestEntries(validationCache, 120)
  );
  if (!query) return;

  pgPool.query(query.text, query.values).catch(err => {
    console.error("Erreur persistance cache IA:", err.message);
  });
}`;

  source = replaceRegexOnce(
    source,
    /function loadValidationCache\(\) \{[\s\S]*?\n\}\n\nfunction saveValidationCache\(\) \{[\s\S]*?\n\}\n\nloadValidationCache\(\);/,
    persistenceBlock,
    "persistance cache"
  );

  source = source.replaceAll(
    "validationCache.get(validationCacheKey(item.category, item.answer))",
    "getValidationCacheEntry(validationCacheKey(item.category, item.answer))"
  );

  if (!source.includes("await initValidationCachePersistence();")) {
    source = replaceOnce(
      source,
      `    await initWalletPersistence();
    await initLearningPersistence();
    await initRoomPersistence();`,
      `    await initWalletPersistence();
    await initLearningPersistence();
    await initValidationCachePersistence();
    await initRoomPersistence();`,
      "initialisation cache"
    );
  }

  if (!source.includes("cacheStorage:")) {
    source = replaceOnce(
      source,
      "    cacheEntries: validationCache.size,",
      `    cacheEntries: validationCache.size,
    cacheStorage: pgPool ? "postgres+ram" : "json+ram",
    cacheMemoryLimit: VALIDATION_CACHE_MEMORY_MAX,`,
      "diagnostic cache"
    );
  }

  if (!source.includes("Cache correction:")) {
    source = replaceOnce(
      source,
      `      console.log(
        \`Mémoire IA: ${"${pgPool ? \"PostgreSQL\" : \"JSON local\"}"} \` +
        \`(${"${learnedAnswers.size}"} réponse(s) apprise(s))\`
      );`,
      `      console.log(
        \`Mémoire IA: ${"${pgPool ? \"PostgreSQL\" : \"JSON local\"}"} \` +
        \`(${"${learnedAnswers.size}"} réponse(s) apprise(s))\`
      );
      console.log(
        \`Cache correction: ${"${pgPool ? \"PostgreSQL + RAM\" : \"JSON + RAM\"}"} \` +
        \`(${"${validationCache.size}"}/${"${VALIDATION_CACHE_MEMORY_MAX}"})\`
      );`,
      "log cache"
    );
  }

  return { source, changed:true };
}

function applyPatch() {
  // La v2.5 s'appuie sur la v2.4 déjà validée pour ne pas dupliquer le patch
  // de parallélisation/prévalidation. Cela fonctionne aussi si v2.4 est déjà appliquée.
  const v24 = require("./apply-validation-v24.cjs");
  v24.applyPatch();

  if (!fs.existsSync(SERVER_FILE)) fail("server.js introuvable.");
  if (!fs.existsSync(MIGRATIONS_FILE)) fail("db-migrations.js introuvable.");

  const serverBefore = fs.readFileSync(SERVER_FILE, "utf8");
  const serverResult = patchServerSource(serverBefore);
  if (serverResult.changed) {
    const tmp = `${SERVER_FILE}.validation-v25.tmp`;
    fs.writeFileSync(tmp, serverResult.source, "utf8");
    fs.renameSync(tmp, SERVER_FILE);
  }

  const migrationsBefore = fs.readFileSync(MIGRATIONS_FILE, "utf8");
  const migrationResult = patchMigrationsSource(migrationsBefore);
  if (migrationResult.changed) {
    const tmp = `${MIGRATIONS_FILE}.validation-v25.tmp`;
    fs.writeFileSync(tmp, migrationResult.source, "utf8");
    fs.renameSync(tmp, MIGRATIONS_FILE);
  }

  console.log(
    `Validation ${TARGET_VERSION}: cache PostgreSQL + RAM actif ` +
    "sans changement du gameplay ni de l'interface."
  );
}

if (require.main === module) applyPatch();

module.exports = {
  TARGET_VERSION,
  patchServerSource,
  patchMigrationsSource,
  applyPatch
};
