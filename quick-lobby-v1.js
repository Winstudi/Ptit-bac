(() => {
  "use strict";

  let scheduled = false;
  let quickStarting = false;

  const readyByPlayerId = new Map();

  function localPlayerId() {
    try {
      return String(session?.playerId || "");
    } catch {
      return "";
    }
  }

  function setQuickPlayerStatus(row, ready) {
    if (!row) return;

    const status = row.querySelector(
      ".ready-badge, .offline-badge, .quick-player-state"
    );

    if (!status) return;

    status.classList.remove(
      "ready-badge",
      "offline-badge",
      "is-ready",
      "is-waiting"
    );

    status.classList.add(
      "quick-player-state",
      ready ? "is-ready" : "is-waiting"
    );

    status.textContent = ready ? "● Prêt" : "En attente…";
  }

  function applyReadyState(root) {
    if (!root) return;

    const myId = localPlayerId();
    const rows = [...root.querySelectorAll(".lobby-v5-player")];

    rows.forEach(row => {
      const playerId = String(row.dataset.lobbyPlayerProfile || "");
      const ready = readyByPlayerId.get(playerId) === true;

      setQuickPlayerStatus(row, ready);

      if (playerId === myId) {
        row.classList.add("quick-self-row");
      }
    });

    const meRow =
      rows.find(
        row => String(row.dataset.lobbyPlayerProfile || "") === myId
      ) || rows[0];

    if (!meRow) return;

    const mePlayerId =
      String(meRow.dataset.lobbyPlayerProfile || "") || myId;

    const myReady = readyByPlayerId.get(mePlayerId) === true;
    const button = meRow.querySelector(".quick-ready-btn");

    if (!button) return;

    button.classList.toggle("is-ready", myReady);
    button.classList.toggle("is-starting", quickStarting);
    button.setAttribute("aria-pressed", myReady ? "true" : "false");
    button.disabled = quickStarting;

    const check = button.querySelector("span");
    const label = button.querySelector("strong");

    if (check) check.textContent = myReady ? "✓" : "";

    if (label) {
      label.textContent = quickStarting
        ? "DÉPART…"
        : myReady
          ? "PRÊT"
          : "PRÊT ?";
    }

    const searchTitle = root.querySelector(".quick-search-copy > strong");
    const searchSubtitle = root.querySelector(".quick-search-copy > small");

    if (quickStarting) {
      if (searchTitle) searchTitle.textContent = "Tous les joueurs sont prêts !";
      if (searchSubtitle) searchSubtitle.textContent = "Lancement de la partie…";
    } else {
      if (searchTitle) searchTitle.textContent = "Recherche d’autres joueurs…";
      if (searchSubtitle) {
        searchSubtitle.textContent = "Tu peux annuler sans perdre de vie.";
      }
    }
  }

  function scheduleEnhance() {
    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      enhanceQuickLobby();
    });
  }

  function enhanceQuickLobby() {
    const root = document.querySelector(".lobby-v5[data-mode='quick']");
    if (!root) return;

    const firstPass = root.dataset.quickLobbyEnhanced !== "1";

    if (firstPass) {
      root.dataset.quickLobbyEnhanced = "1";
      root.classList.add("quick-lobby-v1");

      const title = root.querySelector(".lobby-v5-title");
      const backButton = root.querySelector("#lobbyV5Leave");

      if (backButton) {
        backButton.classList.add("quick-lobby-back");

        const backIcon = backButton.querySelector("img");

        if (backIcon) {
          backIcon.src = "/back-arrow.png";
        }
      }

      // Même en-tête visuel que le salon privé.
      root.querySelector(".lobby-v5-coin-pill")?.remove();

      if (title) {
        title.querySelector(".lobby-v5-code")?.remove();
        title.querySelector(".quick-lobby-subtitle")?.remove();

        const heading = title.querySelector("h1");

        if (heading) {
          heading.textContent = "Partie Rapide";
        }
      }

      // Partie rapide : paramètres seulement informatifs.
      root.querySelector(".lobby-v5-settings-shortcut")?.remove();

      // Le format Partie Rapide est fixe : difficulté Moyen.
      const difficultyCard =
        root.querySelector(".lobby-v5-setting-card.is-difficulty");

      if (difficultyCard) {
        const difficultyIcon =
          difficultyCard.querySelector(".lobby-v5-setting-icon");

        const difficultyValue =
          difficultyCard.querySelector(
            ".lobby-v5-setting-value strong"
          );

        if (difficultyIcon) {
          difficultyIcon.src =
            "/difficulty.png";
        }

        if (difficultyValue) {
          difficultyValue.textContent =
            "Moyen";
        }
      }

      const list = root.querySelector(".lobby-v5-player-list");

      if (list) {
        const currentRows = [...list.querySelectorAll(".lobby-v5-player")];

        currentRows.forEach(row => {
          row.querySelector(".host-badge")?.remove();
          setQuickPlayerStatus(
            row,
            readyByPlayerId.get(
              String(row.dataset.lobbyPlayerProfile || "")
            ) === true
          );
        });

        // Toujours six emplacements visibles, comme dans le salon privé.
        const count = currentRows.length;
        const playersHeading =
          root.querySelector(".lobby-v5-players-section h2");

        if (playersHeading) {
          playersHeading.innerHTML =
            `Joueurs <span>${count}/6</span>`;
        }

        list.querySelectorAll(".lobby-v5-empty-player").forEach(el => {
          el.remove();
        });

        for (let index = count; index < 6; index += 1) {
          list.insertAdjacentHTML(
            "beforeend",
            `
              <div class="lobby-v5-empty-player readonly quick-empty-player">
                <span class="lobby-v5-empty-plus">＋</span>
                <span>Place libre</span>
              </div>
            `
          );
        }

        const myId = localPlayerId();

        const meRow =
          currentRows.find(
            row =>
              String(row.dataset.lobbyPlayerProfile || "") === myId
          ) || currentRows[0];

        if (meRow && !meRow.querySelector(".quick-ready-btn")) {
          const mePlayerId =
            String(meRow.dataset.lobbyPlayerProfile || "") || myId;

          const myReady = readyByPlayerId.get(mePlayerId) === true;

          meRow.classList.add("quick-self-row");

          meRow.insertAdjacentHTML(
            "beforeend",
            `
              <button
                class="quick-ready-btn ${myReady ? "is-ready" : ""}"
                type="button"
                aria-pressed="${myReady ? "true" : "false"}"
              >
                <span>${myReady ? "✓" : ""}</span>
                <strong>${myReady ? "PRÊT" : "PRÊT ?"}</strong>
              </button>
            `
          );

          meRow
            .querySelector(".quick-ready-btn")
            ?.addEventListener("click", event => {
              event.preventDefault();
              event.stopPropagation();

              const button = event.currentTarget;

              if (button.disabled || quickStarting) return;

              const current =
                readyByPlayerId.get(mePlayerId) === true;

              const nextReady = !current;

              // Retour visuel immédiat, confirmé ensuite par le serveur.
              readyByPlayerId.set(mePlayerId, nextReady);
              applyReadyState(root);

              button.disabled = true;

              socket.emit(
                "quick:ready",
                { ready: nextReady },
                response => {
                  if (!response?.ok) {
                    readyByPlayerId.set(mePlayerId, current);
                    applyReadyState(root);
                    toast(
                      response?.error ||
                      "Impossible de modifier ton état."
                    );
                    return;
                  }

                  readyByPlayerId.set(
                    mePlayerId,
                    response.ready === true
                  );

                  applyReadyState(root);
                }
              );
            });
        }
      }

      // Remplace les actions du salon privé par la recherche rapide.
      const actions = root.querySelector(".lobby-v5-actions");

      if (actions) {
        actions.outerHTML = `
          <section class="quick-search-panel" aria-live="polite">
            <div class="quick-search-icon" aria-hidden="true">
              <img src="/friends.png" alt="">
              <span></span>
            </div>

            <div class="quick-search-copy">
              <strong>Recherche d’autres joueurs…</strong>
              <small>Tu peux annuler sans perdre de vie.</small>

              <div class="quick-search-dots">
                <i></i><i></i><i></i>
              </div>

              <button
                id="quickCancelSearch"
                class="quick-cancel-search"
                type="button"
              >
                <b>×</b>
                <span>Annuler la recherche</span>
              </button>
            </div>
          </section>
        `;

        root
          .querySelector("#quickCancelSearch")
          ?.addEventListener("click", () => {
            root.querySelector("#lobbyV5Leave")?.click();
          });
      }
    }

    applyReadyState(root);
  }

  socket.on("quick:ready-state", payload => {
    readyByPlayerId.clear();

    for (const player of payload?.players || []) {
      if (!player?.playerId) continue;

      readyByPlayerId.set(
        String(player.playerId),
        player.ready === true
      );
    }

    quickStarting = payload?.starting === true;
    scheduleEnhance();
  });

  socket.on("quick:error", payload => {
    quickStarting = false;

    if (payload?.error) {
      toast(payload.error);
    }

    scheduleEnhance();
  });

  function startRuntime() {
    document.addEventListener(
      "ptitbac:screen-rendered",
      scheduleEnhance
    );
    document.addEventListener(
      "ptitbac:dom-updated",
      scheduleEnhance
    );

    try {
      socket?.on?.("room:state", scheduleEnhance);
    } catch {}

    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      startRuntime,
      { once: true }
    );
  } else {
    startRuntime();
  }
})();

