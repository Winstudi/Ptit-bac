"use strict";

const crypto = require("crypto");
const { catalogEntries, validWalletToken } = require("./inventory-service.js");

const CHEST_TYPES = Object.freeze(["bag", "star", "legendary"]);
const STAR_STATES = Object.freeze(["blue", "violet", "pink", "gold"]);
const ITEM_RARITIES = Object.freeze(["commun", "rare", "epique", "ultra"]);

const DUPLICATE_COMPENSATION = Object.freeze({
  commun:50,
  rare:100,
  epique:250,
  ultra:500
});

const STAR_UPGRADE = Object.freeze({
  blue:Object.freeze({ upgradeChance:35, next:"violet" }),
  violet:Object.freeze({ upgradeChance:30, next:"pink" }),
  pink:Object.freeze({ upgradeChance:20, next:"gold" }),
  gold:Object.freeze({ upgradeChance:0, next:"" })
});

const DROP_TABLES = Object.freeze({
  bag:Object.freeze([
    Object.freeze({ kind:"coins", weight:52, min:30, max:100 }),
    Object.freeze({ kind:"gems", weight:30, min:1, max:5 }),
    Object.freeze({ kind:"item", rarity:"commun", weight:18 })
  ]),
  star:Object.freeze({
    blue:Object.freeze([
      Object.freeze({ kind:"coins", weight:40, min:50, max:120 }),
      Object.freeze({ kind:"gems", weight:25, min:2, max:5 }),
      Object.freeze({ kind:"item", rarity:"commun", weight:20 }),
      Object.freeze({ kind:"item", rarity:"rare", weight:15 })
    ]),
    violet:Object.freeze([
      Object.freeze({ kind:"coins", weight:30, min:80, max:160 }),
      Object.freeze({ kind:"gems", weight:20, min:3, max:7 }),
      Object.freeze({ kind:"item", rarity:"commun", weight:10 }),
      Object.freeze({ kind:"item", rarity:"rare", weight:30 }),
      Object.freeze({ kind:"item", rarity:"epique", weight:10 })
    ]),
    pink:Object.freeze([
      Object.freeze({ kind:"coins", weight:20, min:120, max:230 }),
      Object.freeze({ kind:"gems", weight:15, min:5, max:10 }),
      Object.freeze({ kind:"item", rarity:"commun", weight:5 }),
      Object.freeze({ kind:"item", rarity:"rare", weight:25 }),
      Object.freeze({ kind:"item", rarity:"epique", weight:25 }),
      Object.freeze({ kind:"item", rarity:"ultra", weight:10 })
    ]),
    gold:Object.freeze([
      Object.freeze({ kind:"coins", weight:10, min:180, max:350 }),
      Object.freeze({ kind:"gems", weight:10, min:8, max:15 }),
      Object.freeze({ kind:"item", rarity:"rare", weight:15 }),
      Object.freeze({ kind:"item", rarity:"epique", weight:40 }),
      Object.freeze({ kind:"item", rarity:"ultra", weight:25 })
    ])
  }),
  legendary:Object.freeze([
    Object.freeze({ kind:"coins", weight:15, min:250, max:500 }),
    Object.freeze({ kind:"gems", weight:15, min:10, max:20 }),
    Object.freeze({ kind:"item", rarity:"rare", weight:10 }),
    Object.freeze({ kind:"item", rarity:"epique", weight:30 }),
    Object.freeze({ kind:"item", rarity:"ultra", weight:30 })
  ])
});

function clampRandom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(0.999999999999, n));
}

function randomIntInclusive(min, max, random = Math.random) {
  const lo = Math.floor(Math.min(Number(min) || 0, Number(max) || 0));
  const hi = Math.floor(Math.max(Number(min) || 0, Number(max) || 0));
  return lo + Math.floor(clampRandom(random()) * (hi - lo + 1));
}

function weightedPick(entries, random = Math.random) {
  const rows = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
  if (!rows.length || total <= 0) throw new Error("Table de récompenses invalide.");

  let cursor = clampRandom(random()) * total;
  for (const row of rows) {
    const weight = Math.max(0, Number(row.weight) || 0);
    if (cursor < weight) return row;
    cursor -= weight;
  }
  return rows[rows.length - 1];
}

function normalizeChestType(value) {
  const type = String(value || "").trim().toLowerCase();
  return CHEST_TYPES.includes(type) ? type : "";
}

function normalizeStarState(value) {
  const state = String(value || "").trim().toLowerCase();
  return STAR_STATES.includes(state) ? state : "blue";
}

