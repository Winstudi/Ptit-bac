"use strict";

const crypto = require("crypto");

const MAX_COINS = 999999;
const WALLET_TOKEN_RE = /^[a-f0-9]{48}$/i;

function normalizeHistory(value) {
  if (Array.isArray(value)) return value.slice(-100);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.slice(-100) : [];
    } catch {}
  }
  return [];
}

function normalizeDetails(details = {}) {
  return {
    roomCode: details?.roomCode ? String(details.roomCode).slice(0, 8) : "",
    note: details?.note ? String(details.note).slice(0, 100) : ""
  };
}

function normalizeRequestKey(walletToken, value) {
  const raw = String(value || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 64);
  return raw ? `${walletToken}:${raw}`.slice(0, 120) : "";
}

function createWalletAtomicService(options = {}) {
  const getPool = options.getPool;
  const ensureSchema = options.ensureSchema;

  async function database() {
    if (typeof ensureSchema === "function") await ensureSchema();
    const pool = typeof getPool === "function" ? getPool() : null;
    if (!pool?.connect) throw new Error("PostgreSQL indisponible.");
    return pool;
  }

  async function changeCoins({
    walletToken,
    delta,
    kind = "COIN_CHANGE",
    details = {},
    idempotencyKey = ""
  } = {}) {
    const token = String(walletToken || "").trim();
    if (!WALLET_TOKEN_RE.test(token)) {
      return { ok:false, code:"invalid_wallet", error:"Portefeuille invalide." };
    }

    const requestedDelta = Math.trunc(Number(delta) || 0);
    const safeKind = String(kind || "COIN_CHANGE").slice(0, 40);
    const safeDetails = normalizeDetails(details);
    const requestKey = normalizeRequestKey(token, idempotencyKey);
    const pool = await database();
    const client = await pool.connect();

    let finished = false;
    const rollback = async () => {
      if (finished) return;
      try { await client.query("ROLLBACK"); } catch {}
      finished = true;
    };

    try {
      await client.query("BEGIN");

      const locked = await client.query(
        `SELECT token,coins,gems,created_at,updated_at,history
           FROM public.ptitbac_wallets
          WHERE token=$1
          FOR UPDATE`,
        [token]
      );

      if (!locked.rowCount) {
        await rollback();
        return { ok:false, code:"not_found", error:"Portefeuille introuvable." };
      }

      const row = locked.rows[0];
      const before = Math.max(0, Math.floor(Number(row.coins) || 0));

      if (requestKey) {
        const duplicate = await client.query(
          `SELECT id,coins_delta,kind,created_at
             FROM public.economy_transactions
            WHERE idempotency_key=$1
            LIMIT 1`,
          [requestKey]
        );
        if (duplicate.rowCount) {
          await client.query("COMMIT");
          finished = true;
          return {
            ok:true,
            duplicate:true,
            balance:before,
            gems:Math.max(0, Math.floor(Number(row.gems) || 0)),
            transaction:duplicate.rows[0]
          };
        }
      }

      if (requestedDelta < 0 && before + requestedDelta < 0) {
        await rollback();
        return {
          ok:false,
          code:"insufficient",
          error:"Solde de pièces insuffisant.",
          balance:before
        };
      }

      const after = Math.max(0, Math.min(MAX_COINS, before + requestedDelta));
      const appliedDelta = after - before;
      const at = Date.now();
      const transaction = {
        id:crypto.randomBytes(8).toString("hex"),
        type:safeKind,
        delta:appliedDelta,
        before,
        after,
        at,
        roomCode:safeDetails.roomCode,
        note:safeDetails.note,
        idempotencyKey:requestKey
      };
      const history = [...normalizeHistory(row.history), transaction].slice(-100);

      const updated = await client.query(
        `UPDATE public.ptitbac_wallets
            SET coins=$2,
                updated_at=$3,
                history=$4::jsonb
          WHERE token=$1
          RETURNING token,coins,gems,created_at,updated_at,history`,
        [token, after, at, JSON.stringify(history)]
      );

      const audit = await client.query(
        `INSERT INTO public.economy_transactions
          (user_id,wallet_token,kind,coins_delta,lives_delta,room_code,note,idempotency_key)
         VALUES(
           (SELECT id FROM public.users WHERE wallet_token=$1 LIMIT 1),
           $1,$2,$3,0,$4,$5,$6
         )
         RETURNING id,coins_delta,kind,created_at`,
        [
          token,
          safeKind,
          appliedDelta,
          safeDetails.roomCode || null,
          safeDetails.note || null,
          requestKey || null
        ]
      );

      await client.query("COMMIT");
      finished = true;

      const wallet = updated.rows[0] || {};
      return {
        ok:true,
        duplicate:false,
        balance:Math.max(0, Math.floor(Number(wallet.coins) || 0)),
        gems:Math.max(0, Math.floor(Number(wallet.gems) || 0)),
        wallet:{
          coins:Math.max(0, Math.floor(Number(wallet.coins) || 0)),
          gems:Math.max(0, Math.floor(Number(wallet.gems) || 0)),
          createdAt:Number(wallet.created_at) || at,
          updatedAt:Number(wallet.updated_at) || at,
          history:normalizeHistory(wallet.history)
        },
        transaction:audit.rows[0] || transaction
      };
    } catch (error) {
      await rollback();
      throw error;
    } finally {
      client.release?.();
    }
  }

  return { changeCoins };
}

module.exports = {
  MAX_COINS,
  normalizeRequestKey,
  createWalletAtomicService
};
