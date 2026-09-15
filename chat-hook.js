"use strict";

/**
 * P'tit Bac — Chat V1
 * Extension Socket.IO / PostgreSQL chargée avant server.js.
 *
 * Fonctions:
 * - conversations privées entre amis uniquement
 * - historique persistant
 * - non lus / lecture
 * - temps réel
 * - suppression locale d'une conversation
 * - signalement
 */

const { getPool, ensureDatabaseSchema } = require("./db.js");
const presence = require("./presence-service.js");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const pool = getPool();


function validToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function cleanMessage(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 500);
}

async function ensureSchema() {
  return ensureDatabaseSchema();
}

async function userFromToken(walletToken) {
  await ensureSchema();
  const token = validToken(walletToken);
  if (!token) throw new Error("Session joueur invalide");

  const q = await pool.query(`
    SELECT id, friend_code, username, avatar, wallet_token, last_seen
      FROM public.users
     WHERE wallet_token = $1
     LIMIT 1
  `, [token]);

  if (!q.rowCount) throw new Error("Profil joueur introuvable");
  return q.rows[0];
}

async function identity(socket, payload = {}) {
  const token = validToken(payload.walletToken || socket.data.ptitChatWalletToken);
  const user = await userFromToken(token);

  if (socket.data.ptitChatUserId && socket.data.ptitChatUserId !== user.id) {
    presence.remove(socket.data.ptitChatUserId, socket.id);
  }

  socket.data.ptitChatUserId = user.id;
  socket.data.ptitChatWalletToken = user.wallet_token;
  presence.add(user.id, socket.id);

  await pool.query(
    `UPDATE public.users SET last_seen = now(), updated_at = now() WHERE id = $1`,
    [user.id]
  ).catch(() => {});

  return user;
}

async function areFriends(userId, friendId) {
  const q = await pool.query(`
    SELECT 1
      FROM public.friendships
     WHERE user_id = $1 AND friend_id = $2
     LIMIT 1
  `, [userId, friendId]);
  return Boolean(q.rowCount);
}

function safeUser(row) {
  return {
    id: row.id,
    friendCode: row.friend_code,
    username: row.username,
    avatar: row.avatar || "🐼",
    lastSeen: row.last_seen || null,
    online: presence.isOnline(row.id)
  };
}

async function friendsFor(userId) {
  const q = await pool.query(`
    SELECT u.id, u.friend_code, u.username, u.avatar, u.last_seen
      FROM public.friendships f
      JOIN public.users u ON u.id = f.friend_id
     WHERE f.user_id = $1
     ORDER BY lower(u.username), u.created_at
  `, [userId]);
  return q.rows.map(safeUser);
}

async function hiddenBefore(userId, friendId) {
  const q = await pool.query(`
    SELECT hidden_before
      FROM public.ptitbac_chat_hidden
     WHERE user_id = $1 AND friend_id = $2
     LIMIT 1
  `, [userId, friendId]);
  return q.rows[0]?.hidden_before || null;
}

async function conversationList(userId) {
  const q = await pool.query(`
    SELECT
      u.id AS friend_id,
      u.friend_code,
      u.username,
      u.avatar,
      u.last_seen,
      latest.id AS message_id,
      latest.sender_id,
      latest.receiver_id,
      latest.content,
      latest.created_at,
      latest.read_at,
      COALESCE(unread.unread, 0)::int AS unread
    FROM public.friendships f
    JOIN public.users u
      ON u.id = f.friend_id
    LEFT JOIN public.ptitbac_chat_hidden h
      ON h.user_id = $1
     AND h.friend_id = u.id
    JOIN LATERAL (
      SELECT m.id,
             m.sender_id,
             m.receiver_id,
             m.content,
             m.created_at,
             m.read_at
        FROM public.ptitbac_messages m
       WHERE (
              (m.sender_id = $1 AND m.receiver_id = u.id)
           OR (m.sender_id = u.id AND m.receiver_id = $1)
       )
         AND (
           h.hidden_before IS NULL
           OR m.created_at > h.hidden_before
         )
       ORDER BY m.created_at DESC
       LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS unread
        FROM public.ptitbac_messages m
       WHERE m.sender_id = u.id
         AND m.receiver_id = $1
         AND m.read_at IS NULL
         AND (
           h.hidden_before IS NULL
           OR m.created_at > h.hidden_before
         )
    ) unread ON true
    WHERE f.user_id = $1
    ORDER BY latest.created_at DESC
  `, [userId]);

  return q.rows.map(row => ({
    friend: safeUser({
      id: row.friend_id,
      friend_code: row.friend_code,
      username: row.username,
      avatar: row.avatar,
      last_seen: row.last_seen
    }),
    lastMessage: {
      id: row.message_id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      content: row.content,
      created_at: row.created_at,
      read_at: row.read_at
    },
    unread: Number(row.unread || 0)
  }));
}

async function history(userId, friendId, limit = 100) {
  if (!(await areFriends(userId, friendId))) {
    throw new Error("Ce joueur n'est plus dans tes amis.");
  }

  const hidden = await hiddenBefore(userId, friendId);
  const params = hidden
    ? [userId, friendId, hidden, Math.max(1, Math.min(100, Number(limit) || 100))]
    : [userId, friendId, Math.max(1, Math.min(100, Number(limit) || 100))];

  const q = await pool.query(`
    SELECT id, sender_id, receiver_id, content, created_at, read_at
      FROM public.ptitbac_messages
     WHERE (
            (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
     )
     ${hidden ? "AND created_at > $3" : ""}
     ORDER BY created_at DESC
     LIMIT $${hidden ? 4 : 3}
  `, params);

  return q.rows.reverse();
}

