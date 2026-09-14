(() => {
  "use strict";

  let countdownTimer = null;
  let countdownFinishTimer = null;
  let countdownActive = false;
  let countdownCode = "";
  let countdownAudio = null;
  let lastCountdownValue = "";
  let modeSwitching = false;

  function isLobbyVisible() {
    return !!document.querySelector(".lobby-v5");
  }

  function currentPlayer() {
    try {
      return typeof me === "function" ? me() : null;
    } catch {
      return null;
    }
  }

  function currentLobbyState() {
    try {
      return session?.state || null;
    } catch {
      return null;
    }
  }

  function ensureRoomModeControl() {
    const state = currentLobbyState();
    const root = document.querySelector(".lobby-v5.pl-private");

    if (!state || state.phase !== "lobby" || !root || state.mode === "quick") {
      return;
    }

    const publicMode = state.mode === "public";
    const host = currentPlayer()?.isHost === true;
    const header = root.querySelector(".pl-header");
    const heading = header?.querySelector("h1");

    if (!header || !heading) return;

    root.dataset.mode = publicMode ? "public" : "private";
    root.classList.toggle("pl-public-mode", publicMode);
    heading.textContent = publicMode ? "Salon public" : "Salon privé";

    let titleWrap = header.querySelector(".pl-title-mode");

    if (!titleWrap) {
      titleWrap = document.createElement("div");
      titleWrap.className = "pl-title-mode";
      heading.before(titleWrap);
      titleWrap.appendChild(heading);
    }

    let toggle = titleWrap.querySelector("#plModeToggle");

    if (!toggle) {
      toggle = document.createElement("button");
      toggle.id = "plModeToggle";
      toggle.className = "pl-mode-toggle";
      toggle.type = "button";
      titleWrap.appendChild(toggle);

      toggle.addEventListener("click", () => {
        const liveState = currentLobbyState();
        const user = currentPlayer();

        if (!liveState || liveState.phase !== "lobby" || !user?.isHost || modeSwitching) {
          return;
        }

        const nextMode = liveState.mode === "public" ? "private" : "public";
        modeSwitching = true;
        ensureRoomModeControl();

        socket.timeout(8000).emit(
          "room:setMode",
          {
            code: liveState.code,
            playerId: session.playerId,
            mode: nextMode
          },
          (err, res) => {
            modeSwitching = false;

            if (err || !res?.ok) {
              ensureRoomModeControl();
              return toast(res?.error || "Impossible de modifier le type du salon.");
            }

            if (res.state) session.state = res.state;
            ensureRoomModeControl();
          }
        );
      });
    }

    toggle.disabled = !host || modeSwitching;
    toggle.classList.toggle("is-public", publicMode);
    toggle.setAttribute("aria-pressed", publicMode ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      host
        ? `Passer le salon en mode ${publicMode ? "privé" : "public"}`
        : `Salon ${publicMode ? "public" : "privé"}`
    );
    toggle.title = publicMode
      ? "Public : 1 vie, gains activés, visible en recherche rapide"
      : "Privé : gratuit, sans gains, accès par code ou invitation";
    toggle.innerHTML = `
      <span class="pl-mode-toggle-dot" aria-hidden="true"></span>
      <strong>${publicMode ? "Public" : "Privé"}</strong>
    `;

    const botButton = root.querySelector(".pl-test");
    if (botButton) botButton.hidden = publicMode;
  }

  function removeCountdown() {
    clearInterval(countdownTimer);
    clearTimeout(countdownFinishTimer);
    countdownTimer = null;
    countdownFinishTimer = null;
    countdownActive = false;
    countdownCode = "";
    lastCountdownValue = "";

    if (countdownAudio) {
      try {
        countdownAudio.pause();
        countdownAudio.currentTime = 0;
      } catch {}
      countdownAudio = null;
    }

    document.getElementById("lobbyStartCountdown")?.remove();
  }

  function ensureCountdownOverlay() {
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

  function startCountdown(payload = {}) {
    if (!payload.code || String(payload.code) !== String(session?.state?.code || session?.code || "")) {
      return;
    }

    removeCountdown();

    countdownActive = true;
    countdownCode = String(payload.code);

    const overlay = ensureCountdownOverlay();
    const number = overlay.querySelector("#lobbyCountdownNumber");
    const card = overlay.querySelector(".lobby-start-countdown-card");
    const ring = overlay.querySelector(".lobby-countdown-ring");

    try {
      countdownAudio = new Audio("/ptitbac-countdown-neon.wav");
      countdownAudio.preload = "auto";
      countdownAudio.volume = 0.78;
      countdownAudio.currentTime = 0;
      const playPromise = countdownAudio.play();
      if (playPromise?.catch) playPromise.catch(() => {});
    } catch {}

    const startedAt = Number(payload.startedAt || Date.now());
    const durationMs = Math.max(3000, Number(payload.durationMs || 3200));
    const deadline = startedAt + durationMs;

    const update = () => {
      const remaining = deadline - Date.now();
      let nextValue = "3";

      if (remaining > 2200) {
        nextValue = "3";
      } else if (remaining > 1200) {
        nextValue = "2";
      } else if (remaining > 250) {
        nextValue = "1";
      } else {
        nextValue = "!";
      }

      if (number && nextValue !== lastCountdownValue) {
        number.textContent = nextValue;
        lastCountdownValue = nextValue;

        ring?.classList.remove("pulse");
        void ring?.offsetWidth;
        ring?.classList.add("pulse");
      }

      if (nextValue === "!") card?.classList.add("is-go");
    };

    update();
    countdownTimer = setInterval(update, 70);

    const user = currentPlayer();
    const amHost =
      !!user?.isHost &&
      String(user.id) === String(payload.hostPlayerId || "");

    if (amHost) {
      countdownFinishTimer = setTimeout(() => {
        // Vérifie qu'on est toujours dans le même salon avant de lancer.
        if (
          countdownActive &&
          isLobbyVisible() &&
          String(session?.state?.code || session?.code || "") === countdownCode
        ) {
          socket.emit("game:start", {
            code: countdownCode,
            playerId: session.playerId
          });
        }
      }, durationMs);
    }

    // Filet de sécurité si l'état serveur tarde à arriver.
    setTimeout(() => {
      if (isLobbyVisible()) removeCountdown();
    }, durationMs + 1800);
  }

  socket.on("lobby:countdown", startCountdown);

  // Dès qu'on quitte le salon pour la page suivante, on retire l'overlay.
  socket.on("room:state", state => {
    if (state?.phase !== "lobby") {
      removeCountdown();
      return;
    }

    queueMicrotask(ensureRoomModeControl);
  });

  queueMicrotask(ensureRoomModeControl);

  const appRoot = document.getElementById("app");
  if (appRoot) {
    const lobbyModeObserver = new MutationObserver(() => {
      if (document.querySelector(".lobby-v5.pl-private")) {
        queueMicrotask(ensureRoomModeControl);
      }
    });

    lobbyModeObserver.observe(appRoot, {
      childList: true
    });
  }

  /*
   * Le lobby historique possède déjà un listener direct sur #startBtn
   * qui envoie game:start immédiatement.
   *
   * Ce listener en capture passe AVANT lui, bloque son exécution,
   * puis demande le compte à rebours au serveur.
   */
  document.addEventListener("click", event => {
    const button = event.target.closest?.("#startBtn");
    if (!button || !isLobbyVisible()) return;

    const user = currentPlayer();
    if (!user?.isHost || button.disabled || countdownActive) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    button.disabled = true;
    button.classList.add("is-counting-down");

    socket.emit("lobby:startCountdown", {
      code: session.state?.code || session.code,
      playerId: session.playerId
    }, res => {
      if (res?.ok) return;

      countdownActive = false;
      button.disabled = false;
      button.classList.remove("is-counting-down");
      toast(res?.error || "Impossible de lancer le compte à rebours.");
    });
  }, true);
})();