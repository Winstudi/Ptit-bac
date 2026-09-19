"use strict";

const crypto = require("crypto");
const { progressionFromTotalXp } = require("./progression-service.js");

const QUEST_POOL = Object.freeze([
  Object.freeze({
    id:"wins_3",
    kind:"wins",
    target:3,
    xp:100,
    title:"Gagner 3 parties",
    description:"Remporte 3 parties aujourd’hui.",
    icon:"trophy"
  }),
  Object.freeze({
    id:"wins_5",
    kind:"wins",
    target:5,
    xp:200,
    title:"Gagner 5 parties",
    description:"Remporte 5 parties aujourd’hui.",
    icon:"trophy"
  }),
  Object.freeze({
    id:"answers_5",
    kind:"answers",
    target:5,
    xp:80,
    title:"Valider 5 réponses",
    description:"Fais valider 5 réponses dans tes parties.",
    icon:"answers"
  }),
  Object.freeze({
    id:"answers_10",
    kind:"answers",
    target:10,
    xp:200,
    title:"Valider 10 réponses",
    description:"Fais valider 10 réponses dans tes parties.",
    icon:"answers"
  }),
  Object.freeze({
    id:"rerolls_3",
    kind:"rerolls",
    target:3,
    xp:100,
    title:"Relancer 3 parties",
    description:"Utilise 3 relances dans tes parties.",
    icon:"reroll"
  })
]);

const PARIS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone:"Europe/Paris",
  year:"numeric",
  month:"2-digit",
  day:"2-digit",
  hour:"2-digit",
  minute:"2-digit",
  second:"2-digit",
  hourCycle:"h23"
});

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function parisParts(ms = Date.now()) {
  const out = {};
  for (const part of PARIS_FORMATTER.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year:out.year,
    month:out.month,
    day:out.day,
    hour:out.hour,
    minute:out.minute,
    second:out.second
  };
}

function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + amount,
    12, 0, 0
  ));
  return {
    year:date.getUTCFullYear(),
    month:date.getUTCMonth() + 1,
    day:date.getUTCDate()
  };
}

function parisOffsetMs(utcMs) {
  const p = parisParts(utcMs);
  const represented = Date.UTC(
    p.year, p.month - 1, p.day,
    p.hour, p.minute, p.second
  );
  return represented - Math.floor(utcMs / 1000) * 1000;
}

function parisLocalToUtcMs(parts, hour = 11) {
  const base = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour, 0, 0
  );
  let guess = base;
  for (let i = 0; i < 3; i += 1) {
    guess = base - parisOffsetMs(guess);
  }
  return guess;
}

function questWindow(now = Date.now()) {
  const local = parisParts(now);
  const activeDate = local.hour < 11
    ? addCalendarDays(local, -1)
    : { year:local.year, month:local.month, day:local.day };
  const nextDate = local.hour < 11
    ? { year:local.year, month:local.month, day:local.day }
    : addCalendarDays(local, 1);

  const key = [
    activeDate.year,
    String(activeDate.month).padStart(2, "0"),
    String(activeDate.day).padStart(2, "0")
  ].join("-");

  return {
    key,
    startsAt:parisLocalToUtcMs(activeDate, 11),
    endsAt:parisLocalToUtcMs(nextDate, 11)
  };
}

function dailyQuests(rotationKey) {
  const list = QUEST_POOL.map(item => ({ ...item }));
  const bytes = crypto
    .createHash("sha256")
    .update(`ptitbac-quests:${rotationKey}`)
    .digest();

  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = bytes[list.length - 1 - i] % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }

  return list.slice(0, 3);
}

function publicProgression(row = {}) {
  return {
    ...progressionFromTotalXp(row.total_xp || 0),
    trophies:Math.max(0, Number(row.trophies) || 0),
    completedGames:Math.max(0, Number(row.completed_games) || 0),
    wins:Math.max(0, Number(row.wins) || 0)
  };
}

