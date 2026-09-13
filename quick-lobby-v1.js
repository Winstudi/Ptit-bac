(() => {
  "use strict";

  let observer = null;
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

      if (title) {
        title.querySelector(".lobby-v5-code")?.remove();

        if (!title.querySelector(".quick-lobby-subtitle")) {
          title.insertAdjacentHTML(
            "beforeend",
            '<div class="quick-lobby-subtitle">Partie rapide</div>'
          );
        }
      }

      // Partie rapide : paramètres seulement informatifs.
      root.querySelector(".lobby-v5-settings-shortcut")?.remove();

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

        // Toujours six emplacements visibles.
        const count = currentRows.length;

        list.querySelectorAll(".lobby-v5-empty-player").forEach(el => {
          el.remove();
        });

        for (let index = count; index < 6; index += 1) {
          list.insertAdjacentHTML(
            "beforeend",
            `
              <div class="lobby-v5-empty-player readonly quick-empty-player">
                <span class="lobby-v5-empty-plus">＋</span>
                <span>En attente d’un joueur…</span>
                <span class="quick-slot-dots">•••</span>
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

  function startObserver() {
    observer?.disconnect();

    observer = new MutationObserver(scheduleEnhance);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      startObserver,
      { once: true }
    );
  } else {
    startObserver();
  }
})();
