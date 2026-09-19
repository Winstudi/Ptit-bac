"use strict";

const crypto = require("crypto");
const { getPool, ensureDatabaseSchema } = require("./db.js");
const {
  catalogEntries,
  parseCatalogKey,
  createInventoryService
} = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");

const BLOCK_SLOTS = Object.freeze({ 1:3, 2:3, 3:4 });
const DISCOUNTS = Object.freeze([0,10,20,30,40,50,60,70,80,90]);
const OFFER_MODES = Object.freeze(["single","pack","choice"]);
const MAX_OFFER_ITEMS = 8;
const RARITY_ORDER = Object.freeze({ commun:0, rare:1, epique:2, ultra:3, exclusif:4 });
const RARITY_LABELS = Object.freeze({
  commun:"Commun",
  rare:"Rare",
  epique:"Épique",
  ultra:"Ultra",
  exclusif:"Exclusif"
});

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function normalizeCurrency(value) {
  return value === "gems" ? "gems" : "coins";
}

function normalizeOfferMode(value) {
  const mode = String(value || "single").trim().toLowerCase();
  return OFFER_MODES.includes(mode) ? mode : "single";
}

function normalizeItemKeys(value, fallback = "") {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(",")
      : [];
  const keys = [];
  for (const entry of [...source, fallback]) {
    const key = String(entry || "").trim().slice(0,180);
    if (!key || keys.includes(key)) continue;
    keys.push(key);
    if (keys.length >= MAX_OFFER_ITEMS) break;
  }
  return keys;
}

function rowItemKeys(row = {}) {
  let raw = row.item_keys;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return normalizeItemKeys(Array.isArray(raw) ? raw : [], row.item_key);
}

function highestRarity(items = []) {
  let rarity = "commun";
  let rank = -1;
  for (const item of items) {
    const candidate = String(item?.rarity || "commun");
    const candidateRank = Number(RARITY_ORDER[candidate] ?? 0);
    if (candidateRank > rank) {
      rarity = candidate;
      rank = candidateRank;
    }
  }
  return rarity;
}

function normalizeDiscount(value) {
  const amount = Math.floor(Number(value) || 0);
  return DISCOUNTS.includes(amount) ? amount : 0;
}

function normalizePrice(value) {
  return Math.max(1, Math.min(999999, Math.floor(Number(value) || 0)));
}

function normalizeBlock(value) {
  const block = Math.floor(Number(value) || 0);
  return BLOCK_SLOTS[block] ? block : 0;
}

function normalizePosition(block, value) {
  const position = Math.floor(Number(value) || 0);
  return position >= 1 && position <= (BLOCK_SLOTS[block] || 0) ? position : 0;
}

function normalizeDurationMinutes(value) {
  return Math.max(5, Math.min(60 * 24 * 30, Math.floor(Number(value) || 0)));
}

function normalizeRequestId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 80);
}

function finalPrice(basePrice, discountPercent) {
  const base = normalizePrice(basePrice);
  const discount = normalizeDiscount(discountPercent);
  return Math.max(1, Math.floor(base * (100 - discount) / 100));
}

