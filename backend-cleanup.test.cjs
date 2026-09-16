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

test("les salons configurables utilisent uniquement 6, 8 ou 10 catégories et jusqu’à 120 secondes", () => {
  const server = source("server.js");

  // Le moteur de tirage garde sa protection générale 6–10.
  assert.match(
    server,
    /Math\.max\(6,\s*Math\.min\(10,\s*Number\(count\)\s*\|\|\s*6\)\)/
  );

  // Mais les paramètres de salon exposés/acceptés sont volontairement limités.
  assert.equal(
    (server.match(/\[6,\s*8,\s*10\]\.includes\(Number\(categoryCount\)\)/g) || []).length,
    2
  );
  assert.equal(
    (server.match(/\[30,\s*60,\s*90,\s*120\]\.includes\(Number\(duration\)\)/g) || []).length,
    2
  );
  assert.doesNotMatch(
    server,
    /\[6,\s*7,\s*8,\s*9,\s*10\]\.includes\(Number\(categoryCount\)\)/
  );
});

test("une panne IA ne transforme plus les réponses non vérifiées en réponses fausses", () => {
  const server = source("server.js");
  const fallback = server.match(
    /function completeValidationFallback\([\s\S]*?\n\}\n\nasync function runAutomaticValidation/
  )?.[0] || "";

  assert.match(fallback, /item\.status = "unverified"/);
  assert.match(fallback, /neutralCategories/);
  assert.doesNotMatch(fallback, /item\.status = "invalid"/);

  const finalize = server.match(
    /function finalizeRound\(room\) \{([\s\S]*?)\n\}\n\nfunction endRound/
  )?.[1] || "";
  assert.match(finalize, /neutralCategories/);
  assert.match(finalize, /neutralCategories\.has\(category\)/);

  const results = server.match(
    /function buildRoundResults\(room\) \{([\s\S]*?)\n\}\n\nfunction finalizeRound/
  )?.[1] || "";
  assert.match(results, /source\.status === "unverified"/);
  assert.match(results, /reportable: status === "invalid"/);

  const scoreboard = source("scoreboard-screen-v1.js");
  assert.match(scoreboard, /r\.status==="unverified"\?"unverified"/);
  assert.match(scoreboard, /status==="unverified"\?"empty":status/);
  assert.match(scoreboard, /unverified:"\?"/);
  assert.match(scoreboard, /unverified:"Non vérifiée"/);
  assert.match(scoreboard, /\? Non vérifiée/);
});

test("une réponse encore incertaine après seconde vérification reste neutre", () => {
  const server = source("server.js");
  assert.match(server, /let finalVerdict = "uncertain"/);
  assert.match(server, /if \(finalVerdict === "uncertain"\) item\.reason = "review_unresolved"/);

  const automatic = server.match(
    /async function runAutomaticValidation\([\s\S]*?\n\}\n\n\nasync function reviewReportedAnswer/
  )?.[0] || "";
  assert.match(automatic, /item\.status = "unverified"/);
  assert.match(automatic, /validation\.neutralCategories = \[\.\.\.neutralCategories\]/);
  assert.match(automatic, /if \(validation\.status === "complete"\) return;/);
});
