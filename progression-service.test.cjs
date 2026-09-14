"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  xpForNextLevel,
  totalXpForLevel,
  progressionFromTotalXp,
  calculateRoomXp,
  rankingForPlayers,
  createProgressionService
} = require("./progression-service.js");

const token = suffix => (String(suffix).padStart(48, "a")).slice(-48);

function room(overrides = {}) {
  return {
    code: "ABCDE",
    mode: "quick",
    phase: "finished",
    rounds: 1,
    roundIndex: 0,
    entryDebited: true,
    gameSessionId: "session-1",
    paidPlayerIds: ["p1", "p2"],
    players: [
      { id:"p1", score:6, walletToken:token("1"), isBot:false },
      { id:"p2", score:4, walletToken:token("2"), isBot:false }
    ],
    ...overrides
  };
}

test("XP nécessaire augmente de 25 par niveau", () => {
  assert.equal(xpForNextLevel(1), 100);
  assert.equal(xpForNextLevel(2), 125);
  assert.equal(xpForNextLevel(10), 325);
  assert.equal(xpForNextLevel(49), 1300);
  assert.equal(xpForNextLevel(50), 0);
});

test("seuils cumulés et niveaux sont cohérents", () => {
  assert.equal(totalXpForLevel(1), 0);
  assert.equal(totalXpForLevel(2), 100);
  assert.equal(totalXpForLevel(3), 225);
  assert.equal(progressionFromTotalXp(99).level, 1);
  assert.equal(progressionFromTotalXp(100).level, 2);
  assert.equal(progressionFromTotalXp(224).level, 2);
  assert.equal(progressionFromTotalXp(225).level, 3);
});

test("une partie rapide gagnée avec 6 réponses valides rapporte 42 XP", () => {
  const xp = calculateRoomXp(room());
  assert.equal(xp.p1.xp, 42);
  assert.equal(xp.p1.rank, 1);
  assert.equal(xp.p1.validAnswers, 6);
});

test("5 manches, 25 réponses valides et deuxième place rapportent 112 XP", () => {
  const xp = calculateRoomXp(room({
    rounds: 5,
    roundIndex: 4,
    paidPlayerIds: ["p1", "p2", "p3"],
    players: [
      { id:"p1", score:30, walletToken:token("1"), isBot:false },
      { id:"p2", score:25, walletToken:token("2"), isBot:false },
      { id:"p3", score:20, walletToken:token("3"), isBot:false }
    ]
  }));
  assert.equal(xp.p2.xp, 112);
});

test("le salon privé ne donne jamais d'XP", () => {
  const xp = calculateRoomXp(room({ mode:"private" }));
  assert.equal(xp.p1.xp, 0);
  assert.equal(xp.p2.xp, 0);
});

test("une partie avec bot ne donne jamais d'XP", () => {
  const xp = calculateRoomXp(room({
    players: [
      { id:"p1", score:6, walletToken:token("1"), isBot:false },
      { id:"bot", score:3, walletToken:null, isBot:true }
    ]
  }));
  assert.equal(xp.p1.xp, 0);
});

test("une partie à un seul vrai joueur ne donne jamais d'XP", () => {
  const xp = calculateRoomXp(room({
    paidPlayerIds:["p1"],
    players:[{ id:"p1", score:6, walletToken:token("1"), isBot:false }]
  }));
  assert.equal(xp.p1.xp, 0);
});

test("les égalités utilisent un classement de compétition", () => {
  const ranks = rankingForPlayers([
    { id:"a", score:10, walletToken:token("1") },
    { id:"b", score:10, walletToken:token("2") },
    { id:"c", score:8, walletToken:token("3") }
  ]);
  assert.deepEqual(ranks, { a:1, b:1, c:3 });
});


test("un salon privé ne touche pas PostgreSQL pour distribuer l’XP", async () => {
  let poolTouched = false;
  const service = createProgressionService({
    getPool() {
      poolTouched = true;
      return null;
    }
  });

  const result = await service.awardRoom(room({ mode:"private" }));
  assert.deepEqual(result, {});
  assert.equal(poolTouched, false);
});
