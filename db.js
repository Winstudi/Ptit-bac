"use strict";

const { runDatabaseMigrations } = require("./db-migrations.js");
const { createKeyedWriteQueue } = require("./db-wallet-write-queue.js");
const { maybeRunPlayerDataReset } = require("./player-data-reset.js");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const POOL_MAX = Math.max(
  2,
  Math.min(20, Math.floor(Number(process.env.PTITBAC_DB_POOL_MAX) || 8))
);

let pool = null;
let migrationPromise = null;

function hasDatabase() {
  return Boolean(DATABASE_URL);
}

function walletTokenFromUpsert(args) {
  const config = args[0];
  const text = typeof config === "string"
    ? config
    : String(config?.text || "");
  const values = typeof config === "string"
    ? args[1]
    : config?.values;

  // Les appels avec callback conservent le comportement natif de pg.
  if (args.some((value, index) => index > 0 && typeof value === "function")) {
    return "";
  }

  if (
    !/^\s*INSERT\s+INTO\s+(?:public\.)?ptitbac_wallets\s*\(/i.test(text) ||
    !Array.isArray(values)
  ) {
    return "";
  }

  const token = String(values[0] || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function installWalletWriteOrdering(shared) {
  const originalQuery = shared.query.bind(shared);
  const walletWrites = createKeyedWriteQueue();

  shared.query = function queryWithWalletOrdering(...args) {
    const walletToken = walletTokenFromUpsert(args);

    if (!walletToken) {
      return originalQuery(...args);
    }

    return walletWrites.enqueue(
      walletToken,
      () => originalQuery(...args)
    );
  };

  return shared;
}

function createPool() {
  if (!DATABASE_URL) return null;

  const { Pool } = require("pg");
  const shared = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL)
      ? false
      : { rejectUnauthorized: false },
    max: POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  /*
   * Plusieurs anciens modules installent encore leur propre gestionnaire
   * SIGTERM. Pendant E2, ils utilisent tous le même Pool : rendre end()
   * idempotent évite qu'une fermeture multiple provoque une erreur.
   */
  const originalEnd = shared.end.bind(shared);
  let endPromise = null;

  shared.end = function endSharedPool() {
    if (!endPromise) {
      endPromise = Promise.resolve().then(() => originalEnd());
    }
    return endPromise;
  };

  /*
   * server.js conserve encore le solde en mémoire avant de déclencher
   * l'UPSERT PostgreSQL. Deux sauvegardes rapprochées d'un même portefeuille
   * ne doivent donc jamais terminer dans l'ordre inverse.
   *
   * On sérialise uniquement les UPSERT de ptitbac_wallets :
   * toutes les autres requêtes du Pool gardent leur parallélisme normal.
   */
  installWalletWriteOrdering(shared);

  shared.on("error", error => {
    console.error(
      "PostgreSQL partagé - connexion inactive en erreur:",
      error?.message || error
    );
  });

  return shared;
}

function getPool() {
  if (!pool && DATABASE_URL) {
    pool = createPool();
  }
  return pool;
}

function ensureDatabaseSchema() {
  const db = getPool();
  if (!db) return Promise.reject(new Error("DATABASE_URL manquant"));
  if (migrationPromise) return migrationPromise;

  migrationPromise = runDatabaseMigrations(db)
    .then(async () => {
      await maybeRunPlayerDataReset(db);
      console.log("PostgreSQL: schéma central prêt.");
      return db;
    })
    .catch(error => {
      migrationPromise = null;
      throw error;
    });

  return migrationPromise;
}

module.exports = {
  DATABASE_URL,
  POOL_MAX,
  hasDatabase,
  getPool,
  ensureDatabaseSchema
};
