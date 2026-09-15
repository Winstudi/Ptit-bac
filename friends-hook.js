/** Friends socket handlers, explicitly installed by server.js. */
"use strict";

const { getPool, ensureDatabaseSchema } = require("./db.js");
const presence = require("./presence-service.js");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const pool = getPool();


function cleanUsername(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.slice(0, 24) || "Joueur";
}

function cleanAvatar(value) {
  return String(value || "🐼").trim().slice(0, 120) || "🐼";
}

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

async function ensureSchema() {
  return ensureDatabaseSchema();
}

async function ensureProfile(payload = {}) {
  await ensureSchema();

  const walletToken = validWalletToken(payload.walletToken);
  if (!walletToken) throw new Error("Session joueur invalide");

  const username = cleanUsername(payload.username);
  const avatar = cleanAvatar(payload.avatar);
  let found = await pool.query(
    `SELECT id, friend_code, username, avatar, wallet_token, created_at, last_seen
       FROM public.users
      WHERE wallet_token = $1
      LIMIT 1`,
    [walletToken]
  );

  if (!found.rowCount) {
    found = await pool.query(
      `INSERT INTO public.users(friend_code, username, avatar, wallet_token, last_seen, updated_at)
       VALUES('AUTO',$1,$2,$3,now(),now())
       RETURNING id, friend_code, username, avatar, wallet_token, created_at, last_seen`,
      [username, avatar, walletToken]
    );
  } else {
    found = await pool.query(
      `UPDATE public.users
          SET username = $2,
              avatar = $3,
              last_seen = now(),
              updated_at = now()
        WHERE wallet_token = $1
        RETURNING id, friend_code, username, avatar, wallet_token, created_at, last_seen`,
      [walletToken, username, avatar]
    );
  }

  return found.rows[0];
}

function safeProfile(row, online = false) {
  return {
    id: row.id,
    friendCode: row.friend_code,
    username: row.username,
    avatar: row.avatar || "🐼",
    online: Boolean(online),
    lastSeen: row.last_seen || null
  };
}

async function friendIds(userId) {
  const result = await pool.query(
    "SELECT friend_id FROM public.friendships WHERE user_id = $1",
    [userId]
  );
  return result.rows.map(r => r.friend_id);
}

async function notifyFriendsPresence(io, userId) {
  try {
    const ids = await friendIds(userId);
    for (const id of ids) {
      presence.emitToUser(io, id, "friends:presence", {
        userId,
        online: presence.isOnline(userId)
      });
    }
  } catch (err) {
    console.warn("Amis V1 présence:", err.message);
  }
}

async function getFriendData(userId) {
  const friends = await pool.query(
    `SELECT u.id, u.friend_code, u.username, u.avatar, u.last_seen
       FROM public.friendships f
       JOIN public.users u ON u.id = f.friend_id
      WHERE f.user_id = $1
      ORDER BY lower(u.username), u.created_at`,
    [userId]
  );

  const incoming = await pool.query(
    `SELECT fr.id AS request_id, fr.created_at,
            u.id, u.friend_code, u.username, u.avatar, u.last_seen
       FROM public.friend_requests fr
       JOIN public.users u ON u.id = fr.sender_id
      WHERE fr.receiver_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`,
    [userId]
  );

  const outgoing = await pool.query(
    `SELECT fr.id AS request_id, fr.created_at,
            u.id, u.friend_code, u.username, u.avatar, u.last_seen
       FROM public.friend_requests fr
       JOIN public.users u ON u.id = fr.receiver_id
      WHERE fr.sender_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`,
    [userId]
  );

  return {
    friends: friends.rows.map(r => safeProfile(r, presence.isOnline(r.id))),
    incoming: incoming.rows.map(r => ({
      requestId: r.request_id,
      createdAt: r.created_at,
      user: safeProfile(r, presence.isOnline(r.id))
    })),
    outgoing: outgoing.rows.map(r => ({
      requestId: r.request_id,
      createdAt: r.created_at,
      user: safeProfile(r, presence.isOnline(r.id))
    }))
  };
}

async function identityForSocket(socket, payload = {}) {
  const profile = await ensureProfile(payload);

  if (socket.data.ptitUserId && socket.data.ptitUserId !== profile.id) {
    presence.remove(socket.data.ptitUserId, socket.id);
  }

  socket.data.ptitUserId = profile.id;
  socket.data.ptitWalletToken = profile.wallet_token;
  presence.add(profile.id, socket.id);
  return profile;
}