function createQuestsService({
  getPool,
  ensureSchema
} = {}) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");
  if (typeof ensureSchema !== "function") throw new TypeError("ensureSchema requis");

  let schemaPromise = null;

  async function db() {
    await ensureQuestSchema();
    const pool = getPool();
    if (!pool) throw new Error("PostgreSQL indisponible");
    return pool;
  }

  async function ensureQuestSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
      await ensureSchema();
      const pool = getPool();
      if (!pool) throw new Error("PostgreSQL indisponible");

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_quest_claims(
          wallet_token text NOT NULL,
          rotation_key text NOT NULL,
          quest_id text NOT NULL,
          xp_reward integer NOT NULL DEFAULT 0 CHECK(xp_reward >= 0),
          claimed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,rotation_key,quest_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_quest_chest_claims(
          wallet_token text NOT NULL,
          cycle_no integer NOT NULL CHECK(cycle_no >= 1),
          reward_result jsonb NOT NULL DEFAULT '{}'::jsonb,
          claimed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,cycle_no)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_quest_claims_wallet_idx
          ON public.ptitbac_quest_claims(wallet_token,claimed_at DESC)
      `);

      return pool;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });

    return schemaPromise;
  }

  async function statsForWindow(walletToken, window) {
    const pool = await db();
    const [gameStats, rerollStats] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (
             WHERE rank=1 AND event_key LIKE 'game-xp:%'
           )::int AS wins,
           COALESCE(SUM(valid_answers) FILTER (
             WHERE event_key LIKE 'game-xp:%'
           ),0)::int AS answers
         FROM public.ptitbac_progression_events
        WHERE wallet_token=$1
          AND created_at >= to_timestamp($2::double precision / 1000.0)
          AND created_at <  to_timestamp($3::double precision / 1000.0)`,
        [walletToken, window.startsAt, window.endsAt]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS rerolls
           FROM public.economy_transactions
          WHERE wallet_token=$1
            AND kind IN ('CATEGORY_REROLL','LETTER_REROLL')
            AND created_at >= to_timestamp($2::double precision / 1000.0)
            AND created_at <  to_timestamp($3::double precision / 1000.0)`,
        [walletToken, window.startsAt, window.endsAt]
      )
    ]);

    return {
      wins:Math.max(0, Number(gameStats.rows?.[0]?.wins) || 0),
      answers:Math.max(0, Number(gameStats.rows?.[0]?.answers) || 0),
      rerolls:Math.max(0, Number(rerollStats.rows?.[0]?.rerolls) || 0)
    };
  }

  async function claimedIds(walletToken, rotationKey) {
    const pool = await db();
    const q = await pool.query(
      `SELECT quest_id
         FROM public.ptitbac_quest_claims
        WHERE wallet_token=$1 AND rotation_key=$2`,
      [walletToken, rotationKey]
    );
    return new Set((q.rows || []).map(row => String(row.quest_id || "")));
  }

  async function chestStatus(walletToken) {
    const pool = await db();
    const [questClaims, chestClaims] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS count
           FROM public.ptitbac_quest_claims
          WHERE wallet_token=$1`,
        [walletToken]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
           FROM public.ptitbac_quest_chest_claims
          WHERE wallet_token=$1`,
        [walletToken]
      )
    ]);

    const totalClaims = Math.max(0, Number(questClaims.rows?.[0]?.count) || 0);
    const claimedChests = Math.max(0, Number(chestClaims.rows?.[0]?.count) || 0);
    const consumed = claimedChests * 4;
    const pending = Math.max(0, totalClaims - consumed);

    return {
      progress:Math.min(4, pending),
      required:4,
      claimable:pending >= 4,
      claimedChests,
      nextCycle:claimedChests + 1,
      totalValidated:totalClaims
    };
  }

  function progressForQuest(quest, stats) {
    return Math.max(
      0,
      Math.min(
        Number(quest.target) || 1,
        Number(stats?.[quest.kind]) || 0
      )
    );
  }

  async function status(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide.");

    const window = questWindow();
    const active = dailyQuests(window.key);
    const [stats, claimed, chest] = await Promise.all([
      statsForWindow(token, window),
      claimedIds(token, window.key),
      chestStatus(token)
    ]);

    return {
      rotationKey:window.key,
      startsAt:window.startsAt,
      refreshAt:window.endsAt,
      serverNow:Date.now(),
      quests:active.map(quest => {
        const progress = progressForQuest(quest, stats);
        return {
          ...quest,
          progress,
          completed:progress >= quest.target,
          claimed:claimed.has(quest.id)
        };
      }),
      chest
    };
  }

  async function awardBonusXp(walletToken, xpValue, eventKey) {
    const token = validWalletToken(walletToken);
    const xp = Math.max(0, Math.floor(Number(xpValue) || 0));
    const key = String(eventKey || "").slice(0, 180);
    if (!token || !xp || !key) throw new Error("Récompense XP invalide.");

    const pool = await db();
    const client = await pool.connect();
    let finished = false;

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO public.ptitbac_progression(wallet_token)
         VALUES($1)
         ON CONFLICT(wallet_token) DO NOTHING`,
        [token]
      );

      const locked = await client.query(
        `SELECT total_xp,trophies,completed_games,wins
           FROM public.ptitbac_progression
          WHERE wallet_token=$1
          FOR UPDATE`,
        [token]
      );

      const existing = await client.query(
        `SELECT xp_delta
           FROM public.ptitbac_progression_events
          WHERE event_key=$1
          LIMIT 1`,
        [key]
      );

      if (existing.rowCount) {
        await client.query("COMMIT");
        finished = true;
        const row = locked.rows?.[0] || {};
        return {
          duplicate:true,
          gainedXp:Number(existing.rows[0].xp_delta) || xp,
          state:publicProgression(row)
        };
      }

      const beforeRow = locked.rows?.[0] || {
        total_xp:0,
        trophies:0,
        completed_games:0,
        wins:0
      };
      const beforeXp = Math.max(0, Number(beforeRow.total_xp) || 0);
      const beforeTrophies = Math.max(0, Number(beforeRow.trophies) || 0);
      const afterXp = beforeXp + xp;
      const beforeLevel = progressionFromTotalXp(beforeXp).level;
      const afterLevel = progressionFromTotalXp(afterXp).level;

      await client.query(
        `UPDATE public.ptitbac_progression
            SET total_xp=$2,updated_at=now()
          WHERE wallet_token=$1`,
        [token, afterXp]
      );

      await client.query(
        `INSERT INTO public.ptitbac_progression_events(
           event_key,wallet_token,room_code,xp_delta,trophy_delta,
           before_total_xp,after_total_xp,
           before_trophies,after_trophies,
           before_level,after_level,
           rank,valid_answers,rounds
         ) VALUES(
           $1,$2,NULL,$3,0,$4,$5,$6,$6,$7,$8,0,0,0
         )`,
        [
          key,
          token,
          xp,
          beforeXp,
          afterXp,
          beforeTrophies,
          beforeLevel,
          afterLevel
        ]
      );

      await client.query("COMMIT");
      finished = true;

      return {
        duplicate:false,
        gainedXp:xp,
        state:{
          ...progressionFromTotalXp(afterXp),
          trophies:beforeTrophies,
          completedGames:Math.max(0, Number(beforeRow.completed_games) || 0),
          wins:Math.max(0, Number(beforeRow.wins) || 0)
        }
      };
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function claimQuest(walletToken, questId) {
    const token = validWalletToken(walletToken);
    const id = String(questId || "").trim();
    if (!token || !id) throw new Error("Quête invalide.");

    const current = await status(token);
    const quest = current.quests.find(item => item.id === id);
    if (!quest) throw new Error("Cette quête n’est pas active aujourd’hui.");
    if (!quest.completed) throw new Error("Cette quête n’est pas encore terminée.");

    const pool = await db();
    const existing = await pool.query(
      `SELECT xp_reward
         FROM public.ptitbac_quest_claims
        WHERE wallet_token=$1 AND rotation_key=$2 AND quest_id=$3
        LIMIT 1`,
      [token, current.rotationKey, id]
    );

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 16);

    const award = await awardBonusXp(
      token,
      quest.xp,
      `quest-xp:${tokenHash}:${current.rotationKey}:${quest.id}`
    );

    if (!existing.rowCount) {
      await pool.query(
        `INSERT INTO public.ptitbac_quest_claims(
           wallet_token,rotation_key,quest_id,xp_reward
         ) VALUES($1,$2,$3,$4)
         ON CONFLICT(wallet_token,rotation_key,quest_id) DO NOTHING`,
        [token,current.rotationKey,quest.id,quest.xp]
      );
    }

    const nextStatus = await status(token);

    return {
      duplicate:existing.rowCount > 0 || award.duplicate,
      questId:quest.id,
      gainedXp:quest.xp,
      progression:award.state,
      status:nextStatus
    };
  }

  async function chestEligibility(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide.");
    return chestStatus(token);
  }

  async function confirmChestClaim(walletToken, cycleNo, rewardResult = {}) {
    const token = validWalletToken(walletToken);
    const cycle = Math.max(1, Math.floor(Number(cycleNo) || 0));
    if (!token || !cycle) throw new Error("Coffre de quêtes invalide.");

    const pool = await db();
    await pool.query(
      `INSERT INTO public.ptitbac_quest_chest_claims(
         wallet_token,cycle_no,reward_result
       ) VALUES($1,$2,$3::jsonb)
       ON CONFLICT(wallet_token,cycle_no) DO NOTHING`,
      [token,cycle,JSON.stringify(rewardResult || {})]
    );

    return status(token);
  }

  return {
    ensureSchema:ensureQuestSchema,
    status,
    claimQuest,
    chestEligibility,
    confirmChestClaim
  };
}

module.exports = {
  QUEST_POOL,
  questWindow,
  dailyQuests,
  createQuestsService
};
