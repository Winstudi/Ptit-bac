"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./public-bot-engine-v1.cjs");
const {
  patchRoomModeSource,
  patchProgressionSource
} = require("./apply-public-bots-v1.cjs");

test("les bots matchmaking sont identifiés uniquement côté serveur", () => {
  assert.equal(engine.isMatchmakingBot({ isBot:true, botKind:"matchmaking" }), true);
  assert.equal(engine.isMatchmakingBot({ isBot:true, botKind:"test" }), false);
  assert.equal(engine.isMatchmakingBot({ isBot:false, botKind:"matchmaking" }), false);
});

test("une identité automatique évite les noms et avatars déjà présents", () => {
  const random = () => 0;
  const profile = engine.pickIdentity([
    { name:"Léa", avatar:"🧠" },
    { name:"Lucas", avatar:"🐱" }
  ], random);
  assert.notEqual(profile.name, "Léa");
  assert.notEqual(profile.avatar, "🧠");
});

test("les difficultés modifient réellement le niveau et le rythme", () => {
  const base = { missRate:.10, riskyRate:.06, pace:1 };
  const weak = engine.applyDifficulty(base, "weak");
  const strong = engine.applyDifficulty(base, "strong");
  assert.ok(weak.missRate > strong.missRate);
  assert.ok(weak.pace > strong.pace);
  assert.ok(weak.riskyRate > strong.riskyRate);
});

test("un bot n'est ajouté qu'à un lobby public/rapide réellement vide d'adversaire", () => {
  const base = {
    mode:"quick",
    phase:"lobby",
    players:[{ isBot:false, connected:true }],
    economyStartPending:false
  };
  assert.equal(engine.shouldFillRoom(base), true);
  assert.equal(engine.shouldFillRoom({
    ...base,
    players:[
      { isBot:false, connected:true },
      { isBot:false, connected:true }
    ]
  }), false);
  assert.equal(engine.shouldFillRoom({
    ...base,
    players:[
      { isBot:false, connected:true },
      { isBot:true, botKind:"matchmaking" }
    ]
  }), false);
});

test("les salons publics restent découvrables avec un bot matchmaking mais pas un bot test", () => {
  const source = `"use strict";
function isPublicRoomDiscoverable(room, now = Date.now()) {
  if (!room || normalizeRoomMode(room.mode) !== "public") return false;
  if (room.phase !== "lobby" || room.economyStartPending) return false;
  if (!Array.isArray(room.players) || room.players.length < 1 || room.players.length >= 6) return false;
  if (room.players.some(player => player?.isBot)) return false;
  if (!room.players.some(player => player?.isHost && !player?.isBot && player?.connected)) return false;
  if (Number(room.ptbCountdownUntil || 0) > Number(now || Date.now())) return false;
  return true;
}`;
  const result = patchRoomModeSource(source);
  assert.equal(result.changed, true);
  assert.match(result.source, /botKind !== "matchmaking"/);
});

test("la progression matchmaking garde le XP humain et protège les récompenses", () => {
  const source = `
function calculateRoomXp(room) {
  const results = {};
  if (!Array.isArray(room.players) || room.players.some(player => player?.isBot)) return results;

  const humans = room.players.filter(player => !player?.isBot && player?.walletToken);
  if (humans.length < 2) return results;

  const paid = new Set(room.paidPlayerIds || []);
  const ranks = rankingForPlayers(humans);
  const completedRounds = 1;

  for (const player of humans) {
    if (!paid.has(player.id)) continue;
    const rank = ranks[player.id] || 0;
    // E3: l’XP récompense les réponses réellement validées,
    const validAnswers = 6;
    const xp =
      completedRounds * ROUND_XP +
      validAnswers * VALID_ANSWER_XP +
      (RANK_BONUS[rank] || 0);
    results[player.id] = {
      xp,
      trophies: TROPHY_REWARDS[rank] ?? TROPHY_REWARDS.default,
      rank
    };
  }
  return results;
}
`;
  const result = patchProgressionSource(source);
  assert.equal(result.changed, true);
  assert.match(result.source, /rankingForAllParticipants/);
  assert.match(result.source, /botKind === "matchmaking"/);
  assert.match(result.source, /competitiveHumanRewards/);
  assert.match(result.source, /trophies: competitiveHumanRewards/);
});
