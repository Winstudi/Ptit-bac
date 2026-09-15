const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATALOG,
  DEFAULT_OWNED,
  normalizeItemId,
  normalizeAvatarId,
  catalogEntries,
  parseCatalogKey,
  normalizeLegacyEquipped,
  canEquipFromState,
  createInventoryService
} = require("./inventory-service.js");

test("les cinq avatars et Débutant sont possédés par défaut, sans cadre", () => {
  assert.deepEqual(DEFAULT_OWNED.avatars, ["/a1.webp", "/a2.webp", "/a3.webp", "/a4.webp", "/a5.webp"]);
  assert.deepEqual(DEFAULT_OWNED.frames, []);
  assert.deepEqual(DEFAULT_OWNED.tags, ["tag_debutant"]);
  assert.deepEqual(Object.keys(CATALOG.frame), []);
  assert.deepEqual(Object.keys(CATALOG.tag), ["tag_debutant"]);
});

test("les anciens cadres et tags avancés ne font plus partie du catalogue", () => {
  for (const id of ["frame_purple_flame", "frame_ice", "frame_gold", "frame_nature"]) {
    assert.equal(normalizeItemId("frame", id), "");
  }
  for (const id of ["tag_curieux", "tag_maitre_bac", "tag_champion", "tag_legende"]) {
    assert.equal(normalizeItemId("tag", id), "");
  }
  assert.equal(normalizeAvatarId("/avatar-secret.webp"), "/a1.webp");
});

test("la migration locale retire les anciens cosmétiques", () => {
  assert.deepEqual(
    normalizeLegacyEquipped({ avatar:"/a4.webp", frame:"frame_purple_flame", tag:"tag_legende" }),
    { avatar:"/a4.webp", frame:"", tag:"tag_debutant" }
  );
  assert.deepEqual(
    normalizeLegacyEquipped({ avatar:"/a2.webp", frame:"frame_gold", tag:"tag_debutant" }),
    { avatar:"/a2.webp", frame:"", tag:"tag_debutant" }
  );
});

test("le système de cadre reste actif avec Sans cadre uniquement", () => {
  const state = {
    owned: {
      avatars:["/a1.webp", "/a2.webp"],
      frames:[],
      tags:["tag_debutant"]
    },
    equipped:{avatar:"/a1.webp",frame:"",tag:"tag_debutant"}
  };

  assert.equal(canEquipFromState(state, "avatar", "/a2.webp"), true);
  assert.equal(canEquipFromState(state, "frame", ""), true);
  assert.equal(canEquipFromState(state, "frame", "frame_purple_flame"), false);
  assert.equal(canEquipFromState(state, "frame", "frame_gold"), false);
  assert.equal(canEquipFromState(state, "tag", "tag_debutant"), true);
  assert.equal(canEquipFromState(state, "tag", "tag_legende"), false);
});

test("le schéma nettoie les anciens cadres et tags de PostgreSQL", async () => {
  const queries = [];
  const db = {
    async query(sql) { queries.push(String(sql)); return { rows: [] }; }
  };
  const service = createInventoryService({ getPool: () => db });
  await service.ensureSchema();
  const joined = queries.join("\n");
  assert.match(joined, /DELETE FROM public\.ptitbac_inventory_items/);
  assert.match(joined, /item_type='frame'/);
  assert.match(joined, /item_type='tag'/);
  assert.match(joined, /ANY\(\$1::text\[\]\)/);
  assert.match(joined, /SET frame_id=''/);
});


test("le catalogue admin utilise exactement les objets de l’inventaire officiel", () => {
  const entries = catalogEntries();
  assert.ok(entries.length >= 6);
  assert.ok(entries.every(item => ["avatar","frame","tag"].includes(item.type)));
  assert.ok(entries.some(item => item.key === "avatar:/a1.webp"));
  assert.ok(entries.some(item => item.key === "tag:tag_debutant"));

  assert.deepEqual(
    parseCatalogKey("avatar:/a3.webp"),
    {
      key:"avatar:/a3.webp",
      type:"avatar",
      id:"/a3.webp",
      item:CATALOG.avatar["/a3.webp"]
    }
  );
  assert.equal(parseCatalogKey("epic_chest"), null);
});
