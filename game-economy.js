"use strict";

const { isEconomyMode } = require("./room-mode-rules.js");
const { RANK_REWARDS } = require("./economy-config.js");

function calculateRewards(room) {
  const rewards = Object.fromEntries(room.players.map(player => [player.id, 0]));

  if (
    !isEconomyMode(room.mode) ||
    !room.entryDebited ||
    room.phase !== "finished" ||
    room.roundIndex + 1 !== room.rounds ||
    room.players.some(player => player.isBot)
  ) {
    return rewards;
  }

  const players = room.players
    .filter(player => player.walletToken)
    .sort((a, b) => b.score - a.score);

  if (players.length < 2) return rewards;

  const paid = new Set(room.paidPlayerIds || []);
  let rank = 1;

  players.forEach((player, index) => {
    if (index && player.score !== players[index - 1].score) {
      rank = index + 1;
    }

    if (paid.has(player.id)) {
      rewards[player.id] =
        RANK_REWARDS[rank] ?? RANK_REWARDS.default;
    }
  });

  return rewards;
}

module.exports = { calculateRewards };
