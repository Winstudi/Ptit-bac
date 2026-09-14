const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_OWNED,
  normalizeItemId,
  normalizeAvatarId,
  normalizeLegacyEquipped,
  canEquipFromState
} = require("./inventory-service.js");

test("les cinq avatars, la flamme violette et Débutant sont possédés par défaut", () => {
  assert.deepEqual(DEFAULT_OWNED.avatars, ["/a1.webp", "/a2.webp", "/a3.webp", "/a4.webp", "/a5.webp"]);
  assert.deepEqual(DEFAULT_OWNED.frames, ["frame_purple_flame"]);
  assert.deepEqual(DEFAULT_OWNED.tags, ["tag_debutant"]);
});

test("un identifiant cosmétique inconnu est rejeté", () => {
  assert.equal(normalizeItemId("frame", "frame_hacked"), "");
  assert.equal(normalizeItemId("tag", "tag_hacked"), "");
  assert.equal(normalizeAvatarId("/avatar-secret.webp"), "/a1.webp");
});

test("la migration locale ne donne jamais un objet premium non possédé", () => {
  assert.deepEqual(
    normalizeLegacyEquipped({ avatar:"/a4.webp", frame:"frame_gold", tag:"tag_legende" }),
    { avatar:"/a4.webp", frame:"", tag:"tag_debutant" }
  );
  assert.deepEqual(
    normalizeLegacyEquipped({ avatar:"/a2.webp", frame:"frame_purple_flame", tag:"tag_debutant" }),
    { avatar:"/a2.webp", frame:"frame_purple_flame", tag:"tag_debutant" }
  );
});

test("l’équipement exige que l’objet soit réellement possédé", () => {
  const state = {
    owned: {
      avatars:["/a1.webp", "/a2.webp"],
      frames:["frame_purple_flame"],
      tags:["tag_debutant"]
    },
    equipped:{avatar:"/a1.webp",frame:"",tag:"tag_debutant"}
  };

  assert.equal(canEquipFromState(state, "avatar", "/a2.webp"), true);
  assert.equal(canEquipFromState(state, "frame", "frame_purple_flame"), true);
  assert.equal(canEquipFromState(state, "frame", "frame_gold"), false);
  assert.equal(canEquipFromState(state, "tag", "tag_legende"), false);
  assert.equal(canEquipFromState(state, "frame", ""), true);
  assert.equal(canEquipFromState(state, "tag", ""), true);
});
