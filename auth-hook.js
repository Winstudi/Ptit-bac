"use strict";

const { createAccountAuthService } = require("./account-auth.js");

function installAccountAuth(io, options = {}) {
  if (!io || typeof io.on !== "function") return null;
  if (io.__ptitBacAccountAuthInstalled) return io.__ptitBacAccountAuthInstalled;

  const service = options.service || createAccountAuthService(options);
  const database = options.getPool || (() => require("./db.js").getPool());

  function reply(ack, payload) {
    if (typeof ack === "function") ack(payload);
  }

  async function run(ack, action) {
    try {
      reply(ack, await action());
    } catch (error) {
      console.error("Compte joueur:", error?.message || error);
      reply(ack, {
        ok:false,
        error:"Le service de compte est momentanément indisponible."
      });
    }
  }

  const connectionHandler = socket => {
    socket.on("auth:register", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.register(payload);
        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId;
          socket.data.accountWalletToken = result.account.walletToken;
        }
        return result;
      });
    });

    socket.on("auth:login", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.login(payload);
        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId;
          socket.data.accountWalletToken = result.account.walletToken;
        }
        return result;
      });
    });

    socket.on("auth:resume", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.resume(payload);
        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId;
          socket.data.accountWalletToken = result.account.walletToken;
        }
        return result;
      });
    });

    socket.on("auth:logout", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.logout(payload);
        socket.data.accountUserId = "";
        socket.data.accountWalletToken = "";
        return result;
      });
    });

    socket.on("auth:profileStats", (_payload = {}, ack) => {
      run(ack, async () => {
        const userId = String(socket.data.accountUserId || "").trim();
        const walletToken = String(socket.data.accountWalletToken || "").trim();
        if (!userId || !/^[a-f0-9]{48}$/i.test(walletToken)) {
          return { ok:false, error:"Compte non connecté." };
        }

        const db = database?.();
        if (!db) return { ok:false, error:"Statistiques indisponibles." };

        const result = await db.query(
          `SELECT a.created_at,
                  COALESCE(p.completed_games,0) AS completed_games,
                  COALESCE(p.wins,0) AS wins,
                  COALESCE((
                    SELECT SUM(e.valid_answers)
                      FROM public.ptitbac_progression_events e
                     WHERE e.wallet_token=$2
                  ),0) AS correct_answers,
                  COALESCE((
                    SELECT COUNT(*)
                      FROM public.friendships f
                     WHERE f.user_id=$1
                  ),0) AS friends
             FROM public.ptitbac_accounts a
             JOIN public.users u
               ON u.id=a.user_id AND u.wallet_token=$2
        LEFT JOIN public.ptitbac_progression p
               ON p.wallet_token=$2
            WHERE a.user_id=$1
            LIMIT 1`,
          [userId, walletToken]
        );

        if (!result.rowCount) {
          return { ok:false, error:"Compte introuvable." };
        }

        const row = result.rows[0];
        return {
          ok:true,
          stats:{
            games:Math.max(0, Number(row.completed_games) || 0),
            wins:Math.max(0, Number(row.wins) || 0),
            correct:Math.max(0, Number(row.correct_answers) || 0),
            friends:Math.max(0, Number(row.friends) || 0),
            memberSince:row.created_at ? new Date(row.created_at).toISOString() : ""
          }
        };
      });
    });
  };

  io.on("connection", connectionHandler);

  const installed = { service, connectionHandler };
  io.__ptitBacAccountAuthInstalled = installed;
  return installed;
}

module.exports = installAccountAuth;
