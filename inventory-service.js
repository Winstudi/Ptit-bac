"use strict";

const ITEM_TYPES = Object.freeze(["avatar", "frame", "tag"]);
const ITEM_TYPE_SET = new Set(ITEM_TYPES);

const CATALOG = Object.freeze({
  avatar: Object.freeze({
    "/a1.webp": Object.freeze({ id: "/a1.webp", name: "Avatar 1", defaultOwned: true }),
    "/a2.webp": Object.freeze({ id: "/a2.webp", name: "Avatar 2", defaultOwned: true }),
    "/a3.webp": Object.freeze({ id: "/a3.webp", name: "Avatar 3", defaultOwned: true }),
    "/a4.webp": Object.freeze({ id: "/a4.webp", name: "Avatar 4", defaultOwned: true }),
    "/a5.webp": Object.freeze({ id: "/a5.webp", name: "Avatar 5", defaultOwned: true })
  }),
  // Le système de cadres reste actif, mais aucun cadre n'est publié pour le moment.
  frame: Object.freeze({}),
  tag: Object.freeze({
    tag_debutant: Object.freeze({ id: "tag_debutant", name: "Débutant", defaultOwned: true })
  })
});

const DEFAULT_OWNED = Object.freeze({
  avatars: Object.freeze(Object.values(CATALOG.avatar).filter(item => item.defaultOwned).map(item => item.id)),
  frames: Object.freeze(Object.values(CATALOG.frame).filter(item => item.defaultOwned).map(item => item.id)),
  tags: Object.freeze(Object.values(CATALOG.tag).filter(item => item.defaultOwned).map(item => item.id))
});

const LEGACY_AVATAR_IDS = Object.freeze({
  "/avatar-base-01.webp": "/a1.webp",
  "/avatar-base-02.webp": "/a2.webp",
  "/avatar-base-03.webp": "/a3.webp",
  "/avatar-base-04.webp": "/a4.webp",
  "/avatar-base-05.webp": "/a5.webp"
});

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function normalizeItemType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ITEM_TYPE_SET.has(type) ? type : "";
}

function normalizeItemId(type, value, { allowEmpty = false } = {}) {
  const itemType = normalizeItemType(type);
  const id = String(value || "").trim();
  if (!itemType) return "";
  if (allowEmpty && (itemType === "frame" || itemType === "tag") && !id) return "";
  return CATALOG[itemType][id] ? id : "";
}

function normalizeAvatarId(value) {
  const raw = String(value || "").trim();
  const migrated = LEGACY_AVATAR_IDS[raw] || raw;
  return normalizeItemId("avatar", migrated) || DEFAULT_OWNED.avatars[0];
}

function normalizeLegacyEquipped(raw = {}) {
  const avatar = normalizeAvatarId(raw.avatar);
  const rawFrame = String(raw.frame || "").trim();
  const rawTag = String(raw.tag || "").trim();
  const frameCandidate = normalizeItemId("frame", rawFrame, { allowEmpty: true });
  const tagCandidate = normalizeItemId("tag", rawTag, { allowEmpty: true });

  return {
    avatar: DEFAULT_OWNED.avatars.includes(avatar) ? avatar : DEFAULT_OWNED.avatars[0],
    frame: rawFrame && DEFAULT_OWNED.frames.includes(frameCandidate) ? frameCandidate : "",
    tag: rawTag === ""
      ? ""
      : DEFAULT_OWNED.tags.includes(tagCandidate)
        ? tagCandidate
        : DEFAULT_OWNED.tags[0]
  };
}

function cloneState(state) {
  if (!state) return null;
  return {
    owned: {
      avatars: [...(state.owned?.avatars || [])],
      frames: [...(state.owned?.frames || [])],
      tags: [...(state.owned?.tags || [])]
    },
    equipped: {
      avatar: String(state.equipped?.avatar || DEFAULT_OWNED.avatars[0]),
      frame: String(state.equipped?.frame || ""),
      tag: String(state.equipped?.tag || "")
    }
  };
}

function canEquipFromState(state, type, value) {
  const itemType = normalizeItemType(type);
  if (!itemType || !state) return false;

  const allowEmpty = itemType !== "avatar";
  const id = normalizeItemId(itemType, value, { allowEmpty });
  if (allowEmpty && String(value || "").trim() === "") return true;
  if (!id) return false;

  const bucket = itemType === "avatar" ? "avatars" : itemType === "frame" ? "frames" : "tags";
  return Array.isArray(state.owned?.[bucket]) && state.owned[bucket].includes(id);
}