function rollStarTap(state = "blue", random = Math.random) {
  const current = normalizeStarState(state);
  const rule = STAR_UPGRADE[current];
  if (!rule || current === "gold") {
    return { opened:true, upgraded:false, state:"gold", previous:"gold" };
  }

  const upgraded = clampRandom(random()) < rule.upgradeChance / 100;
  return {
    opened:!upgraded,
    upgraded,
    state:upgraded ? rule.next : current,
    previous:current
  };
}

function tableFor(chestType, starState = "blue") {
  const type = normalizeChestType(chestType);
  if (type === "bag") return DROP_TABLES.bag;
  if (type === "legendary") return DROP_TABLES.legendary;
  if (type === "star") return DROP_TABLES.star[normalizeStarState(starState)];
  throw new Error("Type de coffre invalide.");
}

function rollRewardSpec(chestType, starState = "blue", random = Math.random) {
  const chosen = weightedPick(tableFor(chestType, starState), random);
  if (chosen.kind === "item") {
    return { kind:"item", rarity:String(chosen.rarity || "commun") };
  }
  return {
    kind:chosen.kind,
    amount:randomIntInclusive(chosen.min, chosen.max, random)
  };
}

function publicConfig() {
  return JSON.parse(JSON.stringify({
    chestTypes:CHEST_TYPES,
    starStates:STAR_STATES,
    starUpgrade:STAR_UPGRADE,
    dropTables:DROP_TABLES,
    duplicateCompensation:DUPLICATE_COMPENSATION,
    rules:{
      oneRewardPerOpening:true,
      ownedItemsRemoved:true,
      equalChanceWithinRarity:true,
      exclusiveInChests:false
    }
  }));
}

function safeClaimKey(value) {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9:_-]{8,120}$/.test(key) ? key : "";
}

function itemBucket(type) {
  return type === "avatar" ? "avatars" : type === "frame" ? "frames" : type === "tag" ? "tags" : "";
}

