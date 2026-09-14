"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");

const ADMIN_CODE = String(process.env.PTITBAC_ADMIN_CODE || "").trim();
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? false
    : { rejectUnauthorized:false },
  max:2,
  idleTimeoutMillis:30000,
  connectionTimeoutMillis:10000
}) : null;

const infiniteCoins =
  global.__ptbInfiniteCoins ||
  (global.__ptbInfiniteCoins = new Set());

const infiniteLives =
  global.__ptbInfiniteLives ||
  (global.__ptbInfiniteLives = new Set());

const gemOverrides = new Map();
let schemaPromise = null;

const ITEM_CATALOG = [
  { key:"epic_chest", label:"Coffre épique", icon:"🎁" },
  { key:"mystery_box", label:"Boîte mystère", icon:"📦" },
  { key:"avatar_token", label:"Jeton avatar", icon:"👤" },
  { key:"future_badge", label:"Badge spécial", icon:"🏅" }
];

function walletToken(value) {
  value = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(value) ? value : "";
}

function friendCode(value) {
  value = String(value || "").replace(/^#/,"").trim();
  return /^\d{5}$/.test(value) ? value : "";
}

function id() {
  return crypto.randomBytes(12).toString("hex");
}

function clampResource(value) {
  return Math.max(0, Math.min(999999, Math.floor(Number(value) || 0)));
}

function normalizeLearningValue(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

function learnedAnswerKey(category, answer) {
  return `${normalizeLearningValue(category)}|${normalizeLearningValue(answer)}`;
}

async function schema() {
  if (!pool) throw new Error("DATABASE_URL manquant");
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_admin_owner(
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        wallet_token text UNIQUE NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_admin_settings(
        wallet_token text PRIMARY KEY,
        infinite_coins boolean NOT NULL DEFAULT false,
        infinite_lives boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_feedback_reports(
        id text PRIMARY KEY,
        report_type text NOT NULL CHECK(report_type IN ('report-avis','report-bug')),
        wallet_token text,
        friend_code text,
        player_name text,
        message text NOT NULL,
        room_code text,
        category text,
        answer text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_learned_answers(
        answer_key text PRIMARY KEY,
        category text NOT NULL,
        answer text NOT NULL,
        status text NOT NULL,
        confidence integer NOT NULL,
        source text NOT NULL,
        support_count integer NOT NULL DEFAULT 1,
        updated_at bigint NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_answer_reports(
        id text PRIMARY KEY,
        room_code text,
        player_id text,
        round_index integer,
        category text NOT NULL,
        answer text NOT NULL,
        letter text NOT NULL,
        original_reason text,
        status text NOT NULL,
        review_verdict text,
        review_confidence integer,
        created_at bigint NOT NULL,
        reviewed_at bigint
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_player_items(
        wallet_token text NOT NULL,
        item_key text NOT NULL,
        quantity integer NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(wallet_token,item_key)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ptitbac_admin_logs(
        id text PRIMARY KEY,
        admin_wallet_token text NOT NULL,
        action text NOT NULL,
        target_friend_code text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  })();

  return schemaPromise;
}

async function ownerToken() {
  await schema();
  const q = await pool.query(
    "SELECT wallet_token FROM ptitbac_admin_owner WHERE singleton=true LIMIT 1"
  );
  return q.rows[0]?.wallet_token || "";
}

async function isAdmin(token) {
  token = walletToken(token);
  return !!token && token === await ownerToken();
}

async function settings(token) {
  await schema();
  const q = await pool.query(
    "SELECT infinite_coins,infinite_lives FROM ptitbac_admin_settings WHERE wallet_token=$1",
    [token]
  );
  return q.rows[0] || {
    infinite_coins:false,
    infinite_lives:false
  };
}

async function audit(adminToken, action, targetCode = null, details = {}) {
  try {
    await pool.query(
      `INSERT INTO ptitbac_admin_logs
       (id,admin_wallet_token,action,target_friend_code,details)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        id(),
        adminToken,
        String(action || "").slice(0,80),
        targetCode || null,
        JSON.stringify(details || {})
      ]
    );
  } catch {}
}

async function applyFlags(token) {
  const s = await settings(token);

  s.infinite_coins
    ? infiniteCoins.add(token)
    : infiniteCoins.delete(token);

  s.infinite_lives
    ? infiniteLives.add(token)
    : infiniteLives.delete(token);

  if (s.infinite_coins) {
    global.__ptbAdminSetCoins?.(token, 999999);
  }

  if (s.infinite_lives && pool) {
    await pool.query(
      `UPDATE public.users
       SET lives=5,life_updated_at=now(),updated_at=now()
       WHERE wallet_token=$1`,
      [token]
    ).catch(()=>{});
  }

  return s;
}

async function findUserByCode(code) {
  code = friendCode(code);
  if (!code) return null;

  const q = await pool.query(
    `SELECT id,friend_code,username,avatar,wallet_token,lives,
            created_at,last_seen,updated_at
     FROM public.users
     WHERE friend_code=$1 OR friend_code=$2
     LIMIT 1`,
    [code, "PLAYER#" + code.slice(-4)]
  ).catch(() => ({ rows:[] }));

  return q.rows[0] || null;
}

async function getWallet(token) {
  const q = await pool.query(
    `SELECT coins,gems,created_at,updated_at
     FROM ptitbac_wallets
     WHERE token=$1
     LIMIT 1`,
    [token]
  ).catch(() => ({ rows:[] }));

  return q.rows[0] || {
    coins:0,
    gems:0,
    created_at:Date.now(),
    updated_at:Date.now()
  };
}

function emitToWallet(io, targetToken, payload = {}) {
  for (const socket of io.sockets.sockets.values()) {
    if (String(socket.data?.walletToken || "") !== targetToken) continue;

    if (Number.isFinite(Number(payload.coins))) {
      socket.emit("wallet:update", {
        balance:Number(payload.coins)
      });
    }

    socket.emit("economy:update", payload);
  }
}

async function updateResource(io, {
  adminToken,
  code,
  resource,
  mode,
  amount
}) {
  const user = await findUserByCode(code);

  if (!user?.wallet_token) {
    throw new Error("Joueur introuvable.");
  }

  const targetToken = walletToken(user.wallet_token);
  if (!targetToken) {
    throw new Error("Portefeuille du joueur introuvable.");
  }

  const wallet = await getWallet(targetToken);
  const current =
    resource === "gems"
      ? Number(wallet.gems || 0)
      : Number(wallet.coins || 0);

  const safeAmount = clampResource(amount);
  const next = clampResource(
    mode === "add"
      ? current + safeAmount
      : safeAmount
  );

  const now = Date.now();

  if (resource === "coins") {
    await pool.query(
      `INSERT INTO ptitbac_wallets
       (token,coins,gems,created_at,updated_at,history)
       VALUES($1,$2,$3,$4,$4,'[]'::jsonb)
       ON CONFLICT(token) DO UPDATE SET
         coins=$2,
         updated_at=$4`,
      [targetToken,next,Number(wallet.gems || 0),now]
    );

    await pool.query(
      `UPDATE public.users
       SET coins=$2,updated_at=now()
       WHERE wallet_token=$1`,
      [targetToken,next]
    ).catch(()=>{});

    global.__ptbAdminSetCoins?.(targetToken, next);
  } else {
    await pool.query(
      `INSERT INTO ptitbac_wallets
       (token,coins,gems,created_at,updated_at,history)
       VALUES($1,$2,$3,$4,$4,'[]'::jsonb)
       ON CONFLICT(token) DO UPDATE SET
         gems=$3,
         updated_at=$4`,
      [targetToken,Number(wallet.coins || 0),next,now]
    );

    // Les gemmes ne sont pas encore consommées par le gameplay.
    // Cet overlay garde l'UI du joueur synchronisée jusqu'à ce que
    // la future économie des gemmes soit branchée partout.
    gemOverrides.set(targetToken, next);
  }

  const fresh = await getWallet(targetToken);

  emitToWallet(io, targetToken, {
    coins:resource === "coins" ? next : Number(fresh.coins || 0),
    gems:resource === "gems" ? next : Number(fresh.gems || 0)
  });

  await audit(
    adminToken,
    `resource_${mode}_${resource}`,
    friendCode(code),
    {
      before:current,
      amount:safeAmount,
      after:next
    }
  );

  return {
    name:user.username || "Joueur",
    friendCode:user.friend_code,
    coins:resource === "coins" ? next : Number(fresh.coins || 0),
    gems:resource === "gems" ? next : Number(fresh.gems || 0)
  };
}

function installAdmin(io) {
  const lifeTimer = setInterval(async () => {
    if (!pool || !infiniteLives.size) return;

    for (const token of infiniteLives) {
      await pool.query(
        `UPDATE public.users
         SET lives=5,life_updated_at=now(),updated_at=now()
         WHERE wallet_token=$1`,
        [token]
      ).catch(()=>{});
    }
  }, 1200);

  lifeTimer.unref?.();

  // Filet de synchronisation des gemmes pour les comptes modifiés
  // depuis le panneau admin.
  const gemTimer = setInterval(() => {
    for (const [targetToken, gems] of gemOverrides) {
      emitToWallet(io, targetToken, { gems });
    }
  }, 2500);

  gemTimer.unref?.();

  io.on("connection", socket => {
    socket.on("admin:status", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);
        const admin = await isAdmin(token);

        if (!admin) {
          return cb({
            ok:true,
            admin:false
          });
        }

        const s = await applyFlags(token);

        cb({
          ok:true,
          admin:true,
          infiniteCoins:!!s.infinite_coins,
          infiniteLives:!!s.infinite_lives
        });
      } catch {
        cb({
          ok:false,
          admin:false
        });
      }
    });

    socket.on("admin:claim", async (payload={}, cb=()=>{}) => {
      try {
        await schema();

        const token = walletToken(payload.walletToken);

        if (
          !token ||
          !ADMIN_CODE ||
          String(payload.code || "").trim() !== ADMIN_CODE
        ) {
          return cb({
            ok:false,
            error:"Code admin incorrect."
          });
        }

        const current = await ownerToken();

        if (current && current !== token) {
          return cb({
            ok:false,
            error:"Un administrateur est déjà enregistré."
          });
        }

        await pool.query(
          `INSERT INTO ptitbac_admin_owner(singleton,wallet_token)
           VALUES(true,$1)
           ON CONFLICT(singleton) DO NOTHING`,
          [token]
        );

        await pool.query(
          `INSERT INTO ptitbac_admin_settings(wallet_token)
           VALUES($1)
           ON CONFLICT(wallet_token) DO NOTHING`,
          [token]
        );

        cb({
          ok:true,
          admin:true
        });
      } catch {
        cb({
          ok:false,
          error:"Activation admin impossible."
        });
      }
    });

    socket.on("admin:selfSettings", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const coins = !!payload.infiniteCoins;
        const lives = !!payload.infiniteLives;

        await pool.query(
          `INSERT INTO ptitbac_admin_settings
           (wallet_token,infinite_coins,infinite_lives,updated_at)
           VALUES($1,$2,$3,now())
           ON CONFLICT(wallet_token) DO UPDATE SET
             infinite_coins=$2,
             infinite_lives=$3,
             updated_at=now()`,
          [token,coins,lives]
        );

        await applyFlags(token);
        await audit(token, "self_settings", null, {
          infiniteCoins:coins,
          infiniteLives:lives
        });

        let balance = null;

        if (coins) {
          balance =
            global.__ptbAdminSetCoins?.(token,999999) ??
            999999;
        } else {
          const q = await pool.query(
            "SELECT coins FROM ptitbac_wallets WHERE token=$1 LIMIT 1",
            [token]
          ).catch(() => ({ rows:[] }));

          balance = Number(q.rows[0]?.coins ?? 0);
        }

        if (Number.isFinite(Number(balance))) {
          socket.emit("wallet:update", {
            balance:Number(balance)
          });
        }

        cb({
          ok:true,
          infiniteCoins:coins,
          infiniteLives:lives,
          balance
        });
      } catch {
        cb({
          ok:false,
          error:"Modification impossible."
        });
      }
    });

    // Compatibilité avec l'ancien client.
    socket.on("admin:addCoins", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const result = await updateResource(io, {
          adminToken:token,
          code:payload.friendCode,
          resource:"coins",
          mode:"add",
          amount:payload.amount
        });

        cb({
          ok:true,
          name:result.name,
          balance:result.coins
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Ajout de pièces impossible."
        });
      }
    });

    socket.on("admin:resourceAdjust", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const resource =
          payload.resource === "gems"
            ? "gems"
            : "coins";

        const mode =
          payload.mode === "add"
            ? "add"
            : "set";

        const code = friendCode(payload.friendCode);
        const amount = clampResource(payload.amount);

        if (!code) {
          return cb({
            ok:false,
            error:"ID joueur invalide."
          });
        }

        const result = await updateResource(io, {
          adminToken:token,
          code,
          resource,
          mode,
          amount
        });

        cb({
          ok:true,
          ...result
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Modification impossible."
        });
      }
    });

    socket.on("admin:itemCatalog", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        cb({
          ok:true,
          items:ITEM_CATALOG
        });
      } catch {
        cb({
          ok:false,
          error:"Catalogue indisponible."
        });
      }
    });

    socket.on("admin:grantItem", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const code = friendCode(payload.friendCode);
        const itemKey = String(payload.itemKey || "").trim();
        const quantity = Math.max(
          1,
          Math.min(99,Math.floor(Number(payload.quantity) || 1))
        );

        const item = ITEM_CATALOG.find(entry => entry.key === itemKey);

        if (!code || !item) {
          return cb({
            ok:false,
            error:"Joueur ou objet invalide."
          });
        }

        const user = await findUserByCode(code);

        if (!user?.wallet_token) {
          return cb({
            ok:false,
            error:"Joueur introuvable."
          });
        }

        await pool.query(
          `INSERT INTO ptitbac_player_items
           (wallet_token,item_key,quantity,updated_at)
           VALUES($1,$2,$3,now())
           ON CONFLICT(wallet_token,item_key) DO UPDATE SET
             quantity=ptitbac_player_items.quantity + EXCLUDED.quantity,
             updated_at=now()`,
          [user.wallet_token,item.key,quantity]
        );

        await audit(
          token,
          "grant_item",
          code,
          {
            itemKey:item.key,
            quantity
          }
        );

        cb({
          ok:true,
          name:user.username || "Joueur",
          item:item.label,
          quantity
        });
      } catch {
        cb({
          ok:false,
          error:"Envoi de l’objet impossible."
        });
      }
    });

    socket.on("admin:playerLookup", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const code = friendCode(payload.friendCode);

        if (!code) {
          return cb({
            ok:false,
            error:"ID joueur invalide."
          });
        }

        const user = await findUserByCode(code);

        if (!user?.wallet_token) {
          return cb({
            ok:false,
            error:"Joueur introuvable."
          });
        }

        const wallet = await getWallet(user.wallet_token);

        const items = await pool.query(
          `SELECT item_key,quantity,updated_at
           FROM ptitbac_player_items
           WHERE wallet_token=$1
           ORDER BY updated_at DESC`,
          [user.wallet_token]
        ).catch(() => ({ rows:[] }));

        const reportCount = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM ptitbac_player_reports
           WHERE reported_friend_code=$1`,
          [code]
        ).catch(() => ({ rows:[{count:0}] }));

        const feedbackCount = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM ptitbac_feedback_reports
           WHERE friend_code=$1`,
          [code]
        ).catch(() => ({ rows:[{count:0}] }));

        const online = [...io.sockets.sockets.values()].some(
          client =>
            String(client.data?.walletToken || "") ===
            String(user.wallet_token)
        );

        cb({
          ok:true,
          player:{
            friendCode:user.friend_code,
            name:user.username || "Joueur",
            avatar:user.avatar || "🧠",
            lives:Number(user.lives ?? 0),
            coins:Number(wallet.coins || 0),
            gems:Number(wallet.gems || 0),
            createdAt:user.created_at,
            lastSeen:user.last_seen,
            online,
            reports:
              Number(reportCount.rows[0]?.count || 0) +
              Number(feedbackCount.rows[0]?.count || 0),
            items:items.rows.map(row => ({
              key:row.item_key,
              quantity:Number(row.quantity || 0),
              label:
                ITEM_CATALOG.find(item => item.key === row.item_key)?.label ||
                row.item_key
            }))
          }
        });
      } catch {
        cb({
          ok:false,
          error:"Impossible de charger le joueur."
        });
      }
    });

    socket.on("feedback:submit", async (payload={}, cb=()=>{}) => {
      try {
        await schema();

        const type =
          payload.type === "report-bug"
            ? "report-bug"
            : "report-avis";

        const message =
          String(payload.message || "")
            .trim()
            .slice(0,1000);

        if (!message) {
          return cb({
            ok:false,
            error:"Écris un message."
          });
        }

        await pool.query(
          `INSERT INTO ptitbac_feedback_reports
           (id,report_type,wallet_token,friend_code,player_name,message,
            room_code,category,answer)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id(),
            type,
            walletToken(payload.walletToken) || null,
            friendCode(payload.friendCode) || null,
            String(payload.playerName || "Joueur").slice(0,24),
            message,
            String(payload.roomCode || "").slice(0,8) || null,
            String(payload.category || "").slice(0,80) || null,
            String(payload.answer || "").slice(0,100) || null
          ]
        );

        cb({ ok:true });
      } catch {
        cb({
          ok:false,
          error:"Envoi impossible."
        });
      }
    });

    socket.on("admin:reports", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        await schema();

        const feedback = await pool.query(
          `SELECT id,report_type AS type,friend_code,player_name,message,
                  room_code,category,answer,NULL::text AS letter,
                  NULL::text AS status,created_at
           FROM ptitbac_feedback_reports
           ORDER BY created_at DESC
           LIMIT 250`
        );

        const players = await pool.query(
          `SELECT id,'report-joueur' AS type,
                  reported_friend_code AS friend_code,
                  reported_name AS player_name,
                  reason AS message,room_code,
                  NULL::text AS category,NULL::text AS answer,
                  NULL::text AS letter,NULL::text AS status,created_at
           FROM ptitbac_player_reports
           ORDER BY created_at DESC
           LIMIT 250`
        ).catch(() => ({ rows:[] }));

        const answers = await pool.query(
          `SELECT id,'report-bug' AS type,NULL::text AS friend_code,
                  'Réponse signalée' AS player_name,
                  COALESCE(original_reason,'Réponse contestée') AS message,
                  room_code,category,answer,letter,status,
                  to_timestamp(created_at/1000.0) AS created_at
           FROM ptitbac_answer_reports
           WHERE status <> 'admin_deleted'
           ORDER BY created_at DESC
           LIMIT 250`
        ).catch(() => ({ rows:[] }));

        const reports = [
          ...feedback.rows,
          ...players.rows,
          ...answers.rows
        ]
          .sort(
            (a,b) =>
              new Date(b.created_at) -
              new Date(a.created_at)
          )
          .slice(0,400);

        cb({
          ok:true,
          reports
        });
      } catch {
        cb({
          ok:false,
          error:"Impossible de charger les reports."
        });
      }
    });

    socket.on("admin:answerReportAction", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        await schema();

        const reportId =
          String(payload.reportId || "").trim();

        const action =
          String(payload.action || "").trim();

        if (!/^[a-f0-9]{16,64}$/i.test(reportId)) {
          return cb({
            ok:false,
            error:"Report invalide."
          });
        }

        if (!["validate","delete"].includes(action)) {
          return cb({
            ok:false,
            error:"Action invalide."
          });
        }

        const q = await pool.query(
          `SELECT id,category,answer,letter,status
           FROM ptitbac_answer_reports
           WHERE id=$1
           LIMIT 1`,
          [reportId]
        );

        if (!q.rowCount) {
          return cb({
            ok:false,
            error:"Report introuvable."
          });
        }

        const report = q.rows[0];

        if (action === "delete") {
          await pool.query(
            `UPDATE ptitbac_answer_reports
             SET status='admin_deleted',reviewed_at=$2
             WHERE id=$1`,
            [reportId,Date.now()]
          );

          await audit(token, "report_delete", null, {
            reportId
          });

          return cb({
            ok:true,
            deleted:true
          });
        }

        const key =
          learnedAnswerKey(
            report.category,
            report.answer
          );

        const now = Date.now();

        await pool.query(
          `INSERT INTO ptitbac_learned_answers
           (answer_key,category,answer,status,confidence,
            source,support_count,updated_at)
           VALUES($1,$2,$3,'valid',100,'admin_approved',1,$4)
           ON CONFLICT(answer_key) DO UPDATE SET
             category=EXCLUDED.category,
             answer=EXCLUDED.answer,
             status='valid',
             confidence=100,
             source='admin_approved',
             support_count=ptitbac_learned_answers.support_count+1,
             updated_at=EXCLUDED.updated_at`,
          [key,report.category,report.answer,now]
        );

        await pool.query(
          `UPDATE ptitbac_answer_reports SET
             status='admin_validated',
             review_verdict='valid',
             review_confidence=100,
             reviewed_at=$2
           WHERE id=$1`,
          [reportId,now]
        );

        global.__ptbAdminLearningOverlay ||= new Map();

        global.__ptbAdminLearningOverlay.set(key, {
          category:report.category,
          answer:report.answer,
          status:"valid",
          confidence:100,
          source:"admin_approved",
          supportCount:1,
          updatedAt:now
        });

        await audit(token, "report_validate", null, {
          reportId,
          category:report.category,
          answer:report.answer
        });

        cb({
          ok:true,
          validated:true,
          letter:report.letter,
          category:report.category,
          answer:report.answer
        });
      } catch (error) {
        console.error(
          "Action admin report réponse:",
          error.message
        );

        cb({
          ok:false,
          error:"Action impossible."
        });
      }
    });
  });

  return {
    close() {
      clearInterval(lifeTimer);
      clearInterval(gemTimer);
    }
  };
}

module.exports = installAdmin;

schema()
  .then(async () => {
    const owner = await ownerToken();
    if (owner) await applyFlags(owner);
  })
  .catch(error => {
    console.warn("Admin V4:",error.message);
  });

process.on("SIGTERM",() => {
  pool?.end().catch(()=>{});
});