function createInventoryService({ getPool }) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");

  let schemaPromise = null;
  const cache = new Map();

  function pool() {
    const value = getPool();
    if (!value) throw new Error("PostgreSQL indisponible");
    return value;
  }

  async function ensureSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
      const db = pool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_items (
          wallet_token text NOT NULL,
          item_type text NOT NULL CHECK (item_type IN ('avatar','frame','tag')),
          item_id text NOT NULL,
          source text NOT NULL DEFAULT 'system',
          acquired_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (wallet_token, item_type, item_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_equipped (
          wallet_token text PRIMARY KEY,
          avatar_id text NOT NULL DEFAULT '/a1.webp',
          frame_id text NOT NULL DEFAULT '',
          tag_id text NOT NULL DEFAULT 'tag_debutant',
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_inventory_items_wallet_idx
        ON public.ptitbac_inventory_items(wallet_token, item_type, acquired_at)
      `);

      // Nettoyage de l'ancien prototype cosmétique.
      // Les cadres reviendront plus tard avec un nouveau catalogue serveur.
      await db.query(`
        DELETE FROM public.ptitbac_inventory_items
         WHERE item_type = 'frame'
            OR (item_type = 'tag' AND item_id <> 'tag_debutant')
      `);
      await db.query(`
        UPDATE public.ptitbac_inventory_equipped
           SET frame_id = '',
               tag_id = CASE
                 WHEN tag_id = '' THEN ''
                 ELSE 'tag_debutant'
               END,
               updated_at = now()
         WHERE frame_id <> ''
            OR tag_id NOT IN ('', 'tag_debutant')
      `);
    })().catch(err => {
      schemaPromise = null;
      throw err;
    });

    return schemaPromise;
  }

  async function ensureDefaults(walletToken, legacyEquipped = {}) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide");
    await ensureSchema();
    const db = pool();

    const defaults = [
      ...DEFAULT_OWNED.avatars.map(id => ["avatar", id]),
      ...DEFAULT_OWNED.frames.map(id => ["frame", id]),
      ...DEFAULT_OWNED.tags.map(id => ["tag", id])
    ];

    for (const [type, id] of defaults) {
      await db.query(
        `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
         VALUES($1,$2,$3,'default')
         ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
        [token, type, id]
      );
    }

    const legacy = normalizeLegacyEquipped(legacyEquipped);
    await db.query(
      `INSERT INTO public.ptitbac_inventory_equipped(wallet_token,avatar_id,frame_id,tag_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(wallet_token) DO NOTHING`,
      [token, legacy.avatar, legacy.frame, legacy.tag || DEFAULT_OWNED.tags[0]]
    );
  }

  async function loadState(walletToken, legacyEquipped = {}) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide");
    await ensureDefaults(token, legacyEquipped);
    const db = pool();

    const [itemsResult, equippedResult] = await Promise.all([
      db.query(
        `SELECT item_type,item_id
           FROM public.ptitbac_inventory_items
          WHERE wallet_token=$1
          ORDER BY acquired_at,item_type,item_id`,
        [token]
      ),
      db.query(
        `SELECT avatar_id,frame_id,tag_id
           FROM public.ptitbac_inventory_equipped
          WHERE wallet_token=$1
          LIMIT 1`,
        [token]
      )
    ]);

    const owned = { avatars: [], frames: [], tags: [] };
    for (const row of itemsResult.rows || []) {
      const type = normalizeItemType(row.item_type);
      const id = normalizeItemId(type, row.item_id);
      if (!id) continue;
      const bucket = type === "avatar" ? "avatars" : type === "frame" ? "frames" : "tags";
      if (!owned[bucket].includes(id)) owned[bucket].push(id);
    }

    const row = equippedResult.rows?.[0] || {};
    const state = {
      owned,
      equipped: {
        avatar: owned.avatars.includes(row.avatar_id) ? row.avatar_id : (owned.avatars[0] || DEFAULT_OWNED.avatars[0]),
        frame: owned.frames.includes(row.frame_id) ? row.frame_id : "",
        tag: row.tag_id === "" || owned.tags.includes(row.tag_id) ? String(row.tag_id || "") : (owned.tags[0] || "")
      }
    };

    cache.set(token, cloneState(state));
    return cloneState(state);
  }

  async function getState(walletToken, legacyEquipped = {}) {
    return loadState(walletToken, legacyEquipped);
  }

  function peek(walletToken) {
    const token = validWalletToken(walletToken);
    return token ? cloneState(cache.get(token)) : null;
  }

  async function equip(walletToken, type, value) {
    const token = validWalletToken(walletToken);
    const itemType = normalizeItemType(type);
    if (!token || !itemType) throw new Error("Requête d’équipement invalide");

    const state = await loadState(token);
    if (!canEquipFromState(state, itemType, value)) {
      const error = new Error("Cet objet n’est pas dans ton inventaire.");
      error.code = "NOT_OWNED";
      throw error;
    }

    const id = itemType === "avatar"
      ? normalizeItemId("avatar", value)
      : normalizeItemId(itemType, value, { allowEmpty: true });

    const column = itemType === "avatar" ? "avatar_id" : itemType === "frame" ? "frame_id" : "tag_id";
    const db = pool();
    await db.query(
      `UPDATE public.ptitbac_inventory_equipped
          SET ${column}=$2, updated_at=now()
        WHERE wallet_token=$1`,
      [token, id]
    );

    if (itemType === "avatar") {
      await db.query(
        `UPDATE public.users
            SET avatar=$2, updated_at=now()
          WHERE wallet_token=$1`,
        [token, id]
      ).catch(() => {});
    }

    return loadState(token);
  }

  async function grant(walletToken, type, value, source = "system") {
    const token = validWalletToken(walletToken);
    const itemType = normalizeItemType(type);
    const id = normalizeItemId(itemType, value);
    if (!token || !itemType || !id) throw new Error("Objet invalide");
    await ensureDefaults(token);
    const db = pool();
    await db.query(
      `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
      [token, itemType, id, String(source || "system").slice(0, 40)]
    );
    return loadState(token);
  }

  return {
    ensureSchema,
    getState,
    equip,
    grant,
    peek,
    catalog: CATALOG,
    defaults: DEFAULT_OWNED
  };
}

module.exports = {
  ITEM_TYPES,
  CATALOG,
  DEFAULT_OWNED,
  validWalletToken,
  normalizeItemType,
  normalizeItemId,
  normalizeAvatarId,
  normalizeLegacyEquipped,
  canEquipFromState,
  createInventoryService
};
