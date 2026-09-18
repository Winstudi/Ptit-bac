"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rollStarTap,
  rollRewardSpec,
  DUPLICATE_COMPENSATION,
  publicConfig
} = require("./reward-chests-service.js");

function sequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("sac: 52% pièces, 30% gemmes, 18% objet commun", () => {
  assert.deepEqual(
    rollRewardSpec("bag", "blue", sequence(0.00, 0.00)),
    { kind:"coins", amount:30 }
  );
  assert.deepEqual(
    rollRewardSpec("bag", "blue", sequence(0.519, 0.999)),
    { kind:"coins", amount:100 }
  );
  assert.deepEqual(
    rollRewardSpec("bag", "blue", sequence(0.52, 0.00)),
    { kind:"gems", amount:1 }
  );
  assert.deepEqual(
    rollRewardSpec("bag", "blue", sequence(0.819, 0.999)),
    { kind:"gems", amount:5 }
  );
  assert.deepEqual(
    rollRewardSpec("bag", "blue", sequence(0.82)),
    { kind:"item", rarity:"commun" }
  );
});

test("étoile: ouverture directe sans amélioration de rareté", () => {
  assert.deepEqual(rollStarTap("blue", () => 0.0), {
    opened:true, upgraded:false, state:"blue", previous:"blue"
  });
  assert.deepEqual(rollStarTap("violet", () => 0.999), {
    opened:true, upgraded:false, state:"blue", previous:"blue"
  });
});

test("étoile: table simple validée", () => {
  const rows = publicConfig().dropTables.star;
  assert.equal(rows.some(row => row.rarity === "exclusif"), false);
  assert.equal(rows.reduce((sum,row) => sum + row.weight, 0), 100);
  assert.deepEqual(
    rollRewardSpec("star", "blue", sequence(0.65, 0.0)),
    { kind:"item", rarity:"commun" }
  );
});

test("étoile légendaire: 60% épique ou ultra", () => {
  const rows = publicConfig().dropTables.legendary;
  const high = rows
    .filter(row => row.rarity === "epique" || row.rarity === "ultra")
    .reduce((sum,row) => sum + row.weight, 0);
  assert.equal(high, 60);
  assert.equal(rows.reduce((sum,row) => sum + row.weight, 0), 100);
});

test("compensations finales", () => {
  assert.deepEqual(DUPLICATE_COMPENSATION, {
    commun:50,
    rare:100,
    epique:250,
    ultra:500
  });
});
