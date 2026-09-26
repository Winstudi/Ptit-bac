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
          <b class="pl-v3-textchat-chevron" aria-hidden="true">›</b>
        </span>
      </button>
    `;

    return panel;
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
      privateLobbyToast("Le chat écrit sera branché à l’étape suivante.");
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
  }

  window.addEventListener("online", () => setTimeout(refreshAdminState, 120));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(refreshAdminState, 120);
  });

  setTimeout(refreshAdminState, 250);
  setInterval(refreshAdminState, 30000);

  cleanupCurrentScreen();

  window.PtitBacUiRuntime = Object.freeze({
    refreshAdminState,
    cleanupCurrentScreen,
    decoratePrivateLobbyV3
  });
})();