/* =========================================================
   P'tit Bac — Partie rapide : relances lettre / catégories
   Absorbé depuis l'ancien avatar-pages-fix-v1.js.
   ========================================================= */
(() => {
  "use strict";

  const QUICK_REROLL_FALLBACK_COST = 20;
  let scheduled = false;

  function liveSession() {
    try {
      if (typeof session !== "undefined" && session) return session;
    } catch {}
    return null;
  }

  function stateNow() {
    return liveSession()?.state || null;
  }

  function playerIdNow() {
    return String(liveSession()?.playerId || "");
  }

  function coinBalance() {
    try {
      return typeof getCoins === "function" ? Number(getCoins()) : Infinity;
    } catch {
      return Infinity;
    }
  }

  function showToast(message) {
    try {
      if (typeof toast === "function") return toast(message);
    } catch {}
  }

  function costFromState(kind) {
    const state = stateNow();
    const value = kind === "letter"
      ? Number(state?.letterRerollCost)
      : Number(state?.categoryRerollCost);

    return Number.isFinite(value) && value > 0
      ? value
      : QUICK_REROLL_FALLBACK_COST;
  }

  function setCoinCostMarkup(button, cost) {
    if (!button) return;

    const coin = button.querySelector("b");
    if (coin) {
      coin.innerHTML = `<img src="/coin.png" alt="">${cost}`;
      return;
    }

    button.insertAdjacentHTML(
      "beforeend",
      `<b><img src="/coin.png" alt="">${cost}</b>`
    );
  }

  function bindQuickLetterReroll(button) {
    if (!button || button.dataset.ptbQuickRerollBound === "1") return;
    button.dataset.ptbQuickRerollBound = "1";

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const state = stateNow();
      const playerId = playerIdNow();
      const cost = costFromState("letter");

      if (
        !state ||
        state.mode !== "quick" ||
        String(state.letterChooserPlayerId || "") !== playerId ||
        !state.pendingLetter
      ) {
        return;
      }

      if (coinBalance() < cost) {
        return showToast(`Il te faut ${cost} pièces pour relancer.`);
      }

      if (!socket?.connected) {
        return showToast("Connexion interrompue. Attends la reconnexion.");
      }

      const requestedVersion = Number(state.letterSpinVersion || 0);
      const requestedLetter = String(state.pendingLetter || "").slice(0, 1);

      button.disabled = true;
      const confirm = document.getElementById("pbw1Confirm");
      if (confirm) confirm.disabled = true;

      socket.emit(
        "game:rerollLetter",
        {
          code: state.code,
          playerId
        }
      );

      setTimeout(() => {
        const current = stateNow();
        const stillSameLetter =
          current?.phase === "letter_selection" &&
          current?.mode === "quick" &&
          String(current?.letterChooserPlayerId || "") === playerId &&
          Number(current?.letterSpinVersion || 0) === requestedVersion &&
          String(current?.pendingLetter || "").slice(0, 1) === requestedLetter;

        if (socket?.connected && button.isConnected && stillSameLetter) {
          button.disabled = coinBalance() < cost;
          if (confirm?.isConnected) confirm.disabled = false;
          showToast("La relance de la lettre n’a pas été confirmée. Réessaie.");
        }
      }, 8000);
    });
  }

  function ensureQuickLetterReroll() {
    const state = stateNow();
    const playerId = playerIdNow();

    if (
      !state ||
      state.mode !== "quick" ||
      String(state.letterChooserPlayerId || "") !== playerId ||
      !state.pendingLetter ||
      !document.querySelector(".pbw1-screen")
    ) {
      return;
    }

    const actions = document.querySelector(".pbw1-screen .pbw1-actions");
    if (!actions) return;

    const cost = costFromState("letter");
    let button = document.getElementById("pbw1Reroll");

    if (!button) {
      button = document.createElement("button");
      button.className = "pbw1-reroll ptb-quick-reroll-restored";
      button.id = "pbw1Reroll";
      button.type = "button";
      button.innerHTML = `
        <span>↻ Relancer</span>
        <b><img src="/coin.png" alt="">${cost}</b>
      `;

      const confirm = document.getElementById("pbw1Confirm");
      actions.insertBefore(button, confirm || actions.firstChild);
    }

    setCoinCostMarkup(button, cost);
    button.disabled = coinBalance() < cost;
    bindQuickLetterReroll(button);
  }

  function bindQuickCategoryControls(reroll, confirm) {
    if (
      reroll &&
      reroll.dataset.ptbQuickCreated === "1" &&
      reroll.dataset.ptbQuickRerollBound !== "1"
    ) {
      reroll.dataset.ptbQuickRerollBound = "1";
      reroll.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const current = stateNow();
        const cost = costFromState("category");

        if (
          !current ||
          current.mode !== "quick" ||
          String(current.categoryChooserPlayerId || "") !== playerIdNow()
        ) {
          return;
        }

        if (coinBalance() < cost) {
          return showToast(`Il te faut ${cost} pièces pour relancer le tirage.`);
        }

        if (!socket?.connected) {
          return showToast("Connexion interrompue. Attends la reconnexion.");
        }

        const originalCategories =
          JSON.stringify(Array.isArray(current.categories) ? current.categories : []);

        reroll.disabled = true;
        reroll.classList.add("is-loading");
        if (confirm) confirm.disabled = true;

        socket.emit(
          "game:rerollCategories",
          {
            code: current.code,
            playerId: playerIdNow()
          }
        );

        setTimeout(() => {
          const latest = stateNow();
          const stillSameDraw =
            latest?.phase === "category_selection" &&
            latest?.mode === "quick" &&
            String(latest?.categoryChooserPlayerId || "") === playerIdNow() &&
            JSON.stringify(
              Array.isArray(latest?.categories) ? latest.categories : []
            ) === originalCategories;

          if (socket?.connected && reroll.isConnected && stillSameDraw) {
            reroll.disabled = coinBalance() < cost;
            reroll.classList.remove("is-loading");
            if (confirm?.isConnected) confirm.disabled = false;
            showToast("La relance des catégories n’a pas été confirmée. Réessaie.");
          }
        }, 8000);
      });
    }

    if (confirm && confirm.dataset.ptbQuickConfirmBound !== "1") {
      confirm.dataset.ptbQuickConfirmBound = "1";
      confirm.addEventListener("click", event => {
        if (confirm.dataset.ptbQuickCreated !== "1") return;

        event.preventDefault();
        event.stopPropagation();

        const current = stateNow();
        if (
          !current ||
          current.mode !== "quick" ||
          String(current.categoryChooserPlayerId || "") !== playerIdNow()
        ) {
          return;
        }

        if (!socket?.connected) {
          return showToast("Connexion interrompue. Attends la reconnexion.");
        }

        confirm.disabled = true;
        if (reroll) reroll.disabled = true;

        socket.emit(
          "game:confirmCategories",
          {
            code: current.code,
            playerId: playerIdNow()
          }
        );

        setTimeout(() => {
          const latest = stateNow();
          const stillChoosing =
            latest?.phase === "category_selection" &&
            latest?.mode === "quick" &&
            String(latest?.categoryChooserPlayerId || "") === playerIdNow();

          if (socket?.connected && confirm.isConnected && stillChoosing) {
            confirm.disabled = false;
            if (reroll?.isConnected) {
              reroll.disabled = coinBalance() < costFromState("category");
              reroll.classList.remove("is-loading");
            }
            showToast("Le passage à la lettre n’a pas été confirmé. Réessaie.");
          }
        }, 8000);
      }, true);
    }
  }

  function ensureQuickCategoryReroll() {
    const state = stateNow();
    const playerId = playerIdNow();
    const root = document.querySelector(".cat-v2");

    if (
      !root ||
      !state ||
      state.mode !== "quick" ||
      String(state.categoryChooserPlayerId || "") !== playerId
    ) {
      return;
    }

    const cost = costFromState("category");
    let actions = root.querySelector(".cat-v2-actions");
    let reroll = document.getElementById("rerollCategoriesBtn");
    let confirm = document.getElementById("confirmCategoriesBtn");

    if (!actions) {
      const wait = root.querySelector(".cat-v2-wait");
      actions = document.createElement("section");
      actions.className =
        "category-pick-actions cat-v2-actions ptb-quick-actions-restored";
      actions.innerHTML = `
        <button class="category-reroll-btn cat-v2-reroll"
                id="rerollCategoriesBtn"
                type="button"
                data-ptb-quick-created="1">
          <span class="cat-v2-reroll-title">
            <b class="cat-v2-reroll-icon">↻</b>
            Relancer le tirage
          </span>
          <span class="cat-v2-coin-pill cat-v2-cost">
            <img src="/coin.png" alt="">
            <strong>${cost}</strong>
          </span>
          <small>Obtenez de nouvelles catégories aléatoires.</small>
        </button>
        <button class="btn btn-primary category-confirm-btn cat-v2-confirm"
                id="confirmCategoriesBtn"
                type="button"
                data-ptb-quick-created="1">
          Continuer vers la lettre <span>→</span>
        </button>
      `;

      if (wait) wait.replaceWith(actions);
      else root.appendChild(actions);

      reroll = document.getElementById("rerollCategoriesBtn");
      confirm = document.getElementById("confirmCategoriesBtn");
      if (confirm) confirm.dataset.ptbQuickCreated = "1";
    }

    if (reroll) {
      const costStrong = reroll.querySelector(".cat-v2-cost strong");
      if (costStrong) costStrong.textContent = String(cost);
      reroll.disabled = coinBalance() < cost;
    }

    bindQuickCategoryControls(reroll, confirm);
  }

  function enhance() {
    scheduled = false;
    ensureQuickLetterReroll();
    ensureQuickCategoryReroll();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhance);
  }

  function start() {
    document.addEventListener("ptitbac:screen-rendered", schedule);

    try {
      socket?.on?.("room:state", schedule);
      socket?.on?.("wallet:update", schedule);
    } catch {}

    schedule();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
