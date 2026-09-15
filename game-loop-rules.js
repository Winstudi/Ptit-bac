"use strict";

function shouldRefundEntryOnLeave(room) {
  if (!room) return false;

  // Dès que le choix des catégories commence, la partie est considérée
  // comme engagée : quitter ne rembourse plus la vie.
  return String(room.phase || "") === "lobby";
}

function isFinalScoreboard(room) {
  if (!room || room.phase !== "scoreboard") return false;
  const rounds = Math.max(1, Math.floor(Number(room.rounds) || 1));
  const roundIndex = Math.floor(Number(room.roundIndex) || 0);
  return roundIndex + 1 >= rounds;
}

function nextHostCandidate(players = [], excludedPlayerId = "") {
  const available = players.filter(
    player => player && player.id !== excludedPlayerId
  );

  return (
    available.find(player => !player.isBot && player.connected) ||
    available.find(player => !player.isBot) ||
    available.find(player => player.connected) ||
    available[0] ||
    null
  );
}

function canAdvanceScoreboard(room, player) {
  if (!room || !player || room.phase !== "scoreboard") return false;
  return room.mode === "quick" || player.isHost === true;
}

module.exports = {
  shouldRefundEntryOnLeave,
  isFinalScoreboard,
  nextHostCandidate,
  canAdvanceScoreboard
};
