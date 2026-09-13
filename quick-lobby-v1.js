(() => {
  "use strict";

  let quickReady = false;
  let observer = null;
  let scheduled = false;

  function localPlayerId() {
    try {
      return String(session?.playerId || "");
    } catch {
      return "";
    }
  }

  function setQuickPlayerStatus(row, ready) {
    if (!row) return;

    const status = row.querySelector(".ready-badge, .offline-badge, .quick-player-state");
    if (!status) return;

    status.classList.remove("ready-badge", "offline-badge", "is-ready", "is-waiting");
    status.classList.add("quick-player-state", ready ? "is-ready" : "is-waiting");
    status.textContent = ready ? "● Prêt" : "En attente…";
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
    if (!root || root.dataset.quickLobbyEnhanced === "1") return;

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

    // En partie rapide les paramètres sont informatifs uniquement.
    root.querySelector(".lobby-v5-settings-shortcut")?.remove();

    const list = root.querySelector(".lobby-v5-player-list");

    if (list) {
      const currentRows = [...list.querySelectorAll(".lobby-v5-player")];
      const myId = localPlayerId();

      // Un joueur connecté n'est pas automatiquement "prêt".
      // Tant qu'il n'a pas appuyé sur le bouton, son état visuel est en attente.
      currentRows.forEach(row => {
        row.querySelector(".host-badge")?.remove();

        const isMe =
          !!myId &&
          String(row.dataset.lobbyPlayerProfile || "") === myId;

        setQuickPlayerStatus(row, isMe ? quickReady : false);
      });

      // Toujours afficher les 6 emplacements du matchmaking.
      const count = currentRows.length;
      list.querySelectorAll(".lobby-v5-empty-player").forEach(el => el.remove());

      for (let i = count; i < 6; i++) {
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

      // Ligne du joueur local.
      // Le fallback sur la première ligne garde le comportement fonctionnel
      // si un ancien état client ne contient pas encore l'identifiant.
      const meRow =
        currentRows.find(
          row => String(row.dataset.lobbyPlayerProfile || "") === myId
        ) || currentRows[0];

      if (meRow) {
        meRow.classList.add("quick-self-row");
        setQuickPlayerStatus(meRow, quickReady);
      }

      if (meRow && !meRow.querySelector(".quick-ready-btn")) {
        meRow.insertAdjacentHTML(
          "beforeend",
          `
            <button
              class="quick-ready-btn ${quickReady ? "is-ready" : ""}"
              type="button"
              aria-pressed="${quickReady ? "true" : "false"}"
            >
              <span>${quickReady ? "✓" : ""}</span>
              <strong>${quickReady ? "PRÊT" : "PRÊT ?"}</strong>
            </button>
          `
        );

        meRow.querySelector(".quick-ready-btn")?.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();

          quickReady = !quickReady;

          const button = event.currentTarget;
          button.classList.toggle("is-ready", quickReady);
          button.setAttribute("aria-pressed", quickReady ? "true" : "false");
          button.querySelector("span").textContent = quickReady ? "✓" : "";
          button.querySelector("strong").textContent = quickReady ? "PRÊT" : "PRÊT ?";

          setQuickPlayerStatus(meRow, quickReady);

          // Pour le moment ce bouton reste un état visuel local.
          // La synchronisation réelle "prêt/pas prêt" avec le matchmaking
          // pourra ensuite être ajoutée côté serveur.
        });
      }
    }

    // Remplace les actions privées par le panneau de recherche rapide.
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

            <button id="quickCancelSearch" class="quick-cancel-search" type="button">
              <b>×</b>
              <span>Annuler la recherche</span>
            </button>
          </div>
        </section>
      `;

      root.querySelector("#quickCancelSearch")?.addEventListener("click", () => {
        root.querySelector("#lobbyV5Leave")?.click();
      });
    }
  }

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
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();
