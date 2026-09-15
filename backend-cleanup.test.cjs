"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = name =>
  fs.readFileSync(path.join(__dirname, name), "utf8");

test("l’ancien admin pièces a complètement disparu", () => {
  for (const name of ["server.js","app.js"]) {
    const text = source(name);
    assert.doesNotMatch(text, /wallet:adminAdjust/);
    assert.doesNotMatch(text, /openAdminCoinAccess/);
  }
});

test("l’administration utilise l’inventaire cosmétique officiel", () => {
  const admin = source("admin-hook.js");
  assert.match(admin, /ptitbac_inventory_items/);
  assert.match(admin, /createInventoryService/);
  assert.doesNotMatch(admin, /ptitbac_player_items/);
  assert.doesNotMatch(admin, /epic_chest|mystery_box|avatar_token|future_badge/);
});

test("les anciens générateurs de codes amis ont disparu", () => {
  assert.doesNotMatch(source("friends-hook.js"), /uniqueFriendCode|codeStem|PLAYER#/);
  assert.doesNotMatch(source("server.js"), /economyFriendCode|PLAYER#/);
  assert.doesNotMatch(source("admin-hook.js"), /PLAYER#/);
});

test("les chemins d’avatar ne sont plus tronqués à 16 caractères", () => {
  assert.match(source("friends-hook.js"), /slice\(0, 120\)/);
  assert.match(source("server.js"), /avatar \|\| "🐼"\)\.slice\(0,120\)/);
});

test("la liste des conversations n’utilise plus une boucle SQL par ami", () => {
  const chat = source("chat-hook.js");
  const block = chat.match(
    /async function conversationList\(userId\) \{([\s\S]*?)\n\}\n\nasync function history/
  )?.[1] || "";
  assert.match(block, /JOIN LATERAL/);
  assert.doesNotMatch(block, /for \(const friend of friends\)/);
  assert.equal((block.match(/pool\.query\(/g) || []).length, 1);
});