function createRewardChestService({
  getPool,
  ensureSchema,
  inventoryService,
  walletAtomicService,
  syncCoins = null,
  syncGems = null
} = {}) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");
  if (typeof ensureSchema !== "function") throw new TypeError("ensureSchema requis");
  if (!inventoryService?.getState) throw new TypeError("inventoryService requis");
  if (!walletAtomicService?.changeCoinsWithClient || !walletAtomicService?.changeGemsWithClient) {
    throw new TypeError("walletAtomicService requis");
  }

  let schemaPromise = null;
  const catalog = Object.freeze(catalogEntries());

  async function ensureRewardSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      await ensureSchema();
      const pool = getPool();
      if (!pool) throw new Error("PostgreSQL indisponible");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_reward_claims(
          wallet_token text NOT NULL,
          claim_key text NOT NULL,
          chest_type text NOT NULL,
          star_state text NOT NULL DEFAULT '',
          result jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,claim_key)
        )
      `);
      return pool;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
    return schemaPromise;
  }

  async function loadRarityMap(client) {
    const q = await client.query(
      `SELECT item_key,rarity FROM public.ptitbac_item_catalog_settings`
    ).catch(() => ({ rows:[] }));
    return new Map((q.rows || []).map(row => [
      String(row.item_key || ""),
      String(row.rarity || "commun").toLowerCase()
    ]));
  }

  async function loadOwnedKeys(client, walletToken) {
    const q = await client.query(
      `SELECT item_type,item_id
         FROM public.ptitbac_inventory_items
        WHERE wallet_token=$1`,
      [walletToken]
    );
    return new Set((q.rows || []).map(row => `${row.item_type}:${row.item_id}`));
  }

  async function chooseUnownedItem(client, walletToken, rarity, random = Math.random) {
    const safeRarity = ITEM_RARITIES.includes(rarity) ? rarity : "commun";
    const [rarityMap, owned] = await Promise.all([
      loadRarityMap(client),
      loadOwnedKeys(client, walletToken)
    ]);

    const candidates = catalog.filter(item => {
      if (item.defaultOwned) return false;
      if (owned.has(item.key)) return false;
      const itemRarity = rarityMap.get(item.key) || "commun";
      return itemRarity === safeRarity && itemRarity !== "exclusif";
    });

    if (!candidates.length) return null;
    const index = Math.floor(clampRandom(random()) * candidates.length);
    return candidates[Math.min(index, candidates.length - 1)];
  }

  async function grant({
    walletToken,
    chestType,
    starState = "blue",
    claimKey,
    random = Math.random
  } = {}) {
    const token = validWalletToken(walletToken);
    const type = normalizeChestType(chestType);
    const state = type === "star" ? normalizeStarState(starState) : "";
    const key = safeClaimKey(claimKey);
    if (!token || !type || !key) throw new Error("Récompense de coffre invalide.");

    const pool = await ensureRewardSchema();
    // Garantit les objets de base avant le verrou de récompense.
    await inventoryService.getState(token);

    const client = await pool.connect();
    let finished = false;
    let reward = null;
    let walletResult = null;
    let duplicate = false;

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT token FROM ptitbac_wallets WHERE token=$1 FOR UPDATE`,
        [token]
      );

      const existing = await client.query(
        `SELECT result
           FROM public.ptitbac_reward_claims
          WHERE wallet_token=$1 AND claim_key=$2
          LIMIT 1`,
        [token, key]
      );

      if (existing.rowCount) {
        duplicate = true;
        reward = existing.rows[0].result;
        await client.query("COMMIT");
        finished = true;
      } else {
        let spec = rollRewardSpec(type, state || "blue", random);

        if (spec.kind === "item") {
          const item = await chooseUnownedItem(client, token, spec.rarity, random);
          if (!item) {
            spec = {
              kind:"coins",
              amount:DUPLICATE_COMPENSATION[spec.rarity] || 50,
              compensationFor:spec.rarity
            };
          } else {
            await client.query(
              `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
               VALUES($1,$2,$3,'reward_chest')
               ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
              [token, item.type, item.id]
            );
            reward = {
              kind:"item",
              rarity:spec.rarity,
              item:{
                key:item.key,
                type:item.type,
                id:item.id,
                label:item.label,
                asset:item.asset || ""
              }
            };
          }
        }

        if (!reward && spec.kind === "coins") {
          walletResult = await walletAtomicService.changeCoinsWithClient(client, {
            walletToken:token,
            delta:spec.amount,
            kind:"CHEST_REWARD",
            details:{ note:`Coffre ${type}${spec.compensationFor ? ` - compensation ${spec.compensationFor}` : ""}` },
            idempotencyKey:`chest:${key}:coins`
          });
          if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit de pièces impossible.");
          reward = {
            kind:"coins",
            amount:spec.amount,
            ...(spec.compensationFor ? { compensationFor:spec.compensationFor } : {})
          };
        }

        if (!reward && spec.kind === "gems") {
          walletResult = await walletAtomicService.changeGemsWithClient(client, {
            walletToken:token,
            delta:spec.amount,
            kind:"CHEST_REWARD",
            details:{ note:`Coffre ${type}` },
            idempotencyKey:`chest:${key}:gems`
          });
          if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit de gemmes impossible.");
          reward = { kind:"gems", amount:spec.amount };
        }

        const stored = {
          ...reward,
          chestType:type,
          starState:state || null,
          claimId:crypto.createHash("sha256").update(`${token}:${key}`).digest("hex").slice(0, 20)
        };

        await client.query(
          `INSERT INTO public.ptitbac_reward_claims(wallet_token,claim_key,chest_type,star_state,result)
           VALUES($1,$2,$3,$4,$5::jsonb)`,
          [token, key, type, state, JSON.stringify(stored)]
        );
        reward = stored;

        await client.query("COMMIT");
        finished = true;
      }
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }

    if (walletResult?.wallet) {
      const coins = Number(walletResult.wallet.coins);
      const gems = Number(walletResult.wallet.gems);
      if (Number.isFinite(coins) && typeof syncCoins === "function") syncCoins(token, coins);
      if (Number.isFinite(gems) && typeof syncGems === "function") syncGems(token, gems);
    } else {
      if (Number.isFinite(Number(walletResult?.balance)) && typeof syncCoins === "function") {
        syncCoins(token, Number(walletResult.balance));
      }
      if (Number.isFinite(Number(walletResult?.gems)) && typeof syncGems === "function") {
        syncGems(token, Number(walletResult.gems));
      }
    }

    const inventoryState = reward?.kind === "item"
      ? await inventoryService.getState(token).catch(() => null)
      : null;

    return {
      ok:true,
      duplicate,
      reward,
      wallet:walletResult?.wallet || null,
      balance:Number.isFinite(Number(walletResult?.balance)) ? Number(walletResult.balance) : null,
      gems:Number.isFinite(Number(walletResult?.gems)) ? Number(walletResult.gems) : null,
      inventory:inventoryState
    };
  }

  return {
    ensureSchema:ensureRewardSchema,
    config:publicConfig,
    rollStarTap,
    rollRewardSpec,
    grant
  };
}

module.exports = {
  CHEST_TYPES,
  STAR_STATES,
  ITEM_RARITIES,
  STAR_UPGRADE,
  DROP_TABLES,
  DUPLICATE_COMPENSATION,
  randomIntInclusive,
  weightedPick,
  normalizeChestType,
  normalizeStarState,
  rollStarTap,
  rollRewardSpec,
  publicConfig,
  createRewardChestService
};
