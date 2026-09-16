"use strict";

/**
 * Schéma PostgreSQL central de P'tit Bac.
 * Toutes les créations/évolutions de tables passent ici.
 */

async function runDatabaseMigrations(pool) {
  if (!pool) throw new Error("PostgreSQL indisponible");

  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // Portefeuille = source de vérité pour pièces + gemmes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_wallets (
      token text PRIMARY KEY,
      coins integer NOT NULL CHECK (coins >= 0),
      gems integer NOT NULL DEFAULT 0 CHECK (gems >= 0),
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      history jsonb NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_wallets
    ADD COLUMN IF NOT EXISTS gems integer NOT NULL DEFAULT 0 CHECK (gems >= 0)
  `);

  // Profil social. Le solde de pièces n'est volontairement plus stocké ici.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      friend_code text UNIQUE NOT NULL,
      username text NOT NULL,
      avatar text DEFAULT '🐼',
      wallet_token text UNIQUE,
      lives integer NOT NULL DEFAULT 5 CHECK (lives >= 0 AND lives <= 5),
      life_updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      admin_banned boolean NOT NULL DEFAULT false,
      admin_ban_reason text,
      admin_banned_at timestamptz
    )
  `);

  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wallet_token text UNIQUE`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lives integer NOT NULL DEFAULT 5 CHECK (lives >= 0 AND lives <= 5)`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS life_updated_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_banned boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_ban_reason text`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_banned_at timestamptz`);

  // Migration sûre de l'ancien public.users.coins vers le portefeuille.
  const legacyCoins = await pool.query(`
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'coins'
     LIMIT 1
  `);

  if (legacyCoins.rowCount) {
    await pool.query(`
      INSERT INTO public.ptitbac_wallets(token, coins, gems, created_at, updated_at, history)
      SELECT wallet_token,
             GREATEST(COALESCE(coins, 0), 0),
             0,
             (extract(epoch FROM COALESCE(created_at, now())) * 1000)::bigint,
             (extract(epoch FROM COALESCE(updated_at, now())) * 1000)::bigint,
             '[]'::jsonb
        FROM public.users
       WHERE wallet_token IS NOT NULL
         AND wallet_token <> ''
      ON CONFLICT(token) DO NOTHING
    `);
    await pool.query(`ALTER TABLE public.users DROP COLUMN IF EXISTS coins`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.friend_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','declined')),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (sender_id <> receiver_id),
      UNIQUE (sender_id, receiver_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.friendships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      friend_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (user_id <> friend_id),
      UNIQUE (user_id, friend_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.economy_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
      wallet_token text,
      kind text NOT NULL,
      coins_delta integer NOT NULL DEFAULT 0,
      gems_delta integer NOT NULL DEFAULT 0,
      lives_delta integer NOT NULL DEFAULT 0,
      room_code text,
      note text,
      idempotency_key text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE public.economy_transactions
    ADD COLUMN IF NOT EXISTS gems_delta integer NOT NULL DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz,
      CHECK (sender_id <> receiver_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_chat_hidden (
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      friend_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      hidden_before timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, friend_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_chat_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      reported_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_player_reports (
      id text PRIMARY KEY,
      reporter_wallet_token text NOT NULL,
      reported_friend_code text NOT NULL,
      reported_name text NOT NULL,
      room_code text,
      reported_player_id text,
      reason text NOT NULL DEFAULT 'lobby_profile',
      status text NOT NULL DEFAULT 'pending',
      treated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE public.ptitbac_player_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE public.ptitbac_player_reports ADD COLUMN IF NOT EXISTS treated_at timestamptz`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_owner(
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      wallet_token text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_settings(
      wallet_token text PRIMARY KEY,
      infinite_coins boolean NOT NULL DEFAULT false,
      infinite_lives boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_feedback_reports(
      id text PRIMARY KEY,
      report_type text NOT NULL CHECK(report_type IN ('report-avis','report-bug')),
      wallet_token text,
      friend_code text,
      player_name text,
      message text NOT NULL,
      room_code text,
      category text,
      answer text,
      status text NOT NULL DEFAULT 'pending',
      treated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE public.ptitbac_feedback_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE public.ptitbac_feedback_reports ADD COLUMN IF NOT EXISTS treated_at timestamptz`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_learned_answers(
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
    CREATE TABLE IF NOT EXISTS public.ptitbac_answer_reports(
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
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_logs(
      id text PRIMARY KEY,
      admin_wallet_token text NOT NULL,
      action text NOT NULL,
      target_friend_code text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_player_warnings(
      id text PRIMARY KEY,
      wallet_token text NOT NULL,
      friend_code text,
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inbox_messages(
      id text PRIMARY KEY,
      sender_wallet_token text,
      recipient_wallet_token text,
      recipient_friend_code text,
      message_type text NOT NULL DEFAULT 'message',
      title text NOT NULL,
      body text NOT NULL,
      image_data text,
      reward_type text NOT NULL DEFAULT 'none',
      reward_key text,
      reward_amount integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inbox_receipts(
      message_id text NOT NULL REFERENCES public.ptitbac_inbox_messages(id) ON DELETE CASCADE,
      wallet_token text NOT NULL,
      read_at timestamptz,
      claimed_at timestamptz,
      PRIMARY KEY(message_id,wallet_token)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_items (
      wallet_token text NOT NULL,
      item_type text NOT NULL CHECK (item_type IN ('avatar','frame','tag')),
      item_id text NOT NULL,
      source text NOT NULL DEFAULT 'system',
      acquired_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet_token, item_type, item_id)
    )
  `);

  // E8.1: l'ancien inventaire admin séparé est supprimé.
  // Si une ancienne ligne utilise déjà une clé officielle "type:id", elle est
  // transférée avant suppression. Les prototypes sans équivalent cosmétique
  // (coffres/jetons/badges de test) ne sont pas conservés.
  const legacyAdminItems = await pool.query(`
    SELECT to_regclass('public.ptitbac_player_items') AS table_name
  `);
  if (legacyAdminItems.rows?.[0]?.table_name) {
    await pool.query(`
      INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
      SELECT wallet_token,
             split_part(item_key, ':', 1),
             substring(item_key FROM position(':' IN item_key) + 1),
             'legacy-admin'
        FROM public.ptitbac_player_items
       WHERE split_part(item_key, ':', 1) IN ('avatar','frame','tag')
         AND position(':' IN item_key) > 1
      ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING
    `).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS public.ptitbac_player_items`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_equipped (
      wallet_token text PRIMARY KEY,
      avatar_id text NOT NULL DEFAULT '/a1.webp',
      frame_id text NOT NULL DEFAULT '',
      tag_id text NOT NULL DEFAULT 'tag_debutant',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_progression (
      wallet_token text PRIMARY KEY,
      total_xp integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
      trophies integer NOT NULL DEFAULT 0 CHECK (trophies >= 0),
      completed_games integer NOT NULL DEFAULT 0 CHECK (completed_games >= 0),
      wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression
    ADD COLUMN IF NOT EXISTS trophies integer NOT NULL DEFAULT 0 CHECK (trophies >= 0)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_progression_events (
      event_key text PRIMARY KEY,
      wallet_token text NOT NULL,
      room_code text,
      xp_delta integer NOT NULL CHECK (xp_delta >= 0),
      trophy_delta integer NOT NULL DEFAULT 0 CHECK (trophy_delta >= 0),
      before_total_xp integer NOT NULL CHECK (before_total_xp >= 0),
      after_total_xp integer NOT NULL CHECK (after_total_xp >= 0),
      before_trophies integer NOT NULL DEFAULT 0 CHECK (before_trophies >= 0),
      after_trophies integer NOT NULL DEFAULT 0 CHECK (after_trophies >= 0),
      before_level integer NOT NULL,
      after_level integer NOT NULL,
      rank integer NOT NULL DEFAULT 0,
      valid_answers integer NOT NULL DEFAULT 0,
      rounds integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression_events
    ADD COLUMN IF NOT EXISTS trophy_delta integer NOT NULL DEFAULT 0 CHECK (trophy_delta >= 0)
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression_events
    ADD COLUMN IF NOT EXISTS before_trophies integer NOT NULL DEFAULT 0 CHECK (before_trophies >= 0)
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression_events
    ADD COLUMN IF NOT EXISTS after_trophies integer NOT NULL DEFAULT 0 CHECK (after_trophies >= 0)
  `);

  // Indexes.
  const indexes = [
    `CREATE INDEX IF NOT EXISTS users_wallet_token_idx ON public.users(wallet_token)`,
    `CREATE INDEX IF NOT EXISTS users_friend_code_idx ON public.users(friend_code)`,
    `CREATE INDEX IF NOT EXISTS friend_requests_sender_idx ON public.friend_requests(sender_id)`,
    `CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON public.friend_requests(receiver_id)`,
    `CREATE INDEX IF NOT EXISTS friendships_user_idx ON public.friendships(user_id)`,
    `CREATE INDEX IF NOT EXISTS economy_transactions_user_idx ON public.economy_transactions(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS economy_transactions_wallet_idx ON public.economy_transactions(wallet_token, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_messages_pair_created_idx ON public.ptitbac_messages(sender_id, receiver_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_messages_receiver_unread_idx ON public.ptitbac_messages(receiver_id, read_at, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_player_reports_target_idx ON public.ptitbac_player_reports(reported_friend_code, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ptitbac_inbox_recipient ON public.ptitbac_inbox_messages(recipient_wallet_token, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_inventory_items_wallet_idx ON public.ptitbac_inventory_items(wallet_token, item_type, acquired_at)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_progression_events_wallet_idx ON public.ptitbac_progression_events(wallet_token, created_at DESC)`
  ];
  for (const sql of indexes) await pool.query(sql);

  // Codes amis 5 chiffres : trigger unique pour tout le backend.
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.ptitbac_assign_friend_code_5()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      candidate text;
    BEGIN
      IF NEW.friend_code ~ '^[0-9]{5}$' THEN
        RETURN NEW;
      END IF;

      LOOP
        candidate := lpad((floor(random() * 100000))::int::text, 5, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1
          FROM public.users
          WHERE friend_code = candidate
            AND id IS DISTINCT FROM NEW.id
        );
      END LOOP;

      NEW.friend_code := candidate;
      RETURN NEW;
    END;
    $$;
  `);

  await pool.query(`DROP TRIGGER IF EXISTS ptitbac_friend_code_5_trigger ON public.users`);
  await pool.query(`
    CREATE TRIGGER ptitbac_friend_code_5_trigger
    BEFORE INSERT OR UPDATE OF friend_code
    ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.ptitbac_assign_friend_code_5()
  `);

  await pool.query(`
    UPDATE public.users
       SET friend_code = friend_code
     WHERE friend_code !~ '^[0-9]{5}$'
  `);
}

module.exports = {
  runDatabaseMigrations
};
