"use strict";

const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const POOL_MAX = Math.max(
  2,
  Math.min(20, Math.floor(Number(process.env.PTITBAC_DB_POOL_MAX) || 8))
);

let pool = null;

function hasDatabase() {
  return Boolean(DATABASE_URL);
}

function createPool() {
  if (!DATABASE_URL) return null;

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

module.exports = {
  DATABASE_URL,
  POOL_MAX,
  hasDatabase,
  getPool
};