async function markRead(userId, friendId) {
  const q = await pool.query(`
    UPDATE public.ptitbac_messages
       SET read_at = COALESCE(read_at, now())
     WHERE sender_id = $2
       AND receiver_id = $1
       AND read_at IS NULL
     RETURNING id, read_at
  `, [userId, friendId]);

  return q.rows;
}

function installChat(io) {
  if (!DATABASE_URL) {
    console.warn("Chat V1 désactivé: DATABASE_URL absent.");
    return;
  }

  ensureSchema().catch(err =>
    console.error("Chat V1 initialisation impossible:", err.message)
  );

  io.on("connection", socket => {
    socket.on("chat:bootstrap", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const [friends, conversations] = await Promise.all([
          friendsFor(me.id),
          conversationList(me.id)
        ]);
        cb({ ok: true, me: safeUser(me), friends, conversations });
      } catch (err) {
        cb({ ok: false, error: err.message || "Chat indisponible." });
      }
    });

    socket.on("chat:list", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const [friends, conversations] = await Promise.all([
          friendsFor(me.id),
          conversationList(me.id)
        ]);
        cb({ ok: true, me: safeUser(me), friends, conversations });
      } catch (err) {
        cb({ ok: false, error: err.message || "Impossible de charger les messages." });
      }
    });

    socket.on("chat:history", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const friendId = String(payload.friendId || "").trim();
        const friendQ = await pool.query(`
          SELECT id, friend_code, username, avatar, last_seen
            FROM public.users
           WHERE id = $1
           LIMIT 1
        `, [friendId]);

        if (!friendQ.rowCount || !(await areFriends(me.id, friendId))) {
          return cb({ ok: false, error: "Ami introuvable." });
        }

        const messages = await history(me.id, friendId, payload.limit);
        const readRows = await markRead(me.id, friendId);

        if (readRows.length) {
          presence.emitToUser(io, friendId, "chat:read", {
            byUserId: me.id,
            messageIds: readRows.map(row => row.id),
            readAt: readRows[0].read_at
          });
        }

        cb({
          ok: true,
          me: safeUser(me),
          friend: safeUser(friendQ.rows[0]),
          messages
        });
      } catch (err) {
        cb({ ok: false, error: err.message || "Impossible de charger la conversation." });
      }
    });

    socket.on("chat:send", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const friendId = String(payload.friendId || "").trim();
        const content = cleanMessage(payload.content);

        if (!content) return cb({ ok: false, error: "Écris un message." });
        if (!(await areFriends(me.id, friendId))) {
          return cb({ ok: false, error: "Tu peux écrire uniquement à tes amis." });
        }

        // Une nouvelle activité rend la conversation visible de nouveau.
        await pool.query(`
          DELETE FROM public.ptitbac_chat_hidden
           WHERE (user_id = $1 AND friend_id = $2)
              OR (user_id = $2 AND friend_id = $1)
        `, [me.id, friendId]);

        const inserted = await pool.query(`
          INSERT INTO public.ptitbac_messages(sender_id, receiver_id, content)
          VALUES($1,$2,$3)
          RETURNING id, sender_id, receiver_id, content, created_at, read_at
        `, [me.id, friendId, content]);

        const message = inserted.rows[0];

        presence.emitToUser(io, friendId, "chat:message", {
          message,
          from: safeUser(me)
        });

        presence.emitToUser(io, me.id, "chat:message", {
          message,
          from: safeUser(me)
        });

        cb({ ok: true, message });
      } catch (err) {
        cb({ ok: false, error: err.message || "Message impossible à envoyer." });
      }
    });

    socket.on("chat:read", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const friendId = String(payload.friendId || "").trim();
        if (!(await areFriends(me.id, friendId))) {
          return cb({ ok: false, error: "Ami introuvable." });
        }
        const rows = await markRead(me.id, friendId);
        if (rows.length) {
          presence.emitToUser(io, friendId, "chat:read", {
            byUserId: me.id,
            messageIds: rows.map(row => row.id),
            readAt: rows[0].read_at
          });
        }
        cb({ ok: true });
      } catch (err) {
        cb({ ok: false, error: "Lecture impossible." });
      }
    });

    socket.on("chat:hide", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const friendId = String(payload.friendId || "").trim();
        if (!(await areFriends(me.id, friendId))) {
          return cb({ ok: false, error: "Ami introuvable." });
        }

        await pool.query(`
          INSERT INTO public.ptitbac_chat_hidden(user_id, friend_id, hidden_before)
          VALUES($1,$2,now())
          ON CONFLICT(user_id, friend_id)
          DO UPDATE SET hidden_before = now()
        `, [me.id, friendId]);

        cb({ ok: true });
      } catch (err) {
        cb({ ok: false, error: "Impossible de supprimer la conversation." });
      }
    });

    socket.on("chat:report", async (payload = {}, cb = () => {}) => {
      try {
        const me = await identity(socket, payload);
        const friendId = String(payload.friendId || "").trim();
        if (!(await areFriends(me.id, friendId))) {
          return cb({ ok: false, error: "Ami introuvable." });
        }

        await pool.query(`
          INSERT INTO public.ptitbac_chat_reports(reporter_id, reported_user_id, note)
          VALUES($1,$2,$3)
        `, [me.id, friendId, cleanMessage(payload.note || "Conversation signalée").slice(0, 500)]);

        cb({ ok: true });
      } catch (err) {
        cb({ ok: false, error: "Signalement impossible." });
      }
    });

    socket.on("disconnect", () => {
      if (socket.data.ptitChatUserId) {
        presence.remove(socket.data.ptitChatUserId, socket.id);
      }
    });
  });
}

module.exports = installChat;

