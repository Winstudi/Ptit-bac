"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const { runDatabaseMigrations } = require("./db-migrations.js");
const { createAccountAuthService } = require("./account-auth.js");
const { createSessionAccess } = require("./session-access.js");
const { createInventoryService } = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");
const { createQuestsService } = require("./quests-service.js");
const { createShopService } = require("./shop-service.js");
const { createProgressionService } = require("./progression-service.js");
const { createRewardChestService } = require("./reward-chests-service.js");
const { createLevelRewardsService } = require("./level-rewards-service.js");

// SQL executed by embedded PostgreSQL (WASM). This does not replace a network/TLS
// test or multi-connection concurrency tests against the production PG version.
test("SQL intégré : migration, compte, sessions, achats, gemmes, quêtes et niveaux", async () => {
  const engine = new PGlite({ extensions:{ pgcrypto } });
  const query = async (sql, values) => {
    const result = await engine.query(sql, values);
    return { ...result, rowCount:result.rows.length || result.affectedRows || 0 };
  };
  const pool = { query, connect:async () => ({ query, release() {} }) };
  const getPool = () => pool;
  const ensureSchema = async () => {};
  try {
    await runDatabaseMigrations(pool);
    const auth = createAccountAuthService({ getPool, ensureDatabaseSchema:ensureSchema });
    const registered = await auth.register({ email:"audit@example.test", password:"example-test-password", username:"Audit" });
    assert.equal(registered.ok, true);
    const account = registered.account;
    assert.match(account.userId, /^[a-f0-9-]{36}$/);
    assert.equal(account.balance, 25);
    assert.equal(account.gems, 0);
    const token = account.walletToken;
    const access = createSessionAccess({ getPool });
    const socket = { data:{} };
    assert.equal(await access.authorize(socket, "inventory:get", { walletToken:token }), false);
    assert.equal(await access.authenticate(socket, account.sessionToken), true);
    assert.equal(socket.data.isAccountAdmin, false);
    assert.equal(await access.authorize(socket, "inventory:get", {}), true);
    const login = await auth.login({ email:"audit@example.test", password:"example-test-password" });
    assert.equal(login.ok, true);
    await auth.logout({ sessionToken:account.sessionToken });
    assert.equal(await access.authorize(socket, "inventory:get", {}), false);
    assert.equal(await access.authenticate(socket, login.account.sessionToken), true);

    const inventory = createInventoryService({ getPool, ensureSchema });
    await inventory.getState(token);
    const wallet = createWalletAtomicService({ getPool, ensureSchema });
    assert.equal((await wallet.changeCoins({ walletToken:token, delta:100, idempotencyKey:"audit-credit" })).balance, 125);
    assert.equal((await wallet.changeCoins({ walletToken:token, delta:100, idempotencyKey:"audit-credit" })).duplicate, true);
    assert.equal((await wallet.changeGems({ walletToken:token, delta:7, idempotencyKey:"audit-gems" })).gems, 7);
    assert.equal((await wallet.changeGems({ walletToken:token, delta:-8, idempotencyKey:"audit-too-much" })).ok, false);

    const shop = createShopService({ pool:getPool, ensureSchema, inventoryService:inventory, walletAtomicService:wallet });
    await pool.query(`INSERT INTO public.ptitbac_shop_offers
      (id,item_key,item_keys,display_name,currency,base_price,block_no,position_no,ends_at)
      VALUES('audit-offer','frame:frame_ice','["frame:frame_ice"]'::jsonb,'Glace','gems',3,1,1,now()+interval '1 day')`);
    const bought = await shop.purchase(token, "audit-offer", "audit-purchase-001");
    assert.equal(bought.gems, 4);
    assert.equal((await shop.purchase(token, "audit-offer", "audit-purchase-001")).duplicate, true);
    assert.equal((await pool.query("SELECT gems FROM public.ptitbac_wallets WHERE token=$1", [token])).rows[0].gems, 4);

    const quests = createQuestsService({ getPool, ensureSchema });
    const status = await quests.status(token);
    assert.equal(status.quests.length, 3);
    assert.ok(status.quests.every(item => item.progress === 0));
    assert.equal((await quests.status(token)).quests.length, 3);
    const progression = createProgressionService({ getPool, ensureSchema });
    const chestService = createRewardChestService({ getPool, ensureSchema, inventoryService:inventory, walletAtomicService:wallet });
    const levels = createLevelRewardsService({ getPool, ensureSchema, progressionService:progression, inventoryService:inventory, walletAtomicService:wallet, chestService });
    await levels.claim(token, 1);
    assert.equal((await levels.claim(token, 1)).duplicate, true);
    // Reapplying the schema must not remove wallet balances, purchases or items.
    await runDatabaseMigrations(pool);
    const after = (await pool.query("SELECT coins,gems FROM public.ptitbac_wallets WHERE token=$1", [token])).rows[0];
    assert.deepEqual(after, { coins:125, gems:4 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.ptitbac_shop_purchases WHERE wallet_token=$1", [token])).rows[0].n, 1);
  } finally { await engine.close(); }
});