function safeText(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function createShopService({
  pool = getPool,
  ensureSchema = ensureDatabaseSchema,
  inventoryService = null,
  walletAtomicService = null
} = {}) {
  const inventory = inventoryService || createInventoryService({
    getPool:pool,
    ensureSchema
  });
  const wallet = walletAtomicService || createWalletAtomicService({
    getPool:pool,
    ensureSchema
  });

  let schemaPromise = null;

  async function db() {
    await ensureShopSchema();
    const value = pool();
    if (!value) throw new Error("PostgreSQL indisponible.");
    return value;
  }

  async function ensureShopSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      await ensureSchema();
      const database = pool();
      if (!database) throw new Error("PostgreSQL indisponible.");

      await database.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_shop_offers(
          id text PRIMARY KEY,
          item_key text NOT NULL,
          offer_mode text NOT NULL DEFAULT 'single',
          item_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
          display_name text NOT NULL,
          currency text NOT NULL CHECK(currency IN ('coins','gems')),
          base_price integer NOT NULL CHECK(base_price >= 1),
          discount_percent integer NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 90),
          block_no integer NOT NULL CHECK(block_no BETWEEN 1 AND 3),
          position_no integer NOT NULL CHECK(position_no BETWEEN 1 AND 4),
          badge text NOT NULL DEFAULT '',
          active boolean NOT NULL DEFAULT true,
          starts_at timestamptz NOT NULL DEFAULT now(),
          ends_at timestamptz NOT NULL,
          created_by_wallet_token text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await database.query(`ALTER TABLE public.ptitbac_shop_offers ADD COLUMN IF NOT EXISTS offer_mode text NOT NULL DEFAULT 'single'`);
      await database.query(`ALTER TABLE public.ptitbac_shop_offers ADD COLUMN IF NOT EXISTS item_keys jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await database.query(`
        UPDATE public.ptitbac_shop_offers
           SET item_keys=jsonb_build_array(item_key)
         WHERE item_keys IS NULL OR jsonb_array_length(item_keys)=0
      `);
      await database.query(`
        UPDATE public.ptitbac_shop_offers
           SET offer_mode='single'
         WHERE offer_mode NOT IN ('single','pack','choice')
      `);

      await database.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_shop_offers_active_slot_idx
          ON public.ptitbac_shop_offers(active,block_no,position_no,ends_at)
      `);

      await database.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_shop_purchases(
          id text PRIMARY KEY,
          wallet_token text NOT NULL,
          offer_id text NOT NULL,
          item_key text NOT NULL,
          selected_item_key text,
          purchased_item_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
          currency text NOT NULL,
          price_paid integer NOT NULL,
          request_id text NOT NULL,
          purchased_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(wallet_token,request_id)
        )
      `);

      await database.query(`ALTER TABLE public.ptitbac_shop_purchases ADD COLUMN IF NOT EXISTS selected_item_key text`);
      await database.query(`ALTER TABLE public.ptitbac_shop_purchases ADD COLUMN IF NOT EXISTS purchased_item_keys jsonb NOT NULL DEFAULT '[]'::jsonb`);

      await database.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_shop_purchases_wallet_idx
          ON public.ptitbac_shop_purchases(wallet_token,purchased_at DESC)
      `);

      return database;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
    return schemaPromise;
  }

  async function catalog() {
    const database = await db();
    const q = await database.query(
      `SELECT item_key,rarity,price,currency
         FROM public.ptitbac_item_catalog_settings`
    ).catch(() => ({ rows:[] }));

    const settings = new Map((q.rows || []).map(row => [String(row.item_key || ""), row]));

    return catalogEntries().map(item => {
      const saved = settings.get(item.key) || {};
      const rarity = RARITY_LABELS[String(saved.rarity || item.defaultRarity || "commun")]
        ? String(saved.rarity || item.defaultRarity || "commun")
        : "commun";
      return {
        ...item,
        asset:String(item.asset || (item.type === "avatar" ? item.id : "")),
        rarity,
        rarityLabel:RARITY_LABELS[rarity],
        configuredPrice:Math.max(0, Math.floor(Number(saved.price) || 0)),
        configuredCurrency:normalizeCurrency(saved.currency)
      };
    });
  }

  async function catalogMap() {
    const items = await catalog();
    return new Map(items.map(item => [item.key, item]));
  }

  function mapOffer(row, itemsMap) {
    const discount = normalizeDiscount(row.discount_percent);
    const price = normalizePrice(row.base_price);
    const now = Date.now();
    const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : now;
    const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : now;
    const offerMode = normalizeOfferMode(row.offer_mode);
    let itemKeys = rowItemKeys(row);
    if (offerMode === "single") itemKeys = itemKeys.slice(0,1);
    const resolvedItems = itemKeys.map(key => itemsMap.get(key)).filter(Boolean);
    const primary = resolvedItems[0] || itemsMap.get(String(row.item_key || "")) || null;
    const rarity = highestRarity(resolvedItems.length ? resolvedItems : [primary].filter(Boolean));
    const itemSnapshots = resolvedItems.map(item => ({
      key:String(item.key || ""),
      type:String(item.type || ""),
      id:String(item.id || ""),
      label:String(item.label || "Objet"),
      asset:String(item.asset || ""),
      rarity:String(item.rarity || "commun"),
      rarityLabel:String(item.rarityLabel || RARITY_LABELS[item.rarity] || "Commun")
    }));
    return {
      id:String(row.id || ""),
      offerMode,
      itemKeys:itemSnapshots.map(item => item.key),
      items:itemSnapshots,
      itemKey:String(primary?.key || row.item_key || ""),
      itemType:String(primary?.type || ""),
      itemId:String(primary?.id || ""),
      name:String(row.display_name || primary?.label || "Objet"),
      asset:String(primary?.asset || ""),
      rarity,
      rarityLabel:String(RARITY_LABELS[rarity] || "Commun"),
      currency:normalizeCurrency(row.currency),
      basePrice:price,
      discountPercent:discount,
      finalPrice:finalPrice(price, discount),
      block:normalizeBlock(row.block_no),
      position:normalizePosition(normalizeBlock(row.block_no), row.position_no),
      badge:String(row.badge || ""),
      active:row.active !== false,
      startsAt:Number.isFinite(startsAt) ? startsAt : now,
      endsAt:Number.isFinite(endsAt) ? endsAt : now,
      createdAt:row.created_at ? new Date(row.created_at).getTime() : null,
      updatedAt:row.updated_at ? new Date(row.updated_at).getTime() : null,
      durationMinutes:Math.max(5, Math.round((endsAt - startsAt) / 60000))
    };
  }

  async function adminOffers() {
    const database = await db();
    const items = await catalogMap();
    const q = await database.query(
      `SELECT *
         FROM public.ptitbac_shop_offers
        ORDER BY active DESC, block_no ASC, position_no ASC, updated_at DESC
        LIMIT 150`
    );
    return (q.rows || []).map(row => mapOffer(row, items));
  }

  async function activeOffers(walletToken = "") {
    const database = await db();
    const items = await catalogMap();
    const q = await database.query(
      `SELECT *
         FROM public.ptitbac_shop_offers
        WHERE active=true
          AND starts_at <= now()
          AND ends_at > now()
        ORDER BY block_no ASC, position_no ASC, updated_at DESC`
    );

    let owned = null;
    const token = validWalletToken(walletToken);
    if (token) owned = await inventory.getState(token).catch(() => null);

    const ownsItem = item => {
      if (!owned || !item) return false;
      const bucket = item.type === "avatar" ? "avatars" : item.type === "frame" ? "frames" : "tags";
      return Array.isArray(owned.owned?.[bucket]) && owned.owned[bucket].includes(item.id);
    };

    return (q.rows || []).map(row => {
      const offer = mapOffer(row, items);
      const itemStates = offer.items.map(item => ({ ...item, owned:ownsItem(item) }));
      const ownedCount = itemStates.filter(item => item.owned).length;
      return {
        ...offer,
        items:itemStates,
        owned:itemStates.length > 0 && ownedCount === itemStates.length,
        partiallyOwned:ownedCount > 0 && ownedCount < itemStates.length
      };
    });
  }

  async function saveOffer(adminToken, payload = {}) {
    const token = validWalletToken(adminToken);
    if (!token) throw new Error("Session admin invalide.");

    const items = await catalogMap();
    const offerMode = normalizeOfferMode(payload.offerMode);
    let itemKeys = normalizeItemKeys(payload.itemKeys, payload.itemKey);
    if (offerMode === "single") itemKeys = itemKeys.slice(0,1);
    if (!itemKeys.length) throw new Error("Choisis au moins un item boutique.");
    if (offerMode !== "single" && itemKeys.length < 2) {
      throw new Error("Un pack ou un choix doit contenir au moins 2 items.");
    }

    const selectedItems = itemKeys.map(key => items.get(key));
    if (selectedItems.some(item => !item || item.defaultOwned)) {
      throw new Error("Un des items sélectionnés n’est pas disponible dans la boutique.");
    }
    const primary = selectedItems[0];

    const block = normalizeBlock(payload.block);
    const position = normalizePosition(block, payload.position);
    if (!block || !position) throw new Error("Emplacement boutique invalide.");

    const basePrice = normalizePrice(payload.price);
    const discount = normalizeDiscount(payload.discountPercent);
    const currency = normalizeCurrency(payload.currency);
    const durationMinutes = normalizeDurationMinutes(payload.durationMinutes);
    const fallbackName = offerMode === "pack"
      ? `Pack ${selectedItems.length} objets`
      : offerMode === "choice"
        ? `Choix ${selectedItems.length} objets`
        : String(primary.label || "Objet");
    const displayName = safeText(payload.name, 40) || fallbackName;
    const badge = safeText(payload.badge, 24).toUpperCase();
    const active = payload.active !== false;
    const requestedId = safeText(payload.offerId, 80);
    const offerId = /^[a-zA-Z0-9_-]{8,80}$/.test(requestedId)
      ? requestedId
      : `offer_${crypto.randomBytes(10).toString("hex")}`;

    const database = await db();
    const client = await database.connect();
    let finished = false;
    try {
      await client.query("BEGIN");

      if (active) {
        await client.query(
          `UPDATE public.ptitbac_shop_offers
              SET active=false, updated_at=now()
            WHERE active=true
              AND block_no=$1
              AND position_no=$2
              AND id<>$3`,
          [block, position, offerId]
        );
      }

      const q = await client.query(
        `INSERT INTO public.ptitbac_shop_offers(
           id,item_key,offer_mode,item_keys,display_name,currency,base_price,discount_percent,
           block_no,position_no,badge,active,starts_at,ends_at,
           created_by_wallet_token,created_at,updated_at
         ) VALUES(
           $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,now(),
           now() + ($13::integer * interval '1 minute'),$14,now(),now()
         )
         ON CONFLICT(id) DO UPDATE SET
           item_key=EXCLUDED.item_key,
           offer_mode=EXCLUDED.offer_mode,
           item_keys=EXCLUDED.item_keys,
           display_name=EXCLUDED.display_name,
           currency=EXCLUDED.currency,
           base_price=EXCLUDED.base_price,
           discount_percent=EXCLUDED.discount_percent,
           block_no=EXCLUDED.block_no,
           position_no=EXCLUDED.position_no,
           badge=EXCLUDED.badge,
           active=EXCLUDED.active,
           starts_at=now(),
           ends_at=now() + ($13::integer * interval '1 minute'),
           updated_at=now()
         RETURNING *`,
        [
          offerId,primary.key,offerMode,JSON.stringify(itemKeys),displayName,currency,basePrice,discount,
          block,position,badge,active,durationMinutes,token
        ]
      );

      await client.query("COMMIT");
      finished = true;
      return mapOffer(q.rows[0], items);
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function deactivateOffer(adminToken, offerId) {
    const token = validWalletToken(adminToken);
    if (!token) throw new Error("Session admin invalide.");
    const id = safeText(offerId, 80);
    if (!id) throw new Error("Offre invalide.");
    const database = await db();
    const q = await database.query(
      `UPDATE public.ptitbac_shop_offers
          SET active=false,updated_at=now()
        WHERE id=$1
        RETURNING id`,
      [id]
    );
    if (!q.rowCount) throw new Error("Offre introuvable.");
    return { id };
  }

  async function purchase(walletToken, offerId, requestId, selectedItemKey = "") {
    const token = validWalletToken(walletToken);
    const id = safeText(offerId, 80);
    const reqId = normalizeRequestId(requestId);
    if (!token || !id || reqId.length < 8) throw new Error("Achat invalide.");

    await inventory.getState(token);
    const database = await db();
    const items = await catalogMap();
    const client = await database.connect();
    let finished = false;
    let walletResult = null;
    let resultOffer = null;
    let purchasedItems = [];
    let selectedKey = "";

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`${token}:shop:${id}`]
      );

      const duplicate = await client.query(
        `SELECT offer_id,item_key,currency,price_paid
           FROM public.ptitbac_shop_purchases
          WHERE wallet_token=$1 AND request_id=$2
          LIMIT 1`,
        [token, reqId]
      );
      if (duplicate.rowCount) {
        await client.query("COMMIT");
        finished = true;
        const inventoryState = await inventory.getState(token);
        return {
          duplicate:true,
          offerId:String(duplicate.rows[0].offer_id || id),
          inventory:inventoryState
        };
      }

      const q = await client.query(
        `SELECT *
           FROM public.ptitbac_shop_offers
          WHERE id=$1
            AND active=true
            AND starts_at <= now()
            AND ends_at > now()
          LIMIT 1
          FOR UPDATE`,
        [id]
      );
      if (!q.rowCount) throw new Error("Cette offre n’est plus disponible.");

      const row = q.rows[0];
      resultOffer = mapOffer(row, items);
      if (!resultOffer.items.length) throw new Error("Objet boutique invalide.");

      if (resultOffer.offerMode === "choice") {
        selectedKey = safeText(selectedItemKey, 180);
        const chosen = resultOffer.items.find(item => item.key === selectedKey);
        if (!chosen) {
          const err = new Error("Choisis l’objet que tu veux acheter.");
          err.code = "CHOICE_REQUIRED";
          throw err;
        }
        purchasedItems = [chosen];
      } else if (resultOffer.offerMode === "pack") {
        purchasedItems = resultOffer.items.slice();
      } else {
        purchasedItems = [resultOffer.items[0]];
        selectedKey = purchasedItems[0]?.key || "";
      }

      for (const item of [...purchasedItems].sort((a,b) => a.key.localeCompare(b.key))) {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`${token}:item:${item.key}`]
        );
      }

      for (const item of purchasedItems) {
        const owned = await client.query(
          `SELECT 1
             FROM public.ptitbac_inventory_items
            WHERE wallet_token=$1 AND item_type=$2 AND item_id=$3
            LIMIT 1`,
          [token, item.type, item.id]
        );
        if (owned.rowCount) {
          const err = new Error(resultOffer.offerMode === "pack"
            ? "Tu possèdes déjà un objet de ce pack."
            : "Tu possèdes déjà cet objet.");
          err.code = "OWNED";
          throw err;
        }
      }

      const price = resultOffer.finalPrice;
      const mutation = {
        walletToken:token,
        delta:-price,
        kind:"SHOP_PURCHASE",
        details:{ note:`Boutique: ${resultOffer.name}` },
        idempotencyKey:`shop:${id}:${reqId}`
      };

      walletResult = resultOffer.currency === "gems"
        ? await wallet.changeGemsWithClient(client, mutation)
        : await wallet.changeCoinsWithClient(client, mutation);

      if (!walletResult?.ok) {
        const err = new Error(walletResult?.error || "Solde insuffisant.");
        err.code = walletResult?.code || "PAYMENT";
        throw err;
      }

      for (const item of purchasedItems) {
        await client.query(
          `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
           VALUES($1,$2,$3,'shop')
           ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
          [token, item.type, item.id]
        );
      }

      await client.query(
        `INSERT INTO public.ptitbac_shop_purchases(
           id,wallet_token,offer_id,item_key,selected_item_key,purchased_item_keys,currency,price_paid,request_id
         ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [
          `buy_${crypto.randomBytes(10).toString("hex")}`,
          token,id,purchasedItems[0]?.key || resultOffer.itemKey,
          resultOffer.offerMode === "choice" ? selectedKey : null,
          JSON.stringify(purchasedItems.map(item => item.key)),
          resultOffer.currency,price,reqId
        ]
      );

      await client.query("COMMIT");
      finished = true;
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }

    const inventoryState = await inventory.getState(token);
    return {
      duplicate:false,
      offer:resultOffer,
      selectedItemKey:resultOffer?.offerMode === "choice" ? selectedKey : null,
      purchasedItemKeys:purchasedItems.map(item => item.key),
      balance:Number.isFinite(Number(walletResult?.balance)) ? Number(walletResult.balance) : null,
      gems:Number.isFinite(Number(walletResult?.gems)) ? Number(walletResult.gems) : null,
      inventory:inventoryState
    };
  }

  return {
    ensureSchema:ensureShopSchema,
    catalog,
    adminOffers,
    activeOffers,
    saveOffer,
    deactivateOffer,
    purchase,
    slots:BLOCK_SLOTS,
    discounts:DISCOUNTS,
    offerModes:OFFER_MODES,
    maxOfferItems:MAX_OFFER_ITEMS
  };
}

module.exports = {
  BLOCK_SLOTS,
  DISCOUNTS,
  OFFER_MODES,
  MAX_OFFER_ITEMS,
  RARITY_LABELS,
  validWalletToken,
  normalizeCurrency,
  normalizeOfferMode,
  normalizeItemKeys,
  normalizeDiscount,
  normalizePrice,
  normalizeBlock,
  normalizePosition,
  normalizeDurationMinutes,
  finalPrice,
  createShopService
};