function installFriends(io, game = {}) {
  if (!DATABASE_URL) {
    console.warn("Amis V1 désactivé: DATABASE_URL absent.");
    return;
  }

  ensureSchema().catch(err =>
    console.error("Amis V1 initialisation impossible:", err.message)
  );

  io.on("connection", socket => {
    socket.on("friends:bootstrap", async (payload, callback = () => {}) => {
      try {
        const profile = await identityForSocket(socket, payload);
        const data = await getFriendData(profile.id);
        callback({
          ok: true,
          profile: safeProfile(profile, true),
          ...data
        });
        notifyFriendsPresence(io, profile.id);
      } catch (err) {
        console.error("friends:bootstrap:", err.message);
        callback({ ok: false, error: "Impossible de charger ton profil." });
      }
    });

    socket.on("friends:list", async (payload, callback = () => {}) => {
      try {
        const profile = await identityForSocket(socket, payload);
        const data = await getFriendData(profile.id);
        callback({ ok: true, profile: safeProfile(profile, true), ...data });
      } catch (err) {
        callback({ ok: false, error: "Impossible de charger tes amis." });
      }
    });

    socket.on("friends:send", async (payload, callback = () => {}) => {
      try {
        const profile = await identityForSocket(socket, payload);
        const code = String(payload?.friendCode || "").trim().toUpperCase();

        if (!code || code.length > 24) {
          return callback({ ok: false, error: "Entre un code ami valide." });
        }

        const targetResult = await pool.query(
          `SELECT id, friend_code, username, avatar, last_seen
             FROM public.users
            WHERE upper(friend_code) = $1
            LIMIT 1`,
          [code]
        );

        if (!targetResult.rowCount) {
          return callback({ ok: false, error: "Aucun joueur avec ce code ami." });
        }

        const target = targetResult.rows[0];
        if (target.id === profile.id) {
          return callback({ ok: false, error: "Tu ne peux pas t'ajouter toi-même." });
        }

        const alreadyFriend = await pool.query(
          `SELECT 1 FROM public.friendships
            WHERE user_id = $1 AND friend_id = $2 LIMIT 1`,
          [profile.id, target.id]
        );
        if (alreadyFriend.rowCount) {
          return callback({ ok: false, error: "Ce joueur est déjà dans tes amis." });
        }

        const reverse = await pool.query(
          `SELECT id FROM public.friend_requests
            WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
            LIMIT 1`,
          [target.id, profile.id]
        );
        if (reverse.rowCount) {
          return callback({
            ok: false,
            error: "Cette personne t'a déjà envoyé une demande. Regarde tes demandes reçues."
          });
        }

        const request = await pool.query(
          `INSERT INTO public.friend_requests(sender_id, receiver_id, status, created_at)
           VALUES($1,$2,'pending',now())
           ON CONFLICT(sender_id, receiver_id)
           DO UPDATE SET status='pending', created_at=now()
           RETURNING id`,
          [profile.id, target.id]
        );

        presence.emitToUser(io, target.id, "friends:changed", { reason: "request" });
        callback({
          ok: true,
          requestId: request.rows[0].id,
          target: safeProfile(target, presence.isOnline(target.id))
        });
      } catch (err) {
        console.error("friends:send:", err.message);
        callback({ ok: false, error: "Impossible d'envoyer la demande." });
      }
    });

    socket.on("friends:accept", async (payload, callback = () => {}) => {
      const client = await pool?.connect().catch(() => null);
      if (!client) return callback({ ok: false, error: "Base de données indisponible." });

      try {
        const profile = await identityForSocket(socket, payload);
        const requestId = String(payload?.requestId || "").trim();

        await client.query("BEGIN");
        const request = await client.query(
          `SELECT id, sender_id, receiver_id
             FROM public.friend_requests
            WHERE id = $1 AND receiver_id = $2 AND status = 'pending'
            FOR UPDATE`,
          [requestId, profile.id]
        );

        if (!request.rowCount) {
          await client.query("ROLLBACK");
          return callback({ ok: false, error: "Cette demande n'est plus disponible." });
        }

        const senderId = request.rows[0].sender_id;

        await client.query(
          `UPDATE public.friend_requests
              SET status='accepted'
            WHERE id=$1`,
          [requestId]
        );

        await client.query(
          `INSERT INTO public.friendships(user_id, friend_id)
           VALUES($1,$2),($2,$1)
           ON CONFLICT(user_id, friend_id) DO NOTHING`,
          [profile.id, senderId]
        );

        await client.query("COMMIT");
        presence.emitToUser(io, senderId, "friends:changed", { reason: "accepted" });
        callback({ ok: true });
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("friends:accept:", err.message);
        callback({ ok: false, error: "Impossible d'accepter la demande." });
      } finally {
        client.release();
      }
    });

    socket.on("friends:decline", async (payload, callback = () => {}) => {
      try {
        const profile = await identityForSocket(socket, payload);
        const requestId = String(payload?.requestId || "").trim();

        const result = await pool.query(
          `UPDATE public.friend_requests
              SET status='declined'
            WHERE id=$1 AND receiver_id=$2 AND status='pending'
            RETURNING sender_id`,
          [requestId, profile.id]
        );

        if (!result.rowCount) {
          return callback({ ok: false, error: "Cette demande n'est plus disponible." });
        }

        presence.emitToUser(io, result.rows[0].sender_id, "friends:changed", { reason: "declined" });
        callback({ ok: true });
      } catch (err) {
        callback({ ok: false, error: "Impossible de refuser la demande." });
      }
    });

    socket.on("friends:remove", async (payload, callback = () => {}) => {
      try {
        const profile = await identityForSocket(socket, payload);
        const friendId = String(payload?.friendId || "").trim();

        await pool.query(
          `DELETE FROM public.friendships
            WHERE (user_id=$1 AND friend_id=$2)
               OR (user_id=$2 AND friend_id=$1)`,
          [profile.id, friendId]
        );

        presence.emitToUser(io, friendId, "friends:changed", { reason: "removed" });
        callback({ ok: true });
      } catch (err) {
        callback({ ok: false, error: "Impossible de supprimer cet ami." });
      }
    });

    socket.on("friends:invite", async (payload, callback = () => {}) => {
      try {
        const profile = await identityForSocket(socket, payload);
        const friendId = String(payload?.friendId || "").trim();
        const roomCode = String(payload?.roomCode || "").trim().toUpperCase().slice(0, 8);

        if (!roomCode) return callback({ ok: false, error: "Aucun salon à inviter." });

        const allowed = await pool.query(
          `SELECT 1 FROM public.friendships
            WHERE user_id=$1 AND friend_id=$2 LIMIT 1`,
          [profile.id, friendId]
        );
        if (!allowed.rowCount) {
          return callback({ ok: false, error: "Ce joueur n'est pas dans tes amis." });
        }

        if (!game.canInvite?.(profile.wallet_token, roomCode)) {
          return callback({ ok:false, error:"Rejoins un salon privé disponible avant d’inviter." });
        }
        const target = await pool.query("SELECT wallet_token FROM public.users WHERE id=$1", [friendId]);
        if (!target.rowCount || game.isBusy?.(target.rows[0].wallet_token)) {
          return callback({ ok:false, error:"Cet ami est déjà dans un salon ou en partie." });
        }
        if (!presence.isOnline(friendId)) return callback({ok:true,delivered:false});
        if (!game.canInvite?.(profile.wallet_token, roomCode)) {
          return callback({ok:false,error:"Ce salon n’est plus disponible."});
        }
        // One invitation per sender socket every ten seconds.
        if (Date.now() - (socket.data.lastFriendInvite || 0) < 10000) {
          return callback({ok:false,error:"Attends quelques secondes avant de réinviter."});
        }
        socket.data.lastFriendInvite = Date.now();

        presence.emitToUser(io, friendId, "friends:room-invite", {
          from: safeProfile(profile, true),
          roomCode,
          expiresAt: Date.now() + 60000
        });

        callback({ ok: true, delivered: presence.isOnline(friendId) });
      } catch (err) {
        callback({ ok: false, error: "Impossible d'envoyer l'invitation." });
      }
    });

    socket.on("disconnect", () => {
      const userId = socket.data.ptitUserId;
      if (!userId) return;
      presence.remove(userId, socket.id);

      if (!presence.isOnline(userId)) {
        pool.query(
          "UPDATE public.users SET last_seen=now(), updated_at=now() WHERE id=$1",
          [userId]
        ).catch(() => {});
      }

      notifyFriendsPresence(io, userId);
    });
  });
}

module.exports = installFriends;

process.on("SIGTERM", () => {
  pool?.end().catch(() => {});
});
