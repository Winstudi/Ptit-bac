(() => {
  "use strict";

  const LOBBY_MAX_PLAYERS = 6;
  const DIFFICULTY_ICON_URLS = {
    beginner: "/difficulty.png",
    medium: "/difficulty.png",
    hard: "/difficulty.png"
  };

  let lobbyOpenedPlayerId = "";
  let lobbyDifficultyLockUntil = 0;
  let lobbySettingsOpen = false;
  let lobbyInviteOpen = false;
  let lobbyInviteFriends = [];
  let lobbyInviteLoading = false;
  let lobbyCountdownTimer = null;
  let lobbyCountdownActive = false;
  let lobbyCountdownAudio = null;
  let lobbyCountdownLastValue = "";
  let lobbyModeSwitching = false;
  let lobbyInventoryReturnToLobby = false;
  const lobbyInviteSocket = socket;

  Object.values(DIFFICULTY_ICON_URLS).forEach(src => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });

  function lobbyNow() {
    try {
      return typeof serverNowMs === "function" ? serverNowMs() : Date.now();
    } catch {
      return Date.now();
    }
  }

  function clearLobbyCountdown() {
    clearInterval(lobbyCountdownTimer);
    lobbyCountdownTimer = null;
    lobbyCountdownActive = false;
    lobbyCountdownLastValue = "";

    if (lobbyCountdownAudio) {
      try {
        lobbyCountdownAudio.pause();
        lobbyCountdownAudio.currentTime = 0;
      } catch {}
      lobbyCountdownAudio = null;
    }

    document.getElementById("lobbyStartCountdown")?.remove();
  }

  function ensureLobbyCountdownOverlay() {
    let overlay = document.getElementById("lobbyStartCountdown");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "lobbyStartCountdown";
    overlay.className = "lobby-start-countdown";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "assertive");
    overlay.innerHTML = `
      <div class="lobby-start-countdown-card">
        <div class="lobby-countdown-rocket" aria-hidden="true">🚀</div>
        <h2>La partie commence dans</h2>

        <div class="lobby-countdown-ring" aria-hidden="true">
          <div class="lobby-countdown-ring-track"></div>
          <div class="lobby-countdown-ring-glow"></div>
          <strong id="lobbyCountdownNumber">3</strong>
          <i class="spark s1"></i>
          <i class="spark s2"></i>
          <i class="spark s3"></i>
          <i class="spark s4"></i>
        </div>

        <p>Préparez-vous !</p>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function startLobbyCountdown(payload = {}) {
    const activeCode = String(session?.state?.code || session?.code || "");
    if (!payload.code || String(payload.code) !== activeCode) return;

    clearLobbyCountdown();
    lobbyCountdownActive = true;

    const overlay = ensureLobbyCountdownOverlay();
    const number = overlay.querySelector("#lobbyCountdownNumber");
    const card = overlay.querySelector(".lobby-start-countdown-card");
    const ring = overlay.querySelector(".lobby-countdown-ring");

    try {
      lobbyCountdownAudio = new Audio("/ptitbac-countdown-neon.wav");
      lobbyCountdownAudio.preload = "auto";
      lobbyCountdownAudio.volume = 0.78;
      lobbyCountdownAudio.currentTime = 0;
      const playPromise = lobbyCountdownAudio.play();
      if (playPromise?.catch) playPromise.catch(() => {});
    } catch {}

    const startedAt = Number(payload.startedAt || lobbyNow());
    const durationMs = Math.max(3000, Number(payload.durationMs || 3200));
    const deadline = startedAt + durationMs;

    const update = () => {
      const remaining = deadline - lobbyNow();
      let nextValue = "3";

      if (remaining > 2200) nextValue = "3";
      else if (remaining > 1200) nextValue = "2";
      else if (remaining > 250) nextValue = "1";
      else nextValue = "!";

      if (number && nextValue !== lobbyCountdownLastValue) {
        number.textContent = nextValue;
        lobbyCountdownLastValue = nextValue;
        ring?.classList.remove("pulse");
        void ring?.offsetWidth;
        ring?.classList.add("pulse");
      }

      if (nextValue === "!") card?.classList.add("is-go");
    };

    update();
    lobbyCountdownTimer = setInterval(update, 70);

    setTimeout(() => {
      if (document.querySelector(".lobby-v5")) clearLobbyCountdown();
    }, durationMs + 1800);
  }

  function roomModeToggleMarkup(state, user) {
    const publicMode = state.mode === "public";
    const host = user?.isHost === true;
    const label = publicMode ? "Public" : "Privé";
    const nextLabel = publicMode ? "privé" : "public";

    return `
      <div class="pl-title-mode">
        <h1>Salon ${publicMode ? "public" : "privé"}</h1>
        <button
          id="plModeToggle"
          class="pl-mode-toggle ${publicMode ? "is-public" : ""}"
          type="button"
          aria-pressed="${publicMode ? "true" : "false"}"
          aria-label="${host ? `Passer le salon en mode ${nextLabel}` : `Salon ${label.toLowerCase()}`}"
          title="${publicMode ? "Public : 1 vie, XP et trophées activés, visible en recherche rapide" : "Privé : gratuit, sans XP ni trophées, accès par code ou invitation"}"
          ${host && !lobbyModeSwitching ? "" : "disabled"}
        >
          <span class="pl-mode-toggle-dot" aria-hidden="true"></span>
          <strong>${label}</strong>
        </button>
      </div>
    `;
  }

  function changeRoomMode(state, user) {
    if (!user?.isHost || lobbyModeSwitching || state.mode === "quick") return;

    const nextMode = state.mode === "public" ? "private" : "public";
    lobbyModeSwitching = true;
    renderLobbyV5();

    socket.timeout(8000).emit(
      "room:setMode",
      {
        code: state.code,
        playerId: session.playerId,
        mode: nextMode
      },
      (err, res) => {
        lobbyModeSwitching = false;

        if (err || !res?.ok) {
          renderLobbyV5();
          return toast(res?.error || "Impossible de modifier le type du salon.");
        }

        if (res.state) session.state = res.state;
        renderLobbyV5();
      }
    );
  }

  function isImageAvatar(value) {
    return (
      window.PtitBacProfilePhoto?.isImageAvatar?.(value) ||
      /^data:image\//i.test(String(value || ""))
    );
  }

  function difficultyInfo(value) {
    if (value === "hard") return { label: "Difficile", icon: DIFFICULTY_ICON_URLS.hard };
    if (value === "medium") return { label: "Moyen", icon: DIFFICULTY_ICON_URLS.medium };
    return { label: "Facile", icon: DIFFICULTY_ICON_URLS.beginner };
  }

  function avatarMarkup(player) {
    const raw = String(player?.avatar || "");
    if (isImageAvatar(raw)) {
      return `<img src="${raw}" alt="" draggable="false">`;
    }
    return `<span>${escapeHtml(raw || String(player?.name || "?").charAt(0).toUpperCase())}</span>`;
  }

  function friendCodeFor(player) {
    if (!player) return "";
    if (String(player.id) === String(session.playerId)) {
      const local = String(localStorage.getItem("petitbac_friendCode") || "").trim();
      if (/^\d{5}$/.test(local)) return local;
    }
    const remote = String(player.friendCode || "").trim();
    return /^\d{5}$/.test(remote) ? remote : "";
  }

  function playerProfileModal(state) {
    if (!lobbyOpenedPlayerId) return "";

    const player = state.players.find(p => String(p.id) === String(lobbyOpenedPlayerId));
    if (!player) {
      lobbyOpenedPlayerId = "";
      return "";
    }

    const self = String(player.id) === String(session.playerId);
    const code = friendCodeFor(player);
    const canSocial = !self && !player.isBot && !!code;
    return `
      <div class="lobby-v5-profile-backdrop pl-profile-v2-backdrop" id="lobbyPlayerProfileBackdrop">
        <section class="lobby-v5-profile-modal pl-profile-v2-modal" role="dialog" aria-modal="true" aria-label="Profil de ${escapeHtml(player.name || "Joueur")}">
          <button id="lobbyPlayerProfileClose" class="lobby-v5-profile-close pl-profile-v2-close" type="button" aria-label="Fermer">×</button>

          <div class="pl-profile-v2-card ${player.isHost ? "is-host" : ""} ${self ? "is-self" : ""}">
            <div class="pl-profile-v2-avatar-shell">
              <div class="lobby-v5-profile-avatar pl-profile-v2-avatar">${avatarMarkup(player)}</div>
              ${player.isHost
                ? `<span class="pl-profile-v2-crown" aria-hidden="true"><img src="/admin-crown.png" alt=""></span>`
                : ""}
            </div>

            <div class="pl-profile-v2-copy">
              <strong>${escapeHtml(player.name || "Joueur")}</strong>
              ${privateLobbyTagMarkup(player)}
            </div>
          </div>

          <div class="pl-profile-v2-code">
            <small>Code ami</small>
            <strong>${player.isBot ? "Joueur test" : (code ? `#${escapeHtml(code)}` : "Indisponible")}</strong>
          </div>

          ${self
            ? `<button id="lobbyPlayerInventory" class="pl-profile-v2-inventory" type="button">
                <img src="/inventaire.png" alt="">
                <span>Inventaire</span>
                <small>Modifier mon apparence</small>
              </button>`
            : player.isBot
              ? `<div class="pl-profile-v2-note">Les joueurs test n’ont pas de profil personnalisable.</div>`
              : `<div class="lobby-v5-profile-actions pl-profile-v2-actions">
                  <button id="lobbyPlayerAddFriend" type="button" ${canSocial ? "" : "disabled"}>Ajouter en ami</button>
                  <button id="lobbyPlayerReport" class="danger" type="button" ${code ? "" : "disabled"}>Signaler</button>
                </div>`}
        </section>
      </div>`;
  }

  function settingCard({ key, label, value, icon, difficulty = false }) {
    return `
      <article class="lobby-v5-setting-card ${difficulty ? "is-difficulty" : ""}">
        <img class="lobby-v5-setting-icon" src="${icon}" alt="">
        <small>${label}</small>
        <div class="lobby-v5-setting-value">
          <strong>${value}</strong>
        </div>
      </article>`;
  }

  function playerRow(player, index, user) {
    const online = player.connected || player.isBot;
    const privateLobby = session.state?.mode !== "quick";
    const canKick = privateLobby && user?.isHost && !player.isHost && String(player.id) !== String(session.playerId);
    const code = friendCodeFor(player);

    return `
      <article class="lobby-v5-player ${canKick ? "has-kick" : ""}"
        data-lobby-player-profile="${player.id}" tabindex="0" role="button">
        <div class="lobby-v5-avatar">${avatarMarkup(player)}</div>

        <div class="lobby-v5-player-copy">
          <div class="lobby-v5-player-name-row">
            <strong>${escapeHtml(player.name || "Joueur")}</strong>
            ${privateLobby && player.isHost
              ? `<span class="host-badge"><img src="/admin-crown.png" alt=""> Hôte</span>`
              : online
                ? `<span class="ready-badge">✓ Prêt</span>`
                : `<span class="offline-badge">Pas prêt</span>`}
          </div>
          ${code ? `<small># ${escapeHtml(code)}</small>` : ""}
        </div>

        ${canKick ? `<button class="lobby-v5-kick" data-kick-id="${player.id}" type="button" aria-label="Retirer">×</button>` : ""}
      </article>`;
  }

  function emptyPlayerRow(host, slot) {
    if (host) {
      return `
        <button class="lobby-v5-empty-player" data-add-bot="${slot}" type="button">
          <span class="lobby-v5-empty-plus">＋</span>
          <span>En attente d’un joueur…</span>
        </button>`;
    }
    return `
      <div class="lobby-v5-empty-player readonly">
        <span class="lobby-v5-empty-plus">＋</span>
        <span>En attente d’un joueur…</span>
      </div>`;
  }

  function lobbySettingsOverlay(state, user) {
    if (!lobbySettingsOpen || !user?.isHost) return "";

    const difficulty = difficultyInfo(state.categoryDifficulty);
    const categoryCount = Number(state.categoryCount || state.categories?.length || 6);

    const card = ({ key, label, value, icon, difficultyClass = "" }) => `
      <article class="lobby-v5-edit-card ${difficultyClass}">
        <img src="${icon}" alt="">
        <small>${label}</small>
        <div class="lobby-v5-edit-stepper">
          <button type="button" data-lobby-inline-step="${key}" data-dir="-1" aria-label="Diminuer">
            <img src="/lobby-minus.png" alt="">
          </button>
          <strong>${value}</strong>
          <button type="button" data-lobby-inline-step="${key}" data-dir="1" aria-label="Augmenter">
            <img src="/lobby-plus.png" alt="">
          </button>
        </div>
      </article>
    `;

    return `
      <div class="lobby-v5-settings-overlay" id="lobbySettingsOverlay">
        <section class="lobby-v5-settings-sheet" role="dialog" aria-modal="true" aria-label="Modifier les paramètres">
          <header class="lobby-v5-settings-sheet-header">
            <div>
              <small>PARAMÈTRES DU SALON</small>
              <h2>Modifier la partie</h2>
            </div>
            <button id="lobbySettingsClose" type="button" aria-label="Fermer">×</button>
          </header>

          <div class="lobby-v5-edit-grid">
            ${card({
              key: "rounds",
              label: "Manches",
              value: state.rounds,
              icon: "/lightning.png"
            })}
            ${card({
              key: "categoryCount",
              label: "Catégories",
              value: categoryCount,
              icon: "/lobby-categories.png"
            })}
            ${card({
              key: "duration",
              label: "Temps",
              value: `${Number(state.duration || 60)}s`,
              icon: "/lobby-clock.png"
            })}
            ${card({
              key: "categoryDifficulty",
              label: "Difficulté",
              value: difficulty.label,
              icon: difficulty.icon,
              difficultyClass: "difficulty"
            })}
          </div>

          <button id="lobbySettingsApply" class="lobby-v5-settings-apply" type="button">
            Terminé
          </button>
        </section>
      </div>
    `;
  }

  function lobbyInviteIdentity(extra = {}) {
    return {
      walletToken: localStorage.getItem("petitbac_walletToken") || "",
      username: localStorage.getItem("petitbac_profile_name") || "Joueur",
      avatar: localStorage.getItem("petitbac_profile_icon") || "🐼",
      ...extra
    };
  }

  function lobbyInviteAvatar(user) {
    const raw = String(user?.avatar || "");
    if (isImageAvatar(raw)) {
      return `<img src="${raw}" alt="" draggable="false">`;
    }
    return `<span>${escapeHtml(raw || String(user?.username || "?").charAt(0).toUpperCase())}</span>`;
  }

  function lobbyInviteOverlay(state) {
    if (!lobbyInviteOpen) return "";

    const rows = lobbyInviteLoading
      ? `<div class="lobby-v5-invite-loading">
          <span class="spinner small-spinner"></span>
          Chargement des amis…
        </div>`
      : lobbyInviteFriends.length
        ? lobbyInviteFriends.map(friend => `
            <article class="lobby-v5-invite-friend">
              <div class="lobby-v5-invite-friend-avatar">
                ${lobbyInviteAvatar(friend)}
              </div>

              <div class="lobby-v5-invite-friend-copy">
                <strong>${escapeHtml(friend.username || "Joueur")}</strong>
                <small class="${friend.online ? "online" : ""}">
                  ${friend.online ? "En ligne" : "Hors ligne"}
                </small>
              </div>

              <button
                type="button"
                class="lobby-v5-invite-friend-btn"
                data-lobby-invite-friend="${escapeHtml(friend.id)}"
              >
                <img src="/friends.png" alt="">
                <span>Inviter</span>
              </button>
            </article>
          `).join("")
        : `<div class="lobby-v5-invite-empty">
            <img src="/friends.png" alt="">
            <strong>Aucun ami disponible</strong>
            <small>Ajoute des amis depuis ton profil pour les inviter ici.</small>
          </div>`;

    return `
      <div class="lobby-v5-invite-overlay" id="lobbyInviteOverlay">
        <section class="lobby-v5-invite-sheet" role="dialog" aria-modal="true" aria-label="Inviter des amis">
          <header class="lobby-v5-invite-sheet-header">
            <div>
              <small>SALON ${escapeHtml(state.code)}</small>
              <h2>Inviter des amis</h2>
            </div>

            <button id="lobbyInviteClose" type="button" aria-label="Fermer">×</button>
          </header>

          <div class="lobby-v5-invite-list">
            ${rows}
          </div>
        </section>
      </div>
    `;
  }

  function loadLobbyInviteFriends() {
    lobbyInviteLoading = true;
    renderLobbyV5();

    lobbyInviteSocket.emit("friends:list", lobbyInviteIdentity(), res => {
      lobbyInviteLoading = false;

      if (!res?.ok) {
        lobbyInviteFriends = [];
        toast(res?.error || "Impossible de charger tes amis.");
        return renderLobbyV5();
      }

      lobbyInviteFriends = Array.isArray(res.friends) ? res.friends : [];
      renderLobbyV5();
    });
  }


  function privateLobbyTagInfo(player) {
    let id = String(player?.tagId || "").trim();

    if (!id && String(player?.id || "") === String(session?.playerId || "")) {
      try {
        id = String(window.PtitBacInventory?.state?.()?.equipped?.tag || "").trim();
      } catch {}
    }

    if (!id) return null;

    const known = {
      tag_debutant: { label:"Débutant", icon:"★" }
    };

    if (known[id]) return known[id];

    const label = id
      .replace(/^tag[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim();

    return label ? { label, icon:"★" } : null;
  }

  function privateLobbyTagMarkup(player) {
    const tag = privateLobbyTagInfo(player);
    if (!tag) return "";

    return `
      <span class="pl-player-title" title="Titre équipé">
        <span aria-hidden="true">${tag.icon}</span>
        <strong>${escapeHtml(tag.label)}</strong>
      </span>`;
  }

  function privateLobbyShareIcon() {
    return `
      <svg class="pl-share-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="18" cy="5" r="2.5"></circle>
        <circle cx="6" cy="12" r="2.5"></circle>
        <circle cx="18" cy="19" r="2.5"></circle>
        <path d="m8.2 10.8 7.5-4.4M8.2 13.2l7.5 4.4"></path>
      </svg>`;
  }

  function ensurePrivateLobbyV2Styles() {
    if (document.getElementById("ptbPrivateLobbyV2Styles")) return;

    const style = document.createElement("style");
    style.id = "ptbPrivateLobbyV2Styles";
    style.textContent = `
      /* =====================================================
         Salon privé/public V2 — identité joueur mise en avant — avatar x1,6
         Styles volontairement scopés à .pl-private.
         ===================================================== */
      html body .pl-private {
        --pl-v2-line:#526ea4;
        --pl-v2-violet:#b04cff;
        --pl-v2-violet-soft:#7f56ff;
        --pl-v2-panel:#0d2147;
        --pl-v2-panel-2:#131f4b;
      }

      html body .pl-private .pl-settings {
        padding:8px 9px 9px !important;
        border-color:#38548a !important;
        background:linear-gradient(145deg,rgba(18,34,78,.94),rgba(9,23,61,.96));
        box-shadow:inset 0 0 18px rgba(94,69,216,.05);
      }

      html body .pl-private .pl-settings h2 {
        min-height:30px;
        margin-bottom:6px !important;
        font-size:14px !important;
      }

      html body .pl-private .pl-settings h2 > img {
        width:24px !important;
        height:24px !important;
        filter:drop-shadow(0 0 5px rgba(192,75,255,.42));
      }

      html body .pl-private .pl-settings h2 .pl-settings-edit {
        width:auto !important;
        min-width:0 !important;
        height:28px !important;
        margin-left:auto !important;
        padding:2px 3px 2px 8px !important;
        display:inline-flex !important;
        align-items:center !important;
        gap:4px !important;
        border:0 !important;
        background:transparent !important;
        color:#b5c4ef !important;
        font-size:11px !important;
        font-weight:700 !important;
      }

      html body .pl-private .pl-settings h2 .pl-settings-edit b {
        font-size:22px;
        line-height:1;
        font-weight:400;
      }

      html body .pl-private .pl-setting-grid {
        gap:7px !important;
      }

      html body .pl-private .pl-setting-grid .lobby-v5-setting-card {
        height:72px !important;
        border-color:#3e5f98 !important;
        background:linear-gradient(180deg,#0b254f,#0b1e43) !important;
        box-shadow:inset 0 0 12px rgba(70,146,255,.035) !important;
      }

      html body .pl-private .pl-setting-grid .lobby-v5-setting-icon {
        width:29px !important;
        height:29px !important;
        filter:drop-shadow(0 0 5px rgba(187,64,255,.34));
      }

      html body .pl-private .pl-players h2 {
        margin-bottom:7px !important;
        font-size:21px !important;
        line-height:25px !important;
      }

      html body .pl-private .pl-players h2 span {
        color:#b8c5ef !important;
        font-size:16px !important;
        font-weight:800;
      }

      html body .pl-private .pl-grid {
        grid-template-columns:repeat(2,minmax(0,1fr)) !important;
        grid-template-rows:repeat(3,minmax(132px,1fr)) !important;
        gap:8px !important;
        overflow:visible !important;
      }

      html body .pl-private .pl-player,
      html body .pl-private .pl-empty {
        min-width:0;
        min-height:132px !important;
        height:100%;
        border-radius:15px !important;
      }

      html body .pl-private .pl-player {
        position:relative;
        padding:8px 9px !important;
        display:grid !important;
        grid-template-columns:clamp(106px,28vw,124px) minmax(0,1fr) !important;
        align-items:center !important;
        gap:10px !important;
        overflow:visible;
        border:1px solid #405b91 !important;
        background:
          radial-gradient(circle at 18% 38%,rgba(121,55,255,.10),transparent 42%),
          linear-gradient(145deg,#11264d,#0c1d42 78%) !important;
        box-shadow:inset 0 0 14px rgba(99,74,229,.035);
        transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease;
      }

      html body .pl-private .pl-player.is-host,
      html body .pl-private .pl-player.is-self {
        border-color:rgba(177,76,255,.50) !important;
        box-shadow:
          inset 0 0 20px rgba(138,62,255,.08),
          0 0 11px rgba(166,54,255,.16);
      }

      html body .pl-private .pl-player.is-host::after {
        content:"";
        position:absolute;
        right:9px;
        bottom:7px;
        width:40px;
        height:30px;
        opacity:.06;
        pointer-events:none;
        border:4px solid #c06cff;
        border-top:0;
        border-radius:0 0 12px 12px;
        transform:rotate(-9deg);
      }

      html body .pl-private .pl-avatar-shell {
        position:relative;
        width:clamp(106px,28vw,124px);
        height:clamp(106px,28vw,124px);
        display:grid;
        place-items:center;
        overflow:visible;
        align-self:center;
      }

      html body .pl-private .pl-avatar {
        position:relative !important;
        width:100% !important;
        height:100% !important;
        min-width:0 !important;
        min-height:0 !important;
        margin:0 !important;
        flex:none !important;
        border:1.5px solid #a657ff !important;
        border-radius:13px !important;
        background:#181953 !important;
        box-shadow:0 0 9px rgba(163,66,255,.28) !important;
        overflow:hidden !important;
      }

      html body .pl-private .pl-avatar > img:not(.ptb-equipped-frame-overlay) {
        width:100% !important;
        height:100% !important;
        max-width:none !important;
        max-height:none !important;
        object-fit:cover !important;
      }

      html body .pl-private .pl-avatar.ptb-has-equipped-frame {
        overflow:visible !important;
        border:0 !important;
        border-radius:0 !important;
        background:transparent !important;
        box-shadow:none !important;
      }

      html body .pl-private .pl-avatar.ptb-has-equipped-frame > img:not(.ptb-equipped-frame-overlay) {
        width:85% !important;
        height:85% !important;
        max-width:85% !important;
        max-height:85% !important;
        border-radius:0 !important;
      }

      html body .pl-private .pl-avatar.ptb-has-equipped-frame > .ptb-equipped-frame-overlay {
        left:50% !important;
        top:50% !important;
        width:158% !important;
        height:158% !important;
        max-width:none !important;
        max-height:none !important;
        transform:translate3d(-50%,-50%,0) !important;
      }

      html body .pl-private .pl-avatar-role-crown {
        position:absolute;
        z-index:10;
        left:-5px;
        top:-5px;
        width:23px;
        height:23px;
        display:grid;
        place-items:center;
        border:1px solid rgba(255,211,95,.58);
        border-radius:50%;
        background:rgba(57,23,101,.96);
        box-shadow:0 0 9px rgba(255,184,42,.28),0 0 9px rgba(184,67,255,.28);
        pointer-events:none;
      }

      html body .pl-private .pl-avatar-role-crown img {
        width:17px !important;
        height:17px !important;
      }

      html body .pl-private .pl-player-copy {
        position:relative;
        z-index:2;
        min-width:0;
        display:grid;
        align-content:center;
        justify-items:start;
        gap:3px;
      }

      html body .pl-private .pl-player-head {
        width:100%;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
      }

      html body .pl-private .pl-player-copy > strong,
      html body .pl-private .pl-player-head > strong {
        display:block;
        min-width:0;
        flex:1 1 auto;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        color:#fff;
        font-size:clamp(14px,3.7vw,17px) !important;
        line-height:1.05 !important;
        font-weight:900;
      }

      html body .pl-private .pl-tags {
        width:100%;
        margin:0 !important;
        display:flex !important;
        flex-wrap:nowrap !important;
        gap:3px !important;
        overflow:hidden;
      }

      html body .pl-private .pl-tags span {
        min-width:0;
        padding:2px 5px !important;
        border:1px solid #7356ce !important;
        border-radius:999px !important;
        background:rgba(48,35,105,.72);
        color:#ded7ff !important;
        font-size:8.5px !important;
        line-height:1.15;
        font-weight:800;
        white-space:nowrap;
      }

      html body .pl-private .pl-tags .is-host {
        border-color:#c24eff !important;
        color:#f0c9ff !important;
      }

      html body .pl-private .pl-player-title {
        max-width:100%;
        min-height:20px;
        padding:2px 7px;
        display:inline-flex;
        align-items:center;
        gap:4px;
        border:1px solid #8e61ff;
        border-radius:999px;
        background:linear-gradient(90deg,rgba(105,42,202,.76),rgba(37,54,151,.74));
        color:#fff;
        box-shadow:0 0 8px rgba(172,65,255,.22);
        font-size:9px;
        line-height:1;
        overflow:hidden;
      }

      html body .pl-private .pl-player-title > span {
        flex:none;
        color:#fff;
        font-size:11px;
        text-shadow:0 0 6px rgba(214,142,255,.55);
      }

      html body .pl-private .pl-player-title strong {
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:9px;
        font-weight:900;
      }

      html body .pl-private .pl-status {
        margin-top:0;
        display:inline-flex;
        align-items:center;
        justify-content:flex-end;
        gap:4px;
        color:#aab7d9 !important;
        font-size:9px !important;
        line-height:1.1;
        white-space:nowrap;
        flex:none;
      }

      html body .pl-private .pl-card-status {
        position:absolute;
        z-index:5;
        right:8px;
        bottom:7px;
        padding:3px 5px;
        border-radius:999px;
        background:rgba(7,18,50,.55);
        backdrop-filter:blur(4px);
      }

      html body .pl-private .pl-status i {
        width:6px;
        height:6px;
        flex:none;
        border-radius:50%;
        background:#8c83ae;
        box-shadow:0 0 5px rgba(145,130,188,.35);
      }

      html body .pl-private .pl-status.is-ready {
        color:#67e3ba !important;
      }

      html body .pl-private .pl-status.is-ready i {
        background:#55e7b6;
        box-shadow:0 0 7px rgba(85,231,182,.55);
      }

      html body .pl-private .pl-status.is-offline i {
        background:#69738f;
        box-shadow:none;
      }

      html body .pl-private .pl-kick {
        z-index:12;
        right:1px !important;
        top:0 !important;
        width:22px;
        height:22px;
        padding:0 !important;
        display:grid;
        place-items:center;
        border:0 !important;
        border-radius:50%;
        background:rgba(9,17,53,.65) !important;
        color:#aeb7d5 !important;
        font-size:15px !important;
        line-height:1;
      }

      html body .pl-private .pl-empty {
        padding:7px !important;
        display:flex !important;
        flex-direction:column !important;
        align-items:center !important;
        justify-content:center !important;
        gap:6px !important;
        border:1px dashed #5a78b0 !important;
        background:linear-gradient(145deg,rgba(10,27,66,.54),rgba(10,20,55,.42));
        color:#a7b8e4 !important;
      }

      html body .pl-private .pl-empty b {
        width:36px !important;
        height:36px !important;
        display:grid !important;
        place-items:center !important;
        border:1px solid #6988c7 !important;
        border-radius:50% !important;
        background:rgba(19,39,84,.55);
        color:#adc1f5;
        font-size:25px !important;
        line-height:1 !important;
        font-weight:300 !important;
      }

      html body .pl-private .pl-empty span {
        font-size:10.5px !important;
        font-weight:600;
      }

      /* ---------- Profil joueur V2 ---------- */
      html body .pl-private .pl-profile-v2-backdrop {
        position:fixed !important;
        inset:0 !important;
        z-index:100020 !important;
        padding:18px !important;
        display:grid !important;
        place-items:center !important;
        background:rgba(3,8,31,.76) !important;
        backdrop-filter:blur(10px);
      }

      html body .pl-private .pl-profile-v2-modal {
        position:relative;
        width:min(100%,360px) !important;
        max-width:360px !important;
        padding:18px !important;
        display:grid !important;
        gap:14px !important;
        border:1px solid rgba(165,83,255,.72) !important;
        border-radius:22px !important;
        background:
          radial-gradient(circle at 18% 6%,rgba(140,58,255,.22),transparent 38%),
          linear-gradient(155deg,#111b50,#09153c 75%) !important;
        box-shadow:0 22px 65px rgba(0,0,0,.48),0 0 28px rgba(142,56,255,.18) !important;
        color:#fff !important;
        overflow:visible !important;
      }

      html body .pl-private .pl-profile-v2-close {
        position:absolute !important;
        z-index:20;
        right:10px !important;
        top:9px !important;
        width:32px !important;
        height:32px !important;
        padding:0 !important;
        display:grid !important;
        place-items:center !important;
        border:1px solid rgba(130,104,212,.46) !important;
        border-radius:50% !important;
        background:rgba(12,23,65,.84) !important;
        color:#d8d3ee !important;
        font-size:23px !important;
        line-height:1 !important;
      }

      html body .pl-private .pl-profile-v2-card {
        position:relative;
        min-height:142px;
        padding:12px 12px 12px 10px;
        display:grid;
        grid-template-columns:126px minmax(0,1fr);
        align-items:center;
        gap:12px;
        border:1px solid rgba(83,111,166,.66);
        border-radius:18px;
        background:
          radial-gradient(circle at 19% 44%,rgba(131,58,255,.13),transparent 42%),
          linear-gradient(145deg,#11264d,#0b1c42 78%);
        box-shadow:inset 0 0 16px rgba(110,83,245,.055);
        overflow:visible;
      }

      html body .pl-private .pl-profile-v2-card.is-host,
      html body .pl-private .pl-profile-v2-card.is-self {
        border-color:rgba(177,76,255,.50);
        box-shadow:inset 0 0 22px rgba(138,62,255,.08),0 0 13px rgba(166,54,255,.16);
      }

      html body .pl-private .pl-profile-v2-avatar-shell {
        position:relative;
        width:126px;
        height:126px;
        display:grid;
        place-items:center;
        overflow:visible;
      }

      html body .pl-private .pl-profile-v2-avatar {
        position:relative !important;
        width:100% !important;
        height:100% !important;
        display:grid !important;
        place-items:center !important;
        overflow:hidden !important;
        border:1.5px solid #a657ff !important;
        border-radius:15px !important;
        background:#181953 !important;
        box-shadow:0 0 10px rgba(163,66,255,.27) !important;
      }

      html body .pl-private .pl-profile-v2-avatar > img:not(.ptb-equipped-frame-overlay) {
        width:100% !important;
        height:100% !important;
        max-width:none !important;
        max-height:none !important;
        object-fit:cover !important;
      }

      html body .pl-private .pl-profile-v2-avatar.ptb-has-equipped-frame {
        overflow:visible !important;
        border:0 !important;
        border-radius:0 !important;
        background:transparent !important;
        box-shadow:none !important;
      }

      html body .pl-private .pl-profile-v2-avatar.ptb-has-equipped-frame > img:not(.ptb-equipped-frame-overlay) {
        width:85% !important;
        height:85% !important;
        max-width:85% !important;
        max-height:85% !important;
        border-radius:0 !important;
      }

      html body .pl-private .pl-profile-v2-avatar.ptb-has-equipped-frame > .ptb-equipped-frame-overlay {
        left:50% !important;
        top:50% !important;
        width:118% !important;
        height:118% !important;
        max-width:none !important;
        max-height:none !important;
        transform:translate3d(-50%,-50%,0) !important;
      }

      html body .pl-private .pl-profile-v2-crown {
        position:absolute;
        z-index:12;
        left:-3px;
        top:-4px;
        width:27px;
        height:27px;
        display:grid;
        place-items:center;
        border:1px solid rgba(255,211,95,.58);
        border-radius:50%;
        background:rgba(57,23,101,.96);
        box-shadow:0 0 10px rgba(255,184,42,.24),0 0 10px rgba(184,67,255,.25);
      }

      html body .pl-private .pl-profile-v2-crown img {
        width:20px !important;
        height:20px !important;
      }

      html body .pl-private .pl-profile-v2-copy {
        min-width:0;
        min-height:104px;
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        justify-content:center;
        gap:8px;
      }

      html body .pl-private .pl-profile-v2-copy > strong {
        width:100%;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:22px !important;
        line-height:1.05;
        font-weight:900;
      }

      html body .pl-private .pl-profile-v2-copy .pl-player-title {
        min-height:25px;
        padding:4px 10px;
        font-size:11px;
      }

      html body .pl-private .pl-profile-v2-copy .pl-player-title strong {
        font-size:11px;
      }

      html body .pl-private .pl-profile-v2-status {
        display:inline-flex;
        align-items:center;
        gap:5px;
        color:#aab7d9;
        font-size:11px;
        font-weight:700;
        white-space:nowrap;
      }

      html body .pl-private .pl-profile-v2-status i {
        width:7px;
        height:7px;
        border-radius:50%;
        background:#8c83ae;
        box-shadow:0 0 5px rgba(145,130,188,.35);
      }

      html body .pl-private .pl-profile-v2-status.is-ready {
        color:#67e3ba;
      }

      html body .pl-private .pl-profile-v2-status.is-ready i {
        background:#55e7b6;
        box-shadow:0 0 7px rgba(85,231,182,.55);
      }

      html body .pl-private .pl-profile-v2-status.is-offline i {
        background:#69738f;
        box-shadow:none;
      }

      html body .pl-private .pl-profile-v2-code {
        width:102px;
        min-width:102px;
        min-height:44px;
        justify-self:end;
        padding:6px 9px;
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        justify-content:center;
        gap:2px;
        border:1px solid rgba(63,83,137,.72);
        border-radius:13px;
        background:rgba(10,27,66,.72);
      }

      html body .pl-private .pl-profile-v2-code small {
        color:#9faed3;
        font-size:10px;
        font-weight:700;
      }

      html body .pl-private .pl-profile-v2-code strong {
        color:#eeeaff;
        font-size:12px;
        font-weight:900;
      }

      html body .pl-private .pl-profile-v2-inventory {
        width:100%;
        min-height:58px;
        padding:8px 12px;
        display:grid;
        grid-template-columns:38px minmax(0,1fr);
        grid-template-rows:auto auto;
        align-items:center;
        column-gap:10px;
        border:1px solid #8e61ff;
        border-radius:14px;
        background:linear-gradient(135deg,rgba(91,48,171,.90),rgba(48,35,122,.94));
        box-shadow:inset 0 0 13px rgba(189,127,255,.10),0 0 11px rgba(137,64,246,.15);
        text-align:left;
      }

      html body .pl-private .pl-profile-v2-inventory img {
        grid-row:1 / 3;
        width:36px !important;
        height:36px !important;
      }

      html body .pl-private .pl-profile-v2-inventory span {
        align-self:end;
        font-size:14px;
        font-weight:900;
      }

      html body .pl-private .pl-profile-v2-inventory small {
        align-self:start;
        color:#c3b6ed;
        font-size:9px;
        font-weight:700;
      }

      html body .pl-private .pl-profile-v2-actions {
        display:grid !important;
        grid-template-columns:1fr 1fr;
        gap:8px !important;
      }

      html body .pl-private .pl-profile-v2-actions button {
        min-height:46px !important;
        border-radius:13px !important;
      }

      html body .pl-private .pl-profile-v2-note {
        padding:10px 12px;
        border:1px solid rgba(63,83,137,.55);
        border-radius:12px;
        background:rgba(10,27,66,.58);
        color:#a9b4d3;
        text-align:center;
        font-size:10px;
        line-height:1.35;
      }

      html body .pl-private .pl-actions {
        gap:7px !important;
      }

      html body .pl-private .pl-social {
        gap:7px !important;
      }

      html body .pl-private .pl-invite,
      html body .pl-private .pl-share {
        min-height:43px !important;
        border-radius:13px !important;
      }

      html body .pl-private .pl-invite {
        border-color:#859bff !important;
        background:linear-gradient(145deg,#152853,#102044) !important;
        font-size:13px !important;
        font-weight:900 !important;
      }

      html body .pl-private .pl-invite img {
        width:26px !important;
        height:26px !important;
      }

      html body .pl-private .pl-share {
        min-width:94px;
        padding:6px 10px !important;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:6px;
        border-color:#8255cf !important;
        background:linear-gradient(145deg,#241552,#171a49) !important;
        color:#f1ecff;
        font-size:11px !important;
      }

      html body .pl-private .pl-share-icon {
        width:18px;
        height:18px;
        flex:none;
        fill:none;
        stroke:currentColor;
        stroke-width:1.8;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      html body .pl-private .pl-launch {
        gap:8px !important;
      }

      html body .pl-private .pl-launch button {
        min-height:45px !important;
        border-radius:13px !important;
      }

      html body .pl-private .pl-launch #plReady {
        border-color:#b36cff !important;
        background:linear-gradient(145deg,#5c388f,#432b79) !important;
        font-size:15px !important;
      }

      html body .pl-private .pl-launch #plReady.selected {
        border-color:#59ddb4 !important;
        background:linear-gradient(145deg,#15594c,#18493f) !important;
      }

      html body .pl-private .pl-launch #startBtn {
        background:linear-gradient(135deg,#783ee7,#5226bc) !important;
        box-shadow:inset 0 0 13px rgba(211,159,255,.10);
      }

      html body .pl-private .pl-launch #startBtn:disabled {
        filter:saturate(.45);
        opacity:.42;
      }

      html body .pl-private .pl-test {
        margin-top:-1px;
        font-size:9px !important;
      }

      @media (max-width:370px) {
        html body .pl-private .pl-grid {
          gap:6px !important;
        }

        html body .pl-private .pl-player {
          grid-template-columns:92px minmax(0,1fr) !important;
          padding:6px !important;
          gap:6px !important;
        }

        html body .pl-private .pl-avatar-shell {
          width:92px;
          height:92px;
        }

        html body .pl-private .pl-player-copy > strong {
          font-size:13px !important;
        }

        html body .pl-private .pl-player-title,
        html body .pl-private .pl-player-title strong {
          font-size:8px !important;
        }

        html body .pl-private .pl-tags span {
          padding-inline:4px !important;
          font-size:7.7px !important;
        }
      }

      @media (max-height:690px) {
        html body .pl-private .pl-setting-grid .lobby-v5-setting-card {
          height:60px !important;
        }

        html body .pl-private .pl-setting-grid .lobby-v5-setting-icon {
          width:22px !important;
          height:22px !important;
        }

        html body .pl-private .pl-grid {
          grid-template-rows:repeat(3,minmax(102px,1fr)) !important;
          gap:6px !important;
          overflow-y:auto !important;
          overscroll-behavior:contain;
        }

        html body .pl-private .pl-player,
        html body .pl-private .pl-empty {
          min-height:102px !important;
        }

        html body .pl-private .pl-player {
          grid-template-columns:86px minmax(0,1fr) !important;
          padding:5px 6px !important;
          gap:6px !important;
        }

        html body .pl-private .pl-avatar-shell {
          width:86px;
          height:86px;
        }

        html body .pl-private .pl-player-copy {
          gap:2px;
        }

        html body .pl-private .pl-player-copy > strong {
          font-size:12px !important;
        }

        html body .pl-private .pl-player-title {
          min-height:16px;
          padding:1px 5px;
        }

        html body .pl-private .pl-player-title strong,
        html body .pl-private .pl-status {
          font-size:7.5px !important;
        }

        html body .pl-private .pl-avatar-role-crown {
          width:18px;
          height:18px;
        }

        html body .pl-private .pl-avatar-role-crown img {
          width:13px !important;
          height:13px !important;
        }

        html body .pl-private .pl-empty b {
          width:30px !important;
          height:30px !important;
          font-size:21px !important;
        }

        html body .pl-private .pl-invite,
        html body .pl-private .pl-share,
        html body .pl-private .pl-launch button {
          min-height:39px !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function privateMarkup(state, user) {
    ensurePrivateLobbyV2Styles();

    const difficulty = difficultyInfo(state.categoryDifficulty);
    const allReady = state.players.length >= 2 && state.players.every(
      player => player.isBot || (player.connected && player.lobbyReady)
    );

    const cards = state.players.map(player => {
      const self = String(player.id) === String(session.playerId);
      const ready = player.isBot || (player.connected && player.lobbyReady);
      const offline = !player.isBot && !player.connected;
      const canKick = user?.isHost && !player.isHost;

      return `
        <article
          class="pl-player pl-player-v2 ${player.isHost ? "is-host" : ""} ${self ? "is-self" : ""} ${ready ? "is-ready" : ""}"
          data-lobby-player-profile="${escapeHtml(player.id)}"
          role="button"
          tabindex="0"
          aria-label="Profil de ${escapeHtml(player.name || "Joueur")}"
        >
          <div class="pl-avatar-shell">
            <div class="pl-avatar">${avatarMarkup(player)}</div>
            ${player.isHost
              ? `<span class="pl-avatar-role-crown" aria-hidden="true"><img src="/admin-crown.png" alt=""></span>`
              : ""}
          </div>

          <div class="pl-player-copy">
            <div class="pl-player-head">
              <strong>${escapeHtml(player.name || "Joueur")}</strong>
            </div>

            ${privateLobbyTagMarkup(player)}

            ${player.isBot
              ? `<div class="pl-tags"><span>Bot</span></div>`
              : ""}
          </div>

          <small class="pl-status pl-card-status ${ready ? "is-ready" : ""} ${offline ? "is-offline" : ""}">
            <i aria-hidden="true"></i>
            ${ready ? "Prêt" : offline ? "Hors ligne" : "Pas prêt"}
          </small>

          ${canKick
            ? `<button class="pl-kick" data-kick-id="${escapeHtml(player.id)}" type="button" aria-label="Retirer ce joueur">×</button>`
            : ""}
        </article>`;
    }).join("");

    const emptySlots = Array.from(
      { length:Math.max(0, LOBBY_MAX_PLAYERS - state.players.length) },
      () => `
        <div class="pl-empty" aria-label="Place libre">
          <b aria-hidden="true">＋</b>
          <span>Place libre</span>
        </div>`
    ).join("");

    const publicMode = state.mode === "public";

    return `
      <main class="screen lobby-v5 pl-private ${publicMode ? "pl-public-mode" : ""}" data-mode="${publicMode ? "public" : "private"}">
        <header class="pl-header">
          <button id="lobbyV5Leave" type="button" aria-label="Quitter le salon">
            <img src="/back-arrow.png" alt="">
          </button>
          ${roomModeToggleMarkup(state, user)}
          <button id="copyCode" class="pl-header-code" type="button" aria-label="Copier le code du salon">
            <small>Code</small>
            <strong>${escapeHtml(state.code)}</strong>
            <img src="/lobby-copy.png" alt="">
          </button>
        </header>

        <section class="pl-settings">
          <h2>
            <img src="/settings.png" alt="">
            <span>Paramètres de la partie</span>
            ${user?.isHost
              ? `<button id="lobbySettingsShortcut" class="pl-settings-edit" type="button" aria-label="Modifier les paramètres"><span>Modifier</span><b aria-hidden="true">›</b></button>`
              : ""}
          </h2>

          <div class="pl-setting-grid">
            ${settingCard({label:"Manches",value:state.rounds,icon:"/lightning.png"})}
            ${settingCard({label:"Catégories",value:state.categoryCount || 6,icon:"/lobby-categories.png"})}
            ${settingCard({label:"Temps",value:state.duration+"s",icon:"/lobby-clock.png"})}
            ${settingCard({label:"Difficulté",value:difficulty.label,icon:difficulty.icon,difficulty:true})}
          </div>
        </section>

        <section class="pl-players">
          <h2>Joueurs <span>${state.players.length}/${LOBBY_MAX_PLAYERS}</span></h2>
          <div class="pl-grid">${cards}${emptySlots}</div>
        </section>

        <div class="pl-actions">
          <div class="pl-social">
            <button id="inviteFriendsBtn" class="pl-invite" type="button">
              <img src="/friends.png" alt="">
              <span>Inviter des amis</span>
            </button>
            <button id="plShare" class="pl-share" type="button" aria-label="Partager le code du salon">
              ${privateLobbyShareIcon()}
              <span>Partager</span>
            </button>
          </div>

          <div class="pl-launch">
            <button
              id="plReady"
              class="${user?.lobbyReady ? "selected" : ""}"
              type="button"
              aria-pressed="${!!user?.lobbyReady}"
            >${user?.lobbyReady ? "Annuler" : "✓ Prêt"}</button>

            ${user?.isHost
              ? `<button id="startBtn" type="button" ${allReady ? "" : "disabled"}>▶ Lancer la partie</button>`
              : `<span class="pl-wait">L’hôte lancera la partie.</span>`}
          </div>

          ${user?.isHost && state.mode === "private"
            ? `<button class="pl-test" data-add-bot="0" type="button" ${state.players.length >= LOBBY_MAX_PLAYERS ? "disabled" : ""}>Ajouter un bot de test</button>`
            : ""}
        </div>

        ${playerProfileModal(state)}
        ${lobbySettingsOverlay(state,user)}
        ${lobbyInviteOverlay(state)}
      </main>`;
  }

  function renderLobbyV5() {
    clearInterval(session.timerHandle);
    session.localAnswers = {};

    const state = session.state;
    const user = me();
    if (!state || state.phase !== "lobby") return render();

    const playerCount = state.players.length;
    const difficulty = difficultyInfo(state.categoryDifficulty);
    const categoryCount = Number(state.categoryCount || state.categories?.length || 6);
    const coins = typeof getCoins === "function" ? getCoins() : 0;
    const adminDisplay = window.PtitBacAdminDisplayState || {};
    const coinDisplay =
      adminDisplay.admin && adminDisplay.infiniteCoins
        ? "∞"
        : String(coins);

    const players = state.players.map((p, index) => playerRow(p, index, user)).join("");
    const emptySlots =
      playerCount < LOBBY_MAX_PLAYERS
        ? emptyPlayerRow(!!user?.isHost && state.mode !== "quick", 0)
        : "";

    setScreen(state.mode !== "quick" ? privateMarkup(state, user) : `
      <main class="screen lobby-v5" data-mode="${state.mode === "quick" ? "quick" : "private"}">
        <header class="lobby-v5-header">
          <button id="lobbyV5Leave" class="lobby-v5-back" type="button" aria-label="Quitter le salon">
            <img src="/lobby-exit.png" alt="">
          </button>

          <div class="lobby-v5-title">
            <h1>Salon</h1>
            <button id="copyCode" class="lobby-v5-code" type="button">
              <span>Code :</span>
              <strong>${escapeHtml(state.code)}</strong>
              <img src="/lobby-copy.png" alt="">
            </button>
          </div>

          <div class="lobby-v5-coin-pill">
            <img src="/coin.png" alt="">
            <strong>${coinDisplay}</strong>
          </div>
        </header>

        ${state.mode !== "quick" ? `<section class="lobby-v5-host-card">
          <div class="lobby-v5-host-crown"><img src="/admin-crown.png" alt=""></div>
          <div class="lobby-v5-host-avatar">${avatarMarkup(user || state.players[0])}</div>
          <div class="lobby-v5-host-copy">
            <small>Hôte de la partie</small>
            <strong>${escapeHtml(state.players.find(p => p.isHost)?.name || user?.name || "Joueur")}</strong>
            ${friendCodeFor(state.players.find(p => p.isHost))
              ? `<span># ${escapeHtml(friendCodeFor(state.players.find(p => p.isHost)))}</span>`
              : ""}
          </div>
          <button class="lobby-v5-settings-shortcut" id="lobbySettingsShortcut" type="button">
            <img src="/settings.png" alt="">
            <span>Paramètres</span>
          </button>
        </section>

        ` : ""}

        <section class="lobby-v5-settings-panel" id="lobbySettingsPanel">
          <h2>
            <img src="/settings.png" alt="">
            Paramètres de la partie
          </h2>

          <div class="lobby-v5-settings-grid">
            ${settingCard({
              key: "rounds",
              label: "Manches",
              value: state.rounds,
              icon: "/lightning.png"
            })}
            ${settingCard({
              key: "categoryCount",
              label: "Catégories",
              value: categoryCount,
              icon: "/lobby-categories.png"
            })}
            ${settingCard({
              key: "duration",
              label: "Temps",
              value: `${Number(state.duration || 60)}s`,
              icon: "/lobby-clock.png"
            })}
            ${settingCard({
              key: "categoryDifficulty",
              label: "Difficulté",
              value: difficulty.label,
              icon: difficulty.icon,
              difficulty: true
            })}
          </div>
        </section>

        <section class="lobby-v5-players-section">
          <h2>Joueurs <span>(${playerCount}/${LOBBY_MAX_PLAYERS})</span></h2>
          <div class="lobby-v5-player-list">
            ${players}
            ${emptySlots}
          </div>
        </section>

        <section class="lobby-v5-actions">
          <button class="lobby-v5-invite" id="inviteFriendsBtn" type="button">
            <img src="/friends.png" alt="">
            <strong>Inviter des amis</strong>
          </button>

          ${user?.isHost
            ? `<button class="lobby-v5-start" id="startBtn" type="button" ${playerCount < 2 ? "disabled" : ""}>
                <span>▶</span>
                <strong>Lancer la partie</strong>
              </button>`
            : `<div class="lobby-v5-wait-host">
                <span class="spinner small-spinner"></span>
                En attente de l’hôte…
              </div>`}
        </section>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>

        ${playerProfileModal(state)}
        ${lobbySettingsOverlay(state, user)}
        ${lobbyInviteOverlay(state)}
      </main>
    `);

    document.getElementById("plShare")?.addEventListener("click", async () => {
      try {
        if (navigator.share) await navigator.share({title:"P’tit Bac", text:"Rejoins mon salon P’tit Bac avec le code "+state.code});
        else document.getElementById("copyCode")?.click();
      } catch (err) { if (err.name !== "AbortError") toast("Partage indisponible. Copie le code du salon."); }
    });
    document.getElementById("plReady")?.addEventListener("click", event => {
      const button = event.currentTarget;
      button.disabled = true;
      socket.timeout(8000).emit("lobby:setReady", {code:state.code,playerId:session.playerId,ready:!user?.lobbyReady}, (err,res) => {
        button.disabled = false;
        if (err || !res?.ok) toast(res?.error || "Connexion interrompue. Réessaie.");
      });
    });
    document.getElementById("plModeToggle")?.addEventListener("click", () => {
      changeRoomMode(state, user);
    });
    const leave = () => {
      lobbySettingsOpen = false;
      lobbyInviteOpen = false;

      const button = document.getElementById("lobbyV5Leave");
      if (button) button.disabled = true;

      socket.timeout(8000).emit(
        "room:leave",
        { code:state.code, playerId:session.playerId },
        (err, res) => {
          if (err || !res?.ok) {
            if (button) button.disabled = false;
            return toast(
              res?.error ||
              "Impossible de quitter le salon pour le moment."
            );
          }

          clearSession();
          if (typeof initWallet === "function") {
            initWallet(() => renderHome());
          } else {
            renderHome();
          }
        }
      );
    };

    document.getElementById("lobbyV5Leave")?.addEventListener("click", leave);

    document.getElementById("copyCode")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.code);
        toast("Code copié !");
      } catch {
        toast(`Code : ${state.code}`);
      }
    });

    document.getElementById("lobbySettingsShortcut")?.addEventListener("click", () => {
      if (!user?.isHost) {
        return toast("Seul l’hôte peut modifier les paramètres.");
      }
      lobbySettingsOpen = true;
      renderLobbyV5();
    });

    const closeInlineSettings = () => {
      lobbySettingsOpen = false;
      renderLobbyV5();
    };

    document.getElementById("lobbySettingsClose")?.addEventListener("click", closeInlineSettings);
    document.getElementById("lobbySettingsApply")?.addEventListener("click", closeInlineSettings);

    document.getElementById("lobbySettingsOverlay")?.addEventListener("click", event => {
      if (event.target.id === "lobbySettingsOverlay") closeInlineSettings();
    });

    const updateInlineSetting = (setting, dir) => {
      if (!user?.isHost) return;

      if (setting === "categoryDifficulty") {
        const now = Date.now();
        if (now < lobbyDifficultyLockUntil) return;
        lobbyDifficultyLockUntil = now + 260;
      }

      const rounds = [1, 3, 5];
      const durations = [30, 60, 90, 120];
      const difficulties = ["beginner", "medium", "hard"];

      let nextRounds = Number(state.rounds || 1);
      let nextDuration = Number(state.duration || 60);
      let nextDifficulty = state.categoryDifficulty || "beginner";
      let nextCategoryCount = categoryCount;
      const categoryCounts = [6, 8, 10];

      const cycle = (arr, current, direction) => {
        let i = arr.indexOf(current);
        if (i < 0) i = 0;
        return arr[(i + direction + arr.length) % arr.length];
      };

      if (setting === "rounds") nextRounds = cycle(rounds, nextRounds, dir);
      if (setting === "duration") nextDuration = cycle(durations, nextDuration, dir);
      if (setting === "categoryDifficulty") nextDifficulty = cycle(difficulties, nextDifficulty, dir);
      if (setting === "categoryCount") {
        const normalizedCount = categoryCounts.includes(nextCategoryCount) ? nextCategoryCount : 6;
        nextCategoryCount = cycle(categoryCounts, normalizedCount, dir);
      }

      document.querySelectorAll("[data-lobby-inline-step]").forEach(button => {
        button.disabled = true;
      });

      socket.emit("room:updateSettings", {
        code: state.code,
        playerId: session.playerId,
        rounds: nextRounds,
        duration: nextDuration,
        categoryCount: nextCategoryCount,
        categoryDifficulty: nextDifficulty
      }, res => {
        if (!res?.ok) {
          lobbyDifficultyLockUntil = 0;
          document.querySelectorAll("[data-lobby-inline-step]").forEach(button => {
            button.disabled = false;
          });
          return toast(res?.error || "Impossible de modifier ce paramètre.");
        }

        if (res.state) session.state = res.state;
        // La room:state va rerendre le salon ; garder l'overlay ouvert.
      });
    };

    document.querySelectorAll("[data-lobby-inline-step]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        updateInlineSetting(
          button.dataset.lobbyInlineStep,
          Number(button.dataset.dir) || 1
        );
      });
    });

    document.getElementById("inviteFriendsBtn")?.addEventListener("click", () => {
      lobbyInviteOpen = true;
      lobbyInviteFriends = [];
      renderLobbyV5();
      loadLobbyInviteFriends();
    });

    const closeLobbyInvite = () => {
      lobbyInviteOpen = false;
      lobbyInviteLoading = false;
      renderLobbyV5();
    };

    document.getElementById("lobbyInviteClose")?.addEventListener("click", closeLobbyInvite);

    document.getElementById("lobbyInviteOverlay")?.addEventListener("click", event => {
      if (event.target.id === "lobbyInviteOverlay") closeLobbyInvite();
    });

    document.querySelectorAll("[data-lobby-invite-friend]").forEach(button => {
      button.addEventListener("click", () => {
        const friendId = button.dataset.lobbyInviteFriend || "";
        if (!friendId) return;

        button.disabled = true;

        lobbyInviteSocket.emit(
          "friends:invite",
          lobbyInviteIdentity({
            friendId,
            roomCode: state.code
          }),
          res => {
            button.disabled = false;

            if (!res?.ok) {
              return toast(res?.error || "Invitation impossible.");
            }

            button.classList.add("sent");
            button.innerHTML = `<span>${res.delivered ? "Envoyé ✓" : "Hors ligne"}</span>`;
            toast(res.delivered ? "Invitation envoyée !" : "Ami hors ligne pour le moment.");
          }
        );
      });
    });

    document.querySelectorAll("[data-add-bot]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!user?.isHost) return;
        if (state.players.length >= LOBBY_MAX_PLAYERS) return toast("Salon complet.");
        socket.emit("room:addBot", { code: state.code, playerId: session.playerId });
      });
    });

    const openProfile = playerId => {
      lobbyOpenedPlayerId = String(playerId || "");
      renderLobbyV5();
    };

    document.querySelectorAll("[data-lobby-player-profile]").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-kick-id]")) return;
        openProfile(card.dataset.lobbyPlayerProfile);
      });
      card.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openProfile(card.dataset.lobbyPlayerProfile);
      });
    });

    const closeProfile = () => {
      lobbyOpenedPlayerId = "";
      renderLobbyV5();
    };

    document.getElementById("lobbyPlayerProfileClose")?.addEventListener("click", closeProfile);
    document.getElementById("lobbyPlayerProfileBackdrop")?.addEventListener("click", event => {
      if (event.target.id === "lobbyPlayerProfileBackdrop") closeProfile();
    });

    document.getElementById("lobbyPlayerInventory")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      if (!window.PtitBacInventory?.open) {
        return toast("Inventaire indisponible pour le moment.");
      }

      lobbyInventoryReturnToLobby = true;
      lobbyOpenedPlayerId = "";
      window.PtitBacInventory.open();
    });

    document.getElementById("lobbyPlayerAddFriend")?.addEventListener("click", () => {
      const target = state.players.find(p => String(p.id) === String(lobbyOpenedPlayerId));
      const code = friendCodeFor(target);
      if (!code) return toast("Code ami indisponible.");
      if (!window.PtitBacFriends?.sendRequestByCode) return toast("Le système d’amis n’est pas encore prêt.");

      window.PtitBacFriends.sendRequestByCode(code, res => {
        if (!res?.ok) return toast(res?.error || "Demande impossible.");
        toast(`Demande envoyée à ${target?.name || "ce joueur"} !`);
      });
    });

    document.getElementById("lobbyPlayerReport")?.addEventListener("click", () => {
      const target = state.players.find(p => String(p.id) === String(lobbyOpenedPlayerId));
      const code = friendCodeFor(target);
      if (!target || !code) return toast("Ce joueur ne peut pas être signalé.");

      socket.emit("players:report", {
        walletToken: session.walletToken || localStorage.getItem("petitbac_walletToken") || "",
        roomCode: state.code,
        targetPlayerId: target.id,
        targetFriendCode: code,
        targetName: target.name || ""
      }, res => {
        if (!res?.ok) return toast(res?.error || "Signalement impossible.");
        toast("Signalement envoyé.");
        closeProfile();
      });
    });

    if (user?.isHost) {
      document.querySelectorAll("[data-kick-id]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.stopPropagation();
          socket.emit("room:kick", {
            code: state.code,
            playerId: session.playerId,
            targetPlayerId: btn.dataset.kickId
          });
        });
      });

      document.getElementById("startBtn")?.addEventListener("click", event => {
        const button = event.currentTarget;
        if (button.disabled || lobbyCountdownActive) return;

        button.disabled = true;
        button.classList.add("is-counting-down");

        socket.emit("lobby:startCountdown", {
          code: state.code,
          playerId: session.playerId
        }, res => {
          if (res?.ok) return;

          lobbyCountdownActive = false;
          button.disabled = false;
          button.classList.remove("is-counting-down");
          toast(res?.error || "Impossible de lancer le compte à rebours.");
        });
      });
    }
  }

  document.addEventListener("click", event => {
    if (!lobbyInventoryReturnToLobby) return;
    if (!event.target.closest?.("#inventoryV2Back")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    lobbyInventoryReturnToLobby = false;

    try {
      window.PtitBacInventory?.close?.();
    } catch {}

    if (session?.state?.phase === "lobby") {
      renderLobbyV5();
    }
  }, true);

  socket.on("lobby:countdown", startLobbyCountdown);

  socket.on("room:state", state => {
    if (state?.phase !== "lobby") clearLobbyCountdown();
  });

  window.renderLobby = renderLobbyV5;
  try { renderLobby = renderLobbyV5; } catch {}
})();


