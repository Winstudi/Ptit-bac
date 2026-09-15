"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateRewards } = require("./game-economy.js");

const token = value =>
  String(value).padStart(48, "a").slice(-48);

function room(overrides = {}) {
  return {
    mode: "public",
    phase: "finished",
    rounds: 1,
    roundIndex: 0,
    entryDebited: true,
    paidPlayerIds: ["p1", "p2", "p3"],
    players: [
      { id:"p1", score:12, walletToken:token("1"), isBot:false },
      { id:"p2", score:8, walletToken:token("2"), isBot:false },
      { id:"p3", score:5, walletToken:token("3"), isBot:false }
    ],
    ...overrides
  };
}

test("public terminé distribue 60 / 40 / 25 aux trois premiers", () => {
  assert.deepEqual(
    calculateRewards(room()),
    { p1:60, p2:40, p3:25 }
  );
});

test("quick utilise aussi l'économie", () => {
  const rewards = calculateRewards(room({ mode:"quick" }));
  assert.equal(rewards.p1, 60);
  assert.equal(rewards.p2, 40);
});

test("privé ne distribue aucune pièce", () => {
  assert.deepEqual(
    calculateRewards(room({ mode:"private" })),
    { p1:0, p2:0, p3:0 }
  );
});

test("aucune récompense avant la fin réelle de la partie", () => {
  const notFinished = calculateRewards(room({ phase:"scoreboard" }));
  const wrongRound = calculateRewards(room({ rounds:3, roundIndex:1 }));

  assert.deepEqual(notFinished, { p1:0, p2:0, p3:0 });
  assert.deepEqual(wrongRound, { p1:0, p2:0, p3:0 });
});

test("la présence d'un bot désactive toutes les récompenses", () => {
  const players = [
    { id:"p1", score:12, walletToken:token("1"), isBot:false },
    { id:"p2", score:8, walletToken:token("2"), isBot:false },
    { id:"bot", score:6, walletToken:null, isBot:true }
  ];

  assert.deepEqual(
    calculateRewards(room({
      paidPlayerIds:["p1","p2"],
      players
    })),
    { p1:0, p2:0, bot:0 }
  );
});

test("un joueur non débité ne reçoit rien", () => {
  const rewards = calculateRewards(
    room({ paidPlayerIds:["p1","p3"] })
  );

  assert.equal(rewards.p1, 60);
  assert.equal(rewards.p2, 0);
  assert.equal(rewards.p3, 25);
});

test("les égalités utilisent le classement de compétition", () => {
  const rewards = calculateRewards(room({
    players: [
      { id:"p1", score:10, walletToken:token("1"), isBot:false },
      { id:"p2", score:10, walletToken:token("2"), isBot:false },
      { id:"p3", score:7, walletToken:token("3"), isBot:false }
    ]
  }));

  assert.deepEqual(rewards, {
    p1:60,
    p2:60,
    p3:25
  });
});
