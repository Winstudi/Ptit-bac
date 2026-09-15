"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldRefundEntryOnLeave,
  isFinalScoreboard,
  nextHostCandidate,
  canAdvanceScoreboard
} = require("./game-loop-rules.js");

test("quitter pendant le choix des catégories ne rembourse pas la vie", () => {
  assert.equal(
    shouldRefundEntryOnLeave({ phase:"category_selection", roundIndex:-1 }),
    false
  );
  assert.equal(
    shouldRefundEntryOnLeave({ phase:"letter_selection", roundIndex:-1 }),
    false
  );
  assert.equal(
    shouldRefundEntryOnLeave({ phase:"lobby", roundIndex:-1 }),
    true
  );
});

test("la dernière page de résultats est reconnue", () => {
  assert.equal(
    isFinalScoreboard({ phase:"scoreboard", roundIndex:0, rounds:1 }),
    true
  );
  assert.equal(
    isFinalScoreboard({ phase:"scoreboard", roundIndex:1, rounds:3 }),
    false
  );
  assert.equal(
    isFinalScoreboard({ phase:"scoreboard", roundIndex:2, rounds:3 }),
    true
  );
});

test("le transfert d'hôte privilégie un humain connecté", () => {
  const players = [
    { id:"old", isBot:false, connected:false },
    { id:"offline", isBot:false, connected:false },
    { id:"bot", isBot:true, connected:true },
    { id:"online", isBot:false, connected:true }
  ];

  assert.equal(nextHostCandidate(players, "old")?.id, "online");
});

test("un humain hors ligne reste préférable à un bot si personne n'est connecté", () => {
  const players = [
    { id:"offline", isBot:false, connected:false },
    { id:"bot", isBot:true, connected:true }
  ];

  assert.equal(nextHostCandidate(players)?.id, "offline");
});

test("en Quick n'importe quel joueur peut continuer les résultats", () => {
  const room = { phase:"scoreboard", mode:"quick" };
  assert.equal(canAdvanceScoreboard(room, { isHost:false }), true);
});

test("hors Quick seul l'hôte peut continuer les résultats", () => {
  const room = { phase:"scoreboard", mode:"public" };
  assert.equal(canAdvanceScoreboard(room, { isHost:false }), false);
  assert.equal(canAdvanceScoreboard(room, { isHost:true }), true);
});
