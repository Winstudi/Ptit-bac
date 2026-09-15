"use strict";

const { isEconomyMode } = require("./room-mode-rules.js");

const MAX_LEVEL = 50;
const ROUND_XP = 10;
const VALID_ANSWER_XP = 2;
const RANK_BONUS = Object.freeze({ 1: 20, 2: 12, 3: 6 });

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function xpForNextLevel(level) {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  if (safeLevel >= MAX_LEVEL) return 0;
  return 100 + (safeLevel - 1) * 25;
}

function totalXpForLevel(level) {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const completedLevels = safeLevel - 1;
  return completedLevels * 100 + 25 * completedLevels * (completedLevels - 1) / 2;
}

function progressionFromTotalXp(value) {
  const totalXp = Math.max(0, Math.floor(Number(value) || 0));
  let level = 1;

  while (level < MAX_LEVEL && totalXp >= totalXpForLevel(level + 1)) {
    level += 1;
  }

  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      totalXp,
      xpIntoLevel: 0,
      xpForNext: 0,
      progress: 1,
      progressPercent: 100,
      maxLevel: true
    };
  }

  const levelStart = totalXpForLevel(level);
  const xpForNext = xpForNextLevel(level);
  const xpIntoLevel = Math.max(0, totalXp - levelStart);
  const progress = xpForNext > 0
    ? Math.max(0, Math.min(1, xpIntoLevel / xpForNext))
    : 1;

  return {
    level,
    totalXp,
    xpIntoLevel,
    xpForNext,
    progress,
    progressPercent: Math.round(progress * 10000) / 100,
    maxLevel: false
  };
}

function rankingForPlayers(players = []) {
  const ranked = [...players]
    .filter(player => !player?.isBot && player?.walletToken)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  const rankByPlayerId = {};
  let rank = 1;

  ranked.forEach((player, index) => {
    if (index > 0 && Number(player.score || 0) !== Number(ranked[index - 1].score || 0)) {
      rank = index + 1;
    }
    rankByPlayerId[player.id] = rank;
  });

  return rankByPlayerId;
}

function calculateRoomXp(room) {
  const results = Object.fromEntries((room?.players || []).map(player => [player.id, {
    xp: 0,
    rank: 0,
    validAnswers: 0,
    rounds: 0,
    eligible: false
  }]));

  if (!room || !isEconomyMode(room.mode)) return results;
  if (room.phase !== "finished") return results;
  if (!room.entryDebited || !room.gameSessionId) return results;
  if (Number(room.roundIndex) + 1 !== Number(room.rounds)) return results;
  if (!Array.isArray(room.players) || room.players.some(player => player?.isBot)) return results;

  const humans = room.players.filter(player => !player?.isBot && player?.walletToken);
  if (humans.length < 2) return results;

  const paid = new Set(room.paidPlayerIds || []);
  const ranks = rankingForPlayers(humans);
  const completedRounds = Math.max(0, Math.floor(Number(room.rounds) || 0));

  for (const player of humans) {
    if (!paid.has(player.id)) continue;

    const rank = ranks[player.id] || 0;
    // E3: l’XP récompense les réponses réellement validées,
    // indépendamment du score/classement de la partie.
    const validAnswers = Math.max(
      0,
      Math.floor(Number(player.validAnswerCount ?? player.score) || 0)
    );
    const xp =
      completedRounds * ROUND_XP +
      validAnswers * VALID_ANSWER_XP +
      (RANK_BONUS[rank] || 0);

    results[player.id] = {
      xp,
      rank,
      validAnswers,
      rounds: completedRounds,
      eligible: true
    };
  }

  return results;
}

