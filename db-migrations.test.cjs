"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runDatabaseMigrations } = require("./db-migrations.js");

function fakePool({ legacyCoins = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (text.includes("information_schema.columns")) {
        return { rowCount: legacyCoins ? 1 : 0, rows: legacyCoins ? [{ exists:1 }] : [] };
      }
      return { rowCount:0, rows:[] };
    }
  };
}

test("toutes les tables principales sont créées par le module central", async () => {
  const pool = fakePool();
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_wallets/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.users/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.friendships/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_messages/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_inventory_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_progression/);
  assert.match(sql, /ptitbac_assign_friend_code_5/);
});

test("l'ancien users.coins est copié uniquement vers un portefeuille absent puis supprimé", async () => {
  const pool = fakePool({ legacyCoins:true });
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");

  assert.match(sql, /INSERT INTO public\.ptitbac_wallets\(token, coins, gems/);
  assert.match(sql, /ON CONFLICT\(token\) DO NOTHING/);
  assert.match(sql, /ALTER TABLE public\.users DROP COLUMN IF EXISTS coins/);
});

test("une base déjà migrée n'essaie plus de supprimer users.coins", async () => {
  const pool = fakePool({ legacyCoins:false });
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");
  assert.doesNotMatch(sql, /DROP COLUMN IF EXISTS coins/);
});
