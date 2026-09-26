(() => {
  "use strict";

  const adminState = {
    admin: false,
    infiniteCoins: false,
    infiniteLives: false
  };

  function walletToken() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function applyAdminClasses() {
    const root = document.documentElement;

    root.classList.toggle(
      "ptb-admin-infinite-coins",
      !!adminState.admin && !!adminState.infiniteCoins
    );

    root.classList.toggle(
      "ptb-admin-infinite-lives",
      !!adminState.admin && !!adminState.infiniteLives
    );
  }

  function refreshAdminState() {
    if (
      document.hidden ||
      typeof socket === "undefined" ||
      !socket?.connected
    ) {
      return;
    }

    const token = walletToken();

    if (!token) {
      adminState.admin = false;
      adminState.infiniteCoins = false;
      adminState.infiniteLives = false;
      window.PtitBacAdminDisplayState = { ...adminState };
      applyAdminClasses();
      return;
    }

    socket.emit("admin:status", { walletToken: token }, res => {
      if (!res?.ok || !res.admin) {
        adminState.admin = false;
        adminState.infiniteCoins = false;
        adminState.infiniteLives = false;
      } else {
        adminState.admin = true;
        adminState.infiniteCoins = !!res.infiniteCoins;
        adminState.infiniteLives = !!res.infiniteLives;
      }

      window.PtitBacAdminDisplayState = { ...adminState };
      applyAdminClasses();
    });
  }

  /* =========================================================
     Salon privé V3 — transformation du lobby actuel.
     Aucun nouveau fichier de jeu : tout reste dans le runtime existant.
     ========================================================= */

  const privateLobbyV3State = {
    busy: false,
    decorating: false
  };

  const roomChatState = {
    open: false,
    roomCode: "",
    messages: [],
    unread: 0,
    loading: false,
    sending: false,
    pendingNew: 0,
    nearBottom: true
  };

  const micSvg = `
    <svg class="pl-v3-comms-svg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3"></rect>
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6"></path>
    </svg>
  `;

  const headphonesSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13v-2a8 8 0 0 1 16 0v2"></path>
      <path d="M4 13h3v7H5a1 1 0 0 1-1-1v-6ZM20 13h-3v7h2a1 1 0 0 0 1-1v-6Z"></path>
    </svg>
  `;

  const settingsSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19 12a7.7 7.7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L5 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7.7 7.7 0 0 0 .1-1Z"></path>
    </svg>
  `;

  const chatSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"></path>
      <circle cx="8" cy="11" r=".8"></circle>
      <circle cx="12" cy="11" r=".8"></circle>
      <circle cx="16" cy="11" r=".8"></circle>
    </svg>
  `;

  function currentLobbyState() {
    try {
      return typeof session !== "undefined" ? session?.state : null;
    } catch {
      return null;
    }
  }

  function currentLobbyUser() {
    try {
      return typeof me === "function" ? me() : null;
    } catch {
      return null;
    }
  }

  function privateLobbyToast(message) {
    try {
      if (typeof toast === "function") {
        toast(message);
        return;
      }
    } catch {}
    console.info("[Salon privé]", message);
  }


  let privateLobbyLeaving = false;

  function finishPrivateLobbyLeave() {
    try {
      if (typeof clearSession === "function") {
        clearSession();
      } else {
        localStorage.removeItem("petitbac_code");
        localStorage.removeItem("petitbac_playerId");
        if (typeof session !== "undefined") {
          session.code = "";
          session.playerId = "";
          session.state = null;
        }
      }
    } catch {}

    try {
      if (typeof renderHome === "function") {
        renderHome();
      } else {
        window.location.assign("/");
      }
    } catch {
      window.location.assign("/");
    }

    try {
      if (typeof initWallet === "function") {
        initWallet(() => {});
      }
    } catch {}
  }

  function leavePrivateLobbyFromHeader(button) {
    if (privateLobbyLeaving) return;
    privateLobbyLeaving = true;

    button.disabled = true;

    const state = currentLobbyState();
    const code = String(state?.code || session?.code || "").trim();
    const playerId = String(session?.playerId || "").trim();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      privateLobbyLeaving = false;
      finishPrivateLobbyLeave();
    };

    const fallback = setTimeout(finish, 3200);

    try {
      if (
        typeof socket === "undefined" ||
        !socket?.connected ||
        !code ||
        !playerId
      ) {
        clearTimeout(fallback);
        return finish();
      }

      socket.timeout(2500).emit(
        "room:leave",
        { code, playerId },
        () => {
          clearTimeout(fallback);
          finish();
        }
      );
    } catch {
      clearTimeout(fallback);
      finish();
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.(
      'main.pl-private-v3[data-mode="private"] #lobbyV5Leave'
    );

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    leavePrivateLobbyFromHeader(button);
  }, true);

  function settingMeta(state) {
    const difficulty =
      state?.categoryDifficulty === "hard" ? "Difficile" :
      state?.categoryDifficulty === "medium" ? "Moyen" :
      "Facile";

    return [
      {
        key: "rounds",
        label: "Manches",
        value: String(Number(state?.rounds || 1)),
        icon: "/lightning.png"
      },
      {
        key: "categoryCount",
        label: "Catégories",
        value: String(Number(state?.categoryCount || state?.categories?.length || 6)),
        icon: "/lobby-categories.png"
      },
      {
        key: "duration",
        label: "Temps",
        value: `${Number(state?.duration || 60)}s`,
        icon: "/lobby-clock.png"
      },
      {
        key: "categoryDifficulty",
        label: "Difficulté",
        value: difficulty,
        icon: "/difficulty.png",
        difficulty: true
      }
    ];
  }

  function buildSettingRow(item, hostCanEdit) {
    const card = document.createElement("article");
    card.className =
      "pl-v3-setting-card" + (item.difficulty ? " is-difficulty" : "");

    const icon = document.createElement("img");
    icon.src = item.icon;
    icon.alt = "";

    const label = document.createElement("span");
    label.className = "pl-v3-setting-label";
    label.textContent = item.label;

    const stepper = document.createElement("div");
    stepper.className = "pl-v3-stepper" + (hostCanEdit ? "" : " is-readonly");

    if (hostCanEdit) {
      const previous = document.createElement("button");
      previous.type = "button";
      previous.dataset.v3SettingStep = item.key;
      previous.dataset.dir = "-1";
      previous.setAttribute("aria-label", `Diminuer ${item.label}`);
      previous.innerHTML = '<span aria-hidden="true">‹</span>';
      stepper.appendChild(previous);
    }

    const value = document.createElement("strong");
    value.textContent = item.value;
    stepper.appendChild(value);

    if (hostCanEdit) {
      const next = document.createElement("button");
      next.type = "button";
      next.dataset.v3SettingStep = item.key;
      next.dataset.dir = "1";
      next.setAttribute("aria-label", `Augmenter ${item.label}`);
      next.innerHTML = '<span aria-hidden="true">›</span>';
      stepper.appendChild(next);
    }

    card.append(icon, label, stepper);
    return card;
  }

  function buildCommsPanel() {
    const panel = document.createElement("aside");
    panel.className = "pl-v3-comms";
    panel.setAttribute("aria-label", "Communication du salon");

    panel.innerHTML = `
      <section class="pl-v3-voice">
        <div class="pl-v3-comms-head">
          ${micSvg}
          <div>
            <strong>Vocal</strong>
            <small><i aria-hidden="true"></i> Connecté</small>
          </div>
          <span class="pl-v3-wave" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
        </div>

        <div class="pl-v3-voice-actions">
          <button id="plVoiceMic" class="is-active" type="button" aria-label="Micro">
            ${micSvg}
          </button>
          <button id="plVoiceHeadphones" type="button" aria-label="Casque">
            ${headphonesSvg}
          </button>
          <button id="plVoiceSettings" type="button" aria-label="Réglages vocaux">
            ${settingsSvg}
          </button>
        </div>
      </section>

      <button id="plRoomChatOpen" class="pl-v3-textchat" type="button">
        <span class="pl-v3-textchat-title">
          ${chatSvg}
          <strong>Chat</strong>
          <em class="pl-room-chat-badge" hidden>0</em>
          <b class="pl-v3-textchat-chevron" aria-hidden="true">›</b>
        </span>
      </button>
    `;

    return panel;
  }


  function roomChatPayload(extra = {}) {
    const state = currentLobbyState();
    const user = currentLobbyUser();

    return {
      code: String(state?.code || session?.code || "").trim(),
      playerId: String(session?.playerId || "").trim(),
      name: String(user?.name || "Joueur").trim(),
      avatar: String(user?.avatar || "").trim(),
      ...extra
    };
  }

  function roomChatTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function roomChatIdentity(message) {
    const state = currentLobbyState();
    const player = state?.players?.find(
      item => String(item?.id || "") === String(message?.playerId || "")
    );

    return {
      name: String(player?.name || message?.name || "Joueur").slice(0, 24),
      avatar: String(player?.avatar || message?.avatar || "").trim()
    };
  }

  function roomChatAvatarElement(message) {
    const identity = roomChatIdentity(message);
    const avatar = identity.avatar;

    if (avatar.startsWith("/") && !avatar.startsWith("//")) {
      const image = document.createElement("img");
      image.src = avatar;
      image.alt = "";
      image.loading = "lazy";
      return image;
    }

    const span = document.createElement("span");
    span.textContent =
      avatar && avatar.length <= 6
        ? avatar
        : (identity.name.charAt(0).toUpperCase() || "?");
    return span;
  }

  function updateRoomChatBadge() {
    const badge = document.querySelector(
      "#plRoomChatOpen .pl-room-chat-badge"
    );
    if (!badge) return;

    const count = Math.max(0, Number(roomChatState.unread) || 0);
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  }

  function roomChatNearBottom(list, threshold = 64) {
    if (!list) return true;
    return (
      list.scrollHeight -
      list.scrollTop -
      list.clientHeight
    ) <= threshold;
  }

  function resizeRoomChatInput(input) {
    if (!input) return;

    const minHeight = 38;
    const maxHeight = 74;

    input.style.height = "0px";
    const target = Math.max(
      minHeight,
      Math.min(maxHeight, input.scrollHeight)
    );
    input.style.height = `${target}px`;
    input.style.overflowY =
      input.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function syncRoomChatViewport() {
    const overlay = document.getElementById("plRoomChatOverlay");
    if (!overlay) return;

    const viewport = window.visualViewport;
    const height = Math.round(
      viewport?.height || window.innerHeight || 0
    );
    const top = Math.round(viewport?.offsetTop || 0);

    if (height > 0) {
      overlay.style.setProperty(
        "--pl-room-chat-viewport-height",
        `${height}px`
      );
    }
    overlay.style.setProperty(
      "--pl-room-chat-viewport-top",
      `${top}px`
    );
  }

  function updateRoomChatNewMessagesButton() {
    const button = document.getElementById(
      "plRoomChatNewMessages"
    );
    if (!button) return;

    const count = Math.max(
      0,
      Number(roomChatState.pendingNew) || 0
    );

    button.hidden = count <= 0;
    button.textContent =
      count <= 1
        ? "Nouveau message ↓"
        : `${count} nouveaux messages ↓`;
  }

  function scrollRoomChatToBottom(behavior = "auto") {
    const list = document.getElementById(
      "plRoomChatMessages"
    );
    if (!list) return;

    list.scrollTo({
      top: list.scrollHeight,
      behavior
    });

    roomChatState.nearBottom = true;
    roomChatState.pendingNew = 0;
    updateRoomChatNewMessagesButton();
  }

  function ensureRoomChatOverlay() {
    let overlay = document.getElementById("plRoomChatOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "plRoomChatOverlay";
    overlay.className = "pl-room-chat-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    overlay.innerHTML = `
      <section class="pl-room-chat-sheet" role="dialog" aria-modal="true" aria-label="Chat du salon">
        <header class="pl-room-chat-header">
          <div>
            <strong>Chat du salon</strong>
            <small>Salon privé</small>
          </div>
          <button id="plRoomChatClose" type="button" aria-label="Fermer">×</button>
        </header>

        <div id="plRoomChatMessages" class="pl-room-chat-messages" aria-live="polite"></div>

        <button id="plRoomChatNewMessages" class="pl-room-chat-new" type="button" hidden>
          Nouveaux messages
        </button>

        <form id="plRoomChatForm" class="pl-room-chat-form">
          <div class="pl-room-chat-input-wrap">
            <textarea
              id="plRoomChatInput"
              maxlength="200"
              rows="1"
              placeholder="Écrire un message…"
              autocomplete="off"
              enterkeyhint="send"
              aria-label="Écrire un message"
            ></textarea>
            <small id="plRoomChatCount">0/200</small>
          </div>
          <button id="plRoomChatSend" type="submit" aria-label="Envoyer">
            <span aria-hidden="true">➤</span>
          </button>
        </form>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeRoomChat();
    });

    overlay.querySelector("#plRoomChatClose")?.addEventListener(
      "click",
      closeRoomChat
    );

    const input = overlay.querySelector("#plRoomChatInput");
    const counter = overlay.querySelector("#plRoomChatCount");
    const list = overlay.querySelector("#plRoomChatMessages");
    const newMessagesButton = overlay.querySelector(
      "#plRoomChatNewMessages"
    );

    input?.addEventListener("input", () => {
      if (counter) {
        counter.textContent = `${input.value.length}/200`;
      }
      resizeRoomChatInput(input);
    });

    input?.addEventListener("focus", () => {
      syncRoomChatViewport();
      setTimeout(() => {
        if (roomChatState.nearBottom) {
          scrollRoomChatToBottom("auto");
        }
      }, 80);
    });

    input?.addEventListener("keydown", event => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        overlay.querySelector("#plRoomChatForm")
          ?.requestSubmit?.();
      }
    });

    list?.addEventListener("scroll", () => {
      const nearBottom = roomChatNearBottom(list);
      roomChatState.nearBottom = nearBottom;

      if (nearBottom && roomChatState.pendingNew) {
        roomChatState.pendingNew = 0;
        updateRoomChatNewMessagesButton();
      }
    }, { passive: true });

    newMessagesButton?.addEventListener("click", () => {
      scrollRoomChatToBottom("smooth");
    });

    overlay.querySelector("#plRoomChatForm")?.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        sendRoomChatMessage();
      }
    );

    if (!overlay.dataset.viewportBound) {
      overlay.dataset.viewportBound = "1";
      window.visualViewport?.addEventListener(
        "resize",
        syncRoomChatViewport
      );
      window.visualViewport?.addEventListener(
        "scroll",
        syncRoomChatViewport
      );
      window.addEventListener(
        "resize",
        syncRoomChatViewport
      );
    }

    resizeRoomChatInput(input);
    syncRoomChatViewport();

    return overlay;
  }

  function renderRoomChatMessages({
    forceBottom = false,
    preserveScroll = false
  } = {}) {
    const overlay = ensureRoomChatOverlay();
    const list = overlay.querySelector("#plRoomChatMessages");
    if (!list) return;

    const previousScrollTop = list.scrollTop;
    const wasNearBottom =
      forceBottom ||
      roomChatState.nearBottom ||
      roomChatNearBottom(list);

    list.replaceChildren();
    list.classList.remove("is-short");

    if (roomChatState.loading) {
      const loading = document.createElement("div");
      loading.className = "pl-room-chat-empty";
      loading.textContent = "Chargement…";
      list.appendChild(loading);
      return;
    }

    if (!roomChatState.messages.length) {
      const empty = document.createElement("div");
      empty.className = "pl-room-chat-empty";
      const strong = document.createElement("strong");
      strong.textContent = "Aucun message";
      const span = document.createElement("span");
      span.textContent =
        "Écris le premier message du salon.";
      empty.append(strong, span);
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    roomChatState.messages.forEach((message, index) => {
      const mine =
        String(message?.playerId || "") ===
        String(session?.playerId || "");
      const identity = roomChatIdentity(message);
      const previous = roomChatState.messages[index - 1];

      const samePreviousPlayer =
        !!previous &&
        String(previous?.playerId || "") ===
          String(message?.playerId || "");

      const previousTime = new Date(
        previous?.createdAt || 0
      ).getTime();
      const currentTime = new Date(
        message?.createdAt || 0
      ).getTime();

      const grouped =
        samePreviousPlayer &&
        Number.isFinite(previousTime) &&
        Number.isFinite(currentTime) &&
        currentTime - previousTime <= 2 * 60 * 1000;

      const row = document.createElement("article");
      row.className =
        "pl-room-chat-message " +
        (mine ? "is-mine" : "is-other") +
        (grouped ? " is-continuation" : "");

      const avatar = document.createElement("div");
      avatar.className = "pl-room-chat-avatar";
      avatar.appendChild(roomChatAvatarElement(message));

      const body = document.createElement("div");
      body.className = "pl-room-chat-message-body";

      if (!grouped) {
        const meta = document.createElement("div");
        meta.className = "pl-room-chat-meta";

        const author = document.createElement("strong");
        author.textContent = mine ? "Moi" : identity.name;

        const time = document.createElement("time");
        time.textContent = roomChatTime(
          message?.createdAt
        );

        meta.append(author, time);
        body.appendChild(meta);
      }

      const bubble = document.createElement("p");
      bubble.textContent = String(
        message?.content || ""
      );
      body.appendChild(bubble);

      if (mine) row.append(body, avatar);
      else row.append(avatar, body);

      fragment.appendChild(row);
    });

    list.appendChild(fragment);

    requestAnimationFrame(() => {
      list.classList.toggle(
        "is-short",
        list.scrollHeight <= list.clientHeight + 6
      );

      if (wasNearBottom) {
        list.scrollTop = list.scrollHeight;
        roomChatState.nearBottom = true;
        roomChatState.pendingNew = 0;
        updateRoomChatNewMessagesButton();
      } else if (preserveScroll) {
        list.scrollTop = previousScrollTop;
        roomChatState.nearBottom =
          roomChatNearBottom(list);
      }
    });
  }

  function syncRoomChatContext() {
    const state = currentLobbyState();
    const code = String(state?.code || "").trim();

    if (!state || state.mode !== "private" || !code) {
      if (roomChatState.open) closeRoomChat();
      roomChatState.roomCode = "";
      roomChatState.messages = [];
      roomChatState.unread = 0;
      updateRoomChatBadge();
      return;
    }

    if (roomChatState.roomCode !== code) {
      roomChatState.roomCode = code;
      roomChatState.messages = [];
      roomChatState.unread = 0;
      roomChatState.loading = false;
      roomChatState.sending = false;
      roomChatState.pendingNew = 0;
      roomChatState.nearBottom = true;
    }

    updateRoomChatBadge();
  }

  function openRoomChat() {
    const state = currentLobbyState();
    if (!state || state.mode !== "private") {
      return privateLobbyToast("Le chat est disponible dans les salons privés.");
    }

    syncRoomChatContext();

    const overlay = ensureRoomChatOverlay();
    roomChatState.open = true;
    roomChatState.unread = 0;
    roomChatState.loading = true;
    updateRoomChatBadge();

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("pl-room-chat-open");
    roomChatState.pendingNew = 0;
    roomChatState.nearBottom = true;
    updateRoomChatNewMessagesButton();
    syncRoomChatViewport();
    renderRoomChatMessages({ forceBottom: true });

    socket.emit("room:chat:history", roomChatPayload(), res => {
      roomChatState.loading = false;

      if (!res?.ok) {
        renderRoomChatMessages();
        return privateLobbyToast(res?.error || "Impossible de charger le chat.");
      }

      roomChatState.messages = Array.isArray(res.messages)
        ? res.messages.slice(-50)
        : [];
      renderRoomChatMessages({ forceBottom: true });

      setTimeout(() => {
        overlay.querySelector("#plRoomChatInput")?.focus?.({ preventScroll: true });
      }, 80);
    });
  }

  function closeRoomChat() {
    const overlay = document.getElementById("plRoomChatOverlay");
    roomChatState.open = false;
    roomChatState.pendingNew = 0;
    roomChatState.nearBottom = true;
    updateRoomChatNewMessagesButton();
    document.documentElement.classList.remove("pl-room-chat-open");

    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
  }

  function sendRoomChatMessage() {
    if (roomChatState.sending) return;

    const overlay = ensureRoomChatOverlay();
    const input = overlay.querySelector("#plRoomChatInput");
    const sendButton = overlay.querySelector("#plRoomChatSend");
    const counter = overlay.querySelector("#plRoomChatCount");
    const form = overlay.querySelector("#plRoomChatForm");
    const content = String(input?.value || "").trim();
    if (!content) return;

    roomChatState.sending = true;
    if (sendButton) sendButton.disabled = true;
    form?.classList.add("is-sending");

    socket.emit("room:chat:send", roomChatPayload({ content }), res => {
      roomChatState.sending = false;
      if (sendButton) sendButton.disabled = false;
      form?.classList.remove("is-sending");

      if (!res?.ok) {
        return privateLobbyToast(res?.error || "Impossible d’envoyer le message.");
      }

      if (input) {
        input.value = "";
        resizeRoomChatInput(input);
      }
      if (counter) counter.textContent = "0/200";
      roomChatState.nearBottom = true;
      scrollRoomChatToBottom("smooth");
      input?.focus?.({ preventScroll: true });
    });
  }

  function receiveRoomChatMessage(message) {
    const state = currentLobbyState();
    if (!state || state.mode !== "private" || String(message?.roomCode || "") !== String(state.code || "")) {
      return;
    }

    syncRoomChatContext();

    if (roomChatState.messages.some(existing => String(existing?.id || "") === String(message?.id || ""))) {
      return;
    }

    roomChatState.messages.push(message);
    if (roomChatState.messages.length > 50) {
      roomChatState.messages.splice(0, roomChatState.messages.length - 50);
    }

    if (roomChatState.open) {
      const list = document.getElementById(
        "plRoomChatMessages"
      );
      const nearBottom =
        roomChatNearBottom(list) ||
        String(message?.playerId || "") ===
          String(session?.playerId || "");

      roomChatState.nearBottom = nearBottom;

      if (!nearBottom) {
        roomChatState.pendingNew += 1;
        updateRoomChatNewMessagesButton();
      }

      renderRoomChatMessages({
        forceBottom: nearBottom,
        preserveScroll: !nearBottom
      });
    } else {
      roomChatState.unread += 1;
      updateRoomChatBadge();
    }
  }

  function decoratePlayerCards(root) {
    root.querySelectorAll(".pl-player").forEach(card => {
      const avatarShell = card.querySelector(".pl-avatar-shell");
      const titleRow = card.querySelector(".pl-player-title-row");
      const crown = titleRow?.querySelector(".pl-host-crown-inline");

      if (avatarShell && crown) {
        crown.classList.remove("pl-host-crown-inline");
        crown.classList.add("pl-host-crown-top");
        avatarShell.insertBefore(crown, avatarShell.firstChild);
      }
    });
  }

  function decoratePlayersHeader(root) {
    const players = root.querySelector(".pl-players");
    if (!players || players.querySelector(".pl-v3-players-bar")) return;

    const title = players.querySelector(":scope > h2");
    const actions = root.querySelector(":scope > .pl-actions > .pl-social");
    if (!title) return;

    const state = currentLobbyState();
    const count = Array.isArray(state?.players) ? state.players.length : 0;

    const bar = document.createElement("div");
    bar.className = "pl-v3-players-bar";

    title.innerHTML = `
      <img src="/friends.png" alt="">
      <span class="pl-v3-player-label">Joueurs</span>
      <span class="pl-v3-player-count">(${count}/6)</span>
    `;

    bar.appendChild(title);

    if (actions) {
      const inviteText = actions.querySelector(".pl-invite span");
      if (inviteText) inviteText.textContent = "Inviter des amis";

      const shareText = actions.querySelector(".pl-share span");
      if (shareText) shareText.remove();

      bar.appendChild(actions);
    }

    players.insertBefore(bar, players.firstChild);
  }

  function decorateSettings(root) {
    const settings = root.querySelector(":scope > .pl-settings");
    if (!settings) return;

    const state = currentLobbyState();
    const shortcut = settings.querySelector("#lobbySettingsShortcut");
    const hostCanEdit = !!shortcut || currentLobbyUser()?.isHost === true;

    shortcut?.remove();

    const heading = settings.querySelector(":scope > h2");
    if (heading) {
      heading.innerHTML = `
        <img src="/settings.png" alt="">
        <span>Paramètres de la partie</span>
      `;
    }

    const grid = settings.querySelector(".pl-setting-grid");
    if (!grid) return;

    grid.innerHTML = "";
    settingMeta(state).forEach(item => {
      grid.appendChild(buildSettingRow(item, hostCanEdit));
    });
  }

  function decorateBottom(root) {
    root.querySelector(".pl-test")?.remove();
    root.querySelector(".pl-launch-hint")?.remove();
  }

  function decoratePrivateLobbyV3() {
    if (privateLobbyV3State.decorating) return;

    const root = document.querySelector(
      'main.lobby-v5.pl-private[data-mode="private"]:not(.pl-public-mode)'
    );

    if (!root) return;

    privateLobbyV3State.decorating = true;

    try {
      root.classList.add("pl-private-v3");

      const codeLabel = root.querySelector(".pl-header-code small");
      if (codeLabel) codeLabel.textContent = "Code salon";

      decorateSettings(root);

      if (!root.querySelector(":scope > .pl-v3-comms")) {
        const settings = root.querySelector(":scope > .pl-settings");
        settings?.insertAdjacentElement("afterend", buildCommsPanel());
      }

      decoratePlayersHeader(root);
      decoratePlayerCards(root);
      decorateBottom(root);
    } finally {
      privateLobbyV3State.decorating = false;
    }
  }

  function cycleValue(values, current, direction) {
    let index = values.indexOf(current);
    if (index < 0) index = 0;
    return values[(index + direction + values.length) % values.length];
  }

  function updatePrivateLobbySetting(setting, direction) {
    if (privateLobbyV3State.busy) return;

    const root = document.querySelector(
      'main.lobby-v5.pl-private.pl-private-v3[data-mode="private"]'
    );
    if (!root) return;

    const state = currentLobbyState();
    const user = currentLobbyUser();

    if (!state || user?.isHost !== true) {
      return privateLobbyToast("Seul l’hôte peut modifier les paramètres.");
    }

    const rounds = [1, 3, 5];
    const categoryCounts = [6, 8, 10];
    const durations = [30, 60, 90];
    const difficulties = ["beginner", "medium", "hard"];

    let nextRounds = Number(state.rounds || 1);
    let nextCategoryCount = Number(
      state.categoryCount || state.categories?.length || 6
    );
    let nextDuration = Number(state.duration || 60);
    let nextDifficulty = state.categoryDifficulty || "medium";

    if (setting === "rounds") {
      nextRounds = cycleValue(rounds, nextRounds, direction);
    } else if (setting === "categoryCount") {
      const normalized = categoryCounts.includes(nextCategoryCount)
        ? nextCategoryCount
        : 6;
      nextCategoryCount = cycleValue(
        categoryCounts,
        normalized,
        direction
      );
    } else if (setting === "duration") {
      const normalized = durations.includes(nextDuration)
        ? nextDuration
        : 60;
      nextDuration = cycleValue(durations, normalized, direction);
    } else if (setting === "categoryDifficulty") {
      nextDifficulty = cycleValue(
        difficulties,
        nextDifficulty,
        direction
      );
    } else {
      return;
    }

    privateLobbyV3State.busy = true;

    root.querySelectorAll("[data-v3-setting-step]").forEach(button => {
      button.disabled = true;
    });

    socket.emit(
      "room:updateSettings",
      {
        code: state.code,
        playerId: session.playerId,
        rounds: nextRounds,
        duration: nextDuration,
        categoryCount: nextCategoryCount,
        categoryDifficulty: nextDifficulty
      },
      res => {
        privateLobbyV3State.busy = false;

        if (!res?.ok) {
          root.querySelectorAll("[data-v3-setting-step]").forEach(button => {
            button.disabled = false;
          });
          return privateLobbyToast(
            res?.error || "Impossible de modifier ce paramètre."
          );
        }

        if (res.state) {
          session.state = res.state;
        }
      }
    );
  }

  document.addEventListener("click", event => {
    const settingButton = event.target.closest?.("[data-v3-setting-step]");

    if (settingButton) {
      event.preventDefault();
      event.stopPropagation();

      updatePrivateLobbySetting(
        settingButton.dataset.v3SettingStep,
        Number(settingButton.dataset.dir) || 1
      );

      return;
    }

    if (event.target.closest?.("#plVoiceMic, #plVoiceHeadphones, #plVoiceSettings")) {
      event.preventDefault();
      privateLobbyToast("Le chat vocal sera branché à l’étape suivante.");
      return;
    }

    if (event.target.closest?.("#plRoomChatOpen")) {
      event.preventDefault();
      event.stopPropagation();
      openRoomChat();
      return;
    }
  }, true);

  document.addEventListener("click", event => {
    const legacyTrigger = event.target.closest?.(
      "#homePlaqueCrown, #betaAdminTrigger"
    );

    if (!legacyTrigger) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("change", event => {
    if (!event.target.closest?.("#admCoins, #admLives")) return;
    setTimeout(refreshAdminState, 180);
  }, true);

  document.addEventListener("click", event => {
    if (!event.target.closest?.(
      "#adminActivationValidate, .admin-v1-crown-btn, #admValidate"
    )) return;

    setTimeout(refreshAdminState, 250);
  }, true);

  function cleanupCurrentScreen() {
    const hud = document.getElementById("economyHud");
    const reports = document.querySelector(".admin-v1-page");

    if (hud) {
      if (reports) {
        hud.setAttribute("aria-hidden", "true");
      } else {
        hud.removeAttribute("aria-hidden");
      }
    }

    decoratePrivateLobbyV3();
    syncRoomChatContext();
  }

  document.addEventListener(
    "ptitbac:screen-rendered",
    cleanupCurrentScreen
  );
  document.addEventListener(
    "ptitbac:dom-updated",
    cleanupCurrentScreen
  );

  if (typeof socket !== "undefined") {
    socket.on("connect", () => setTimeout(refreshAdminState, 120));
    socket.on("room:chat:message", receiveRoomChatMessage);
  }

  window.addEventListener("online", () => setTimeout(refreshAdminState, 120));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(refreshAdminState, 120);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && roomChatState.open) closeRoomChat();
  });

  setTimeout(refreshAdminState, 250);
  setInterval(refreshAdminState, 30000);

  cleanupCurrentScreen();

  window.PtitBacUiRuntime = Object.freeze({
    refreshAdminState,
    cleanupCurrentScreen,
    decoratePrivateLobbyV3,
    openRoomChat,
    closeRoomChat
  });
})();