function createProgressionService({ getPool }) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");

  let schemaPromise = null;

  function pool() {
    const value = getPool();
    if (!value) throw new Error("PostgreSQL indisponible");
    return value;
  }

  async function ensureSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
      const db = pool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_progression (
          wallet_token text PRIMARY KEY,
          total_xp integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
          completed_games integer NOT NULL DEFAULT 0 CHECK (completed_games >= 0),
          wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_progression_events (
          event_key text PRIMARY KEY,
          wallet_token text NOT NULL,
          room_code text,
          xp_delta integer NOT NULL CHECK (xp_delta >= 0),
          before_total_xp integer NOT NULL CHECK (before_total_xp >= 0),
          after_total_xp integer NOT NULL CHECK (after_total_xp >= 0),
          before_level integer NOT NULL,
          after_level integer NOT NULL,
          rank integer NOT NULL DEFAULT 0,
          valid_answers integer NOT NULL DEFAULT 0,
          rounds integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_progression_events_wallet_idx
        ON public.ptitbac_progression_events(wallet_token, created_at DESC)
      `);
    })().catch(err => {
      schemaPromise = null;
      throw err;
    });

    return schemaPromise;
  }

  async function ensurePlayer(walletToken, db = pool()) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide");

    await db.query(
      `INSERT INTO public.ptitbac_progression(wallet_token)
       VALUES($1)
       ON CONFLICT(wallet_token) DO NOTHING`,
      [token]
    );
    return token;
  }

  function publicState(row) {
    const progress = progressionFromTotalXp(row?.total_xp || 0);
    return {
      ...progress,
      completedGames: Math.max(0, Number(row?.completed_games) || 0),
      wins: Math.max(0, Number(row?.wins) || 0)
    };
  }

  async function getState(walletToken) {
    await ensureSchema();
    const db = pool();
    const token = await ensurePlayer(walletToken, db);
    const result = await db.query(
      `SELECT total_xp, completed_games, wins
         FROM public.ptitbac_progression
        WHERE wallet_token=$1
        LIMIT 1`,
      [token]
    );
    return publicState(result.rows?.[0] || {});
  }

  async function awardOne(player, room, details) {
    const db = pool();
    const client = await db.connect();
    const token = validWalletToken(player.walletToken);
    const eventKey = `game-xp:${room.code}:${room.gameSessionId}:${player.id}`;

    try {
      await client.query("BEGIN");
      await ensurePlayer(token, client);

      const locked = await client.query(
        `SELECT total_xp, completed_games, wins
           FROM public.ptitbac_progression
          WHERE wallet_token=$1
          FOR UPDATE`,
        [token]
      );

      const beforeRow = locked.rows?.[0] || { total_xp: 0, completed_games: 0, wins: 0 };
      const existing = await client.query(
        `SELECT xp_delta, before_total_xp, after_total_xp, before_level, after_level,
                rank, valid_answers, rounds
           FROM public.ptitbac_progression_events
          WHERE event_key=$1
          LIMIT 1`,
        [eventKey]
      );

      if (existing.rowCount) {
        await client.query("ROLLBACK");
        const event = existing.rows[0];
        const after = await getState(token);
        return {
          eventKey,
          duplicate: true,
          gainedXp: Number(event.xp_delta) || 0,
          rank: Number(event.rank) || 0,
          validAnswers: Number(event.valid_answers) || 0,
          rounds: Number(event.rounds) || 0,
          before: progressionFromTotalXp(event.before_total_xp),
          after,
          levelUp: Number(event.after_level) > Number(event.before_level)
        };
      }

      const before = progressionFromTotalXp(beforeRow.total_xp);
      const gainedXp = Math.max(0, Math.floor(Number(details.xp) || 0));
      const nextTotalXp = Math.max(0, Number(beforeRow.total_xp) + gainedXp);
      const afterProgress = progressionFromTotalXp(nextTotalXp);
      const winDelta = Number(details.rank) === 1 ? 1 : 0;

      await client.query(
        `UPDATE public.ptitbac_progression
            SET total_xp=$2,
                completed_games=completed_games+1,
                wins=wins+$3,
                updated_at=now()
          WHERE wallet_token=$1`,
        [token, nextTotalXp, winDelta]
      );

      await client.query(
        `INSERT INTO public.ptitbac_progression_events(
          event_key, wallet_token, room_code, xp_delta,
          before_total_xp, after_total_xp, before_level, after_level,
          rank, valid_answers, rounds
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventKey,
          token,
          String(room.code || "").slice(0, 8),
          gainedXp,
          Number(beforeRow.total_xp) || 0,
          nextTotalXp,
          before.level,
          afterProgress.level,
          Number(details.rank) || 0,
          Number(details.validAnswers) || 0,
          Number(details.rounds) || 0
        ]
      );

      await client.query("COMMIT");

      const after = {
        ...afterProgress,
        completedGames: Math.max(0, Number(beforeRow.completed_games) || 0) + 1,
        wins: Math.max(0, Number(beforeRow.wins) || 0) + winDelta
      };

      return {
        eventKey,
        duplicate: false,
        gainedXp,
        rank: Number(details.rank) || 0,
        validAnswers: Number(details.validAnswers) || 0,
        rounds: Number(details.rounds) || 0,
        before: {
          ...before,
          completedGames: Math.max(0, Number(beforeRow.completed_games) || 0),
          wins: Math.max(0, Number(beforeRow.wins) || 0)
        },
        after,
        levelUp: after.level > before.level
      };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async function awardRoom(room) {
    const calculated = calculateRoomXp(room);
    const results = {};
    const hasAward = Object.values(calculated).some(item => item?.eligible && item?.xp > 0);
    if (!hasAward) return results;

    await ensureSchema();

    for (const player of room?.players || []) {
      const details = calculated[player.id];
      if (!details?.eligible || !details.xp || !validWalletToken(player.walletToken)) continue;
      results[player.id] = await awardOne(player, room, details);
    }

    return results;
  }

  return {
    ensureSchema,
    getState,
    awardRoom
  };
}

module.exports = {
  MAX_LEVEL,
  ROUND_XP,
  VALID_ANSWER_XP,
  RANK_BONUS,
  validWalletToken,
  xpForNextLevel,
  totalXpForLevel,
  progressionFromTotalXp,
  rankingForPlayers,
  calculateRoomXp,
  createProgressionService
};
