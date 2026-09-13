(() => {
  "use strict";

  let quickReady = false;
  let observer = null;
  let scheduled = false;

  function isQuickLobby() {
    return !!document.querySelector(".lobby-v5[data-mode='quick']");
  }

  function avatarMarkupFromExisting(row) {
    const avatar = row?.querySelector(".lobby-v5-avatar");
    return avatar ? avatar.outerHTML : "";
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
      const code = title.querySelector(".lobby-v5-code");
      if (code) code.remove();
      if (!title.querySelector(".quick-lobby-subtitle")) {
        title.insertAdjacentHTML("beforeend", '<div class="quick-lobby-subtitle">Partie rapide</div>');
      }
    }

    // Partie rapide : paramètres uniquement informatifs, jamais modifiables.
    root.querySelector(".lobby-v5-settings-shortcut")?.remove();

    const playersSection = root.querySelector(".lobby-v5-players-section");
    const list = root.querySelector(".lobby-v5-player-list");
    if (playersSection && list) {
      const currentRows = [...list.querySelectorAll(".lobby-v5-player")];

      // Le salon rapide n'affiche jamais la notion d'hôte.
      currentRows.forEach(row => {
        row.querySelector(".host-badge")?.remove();
        const ready = row.querySelector(".ready-badge");
        if (ready) ready.textContent = "● Prêt";
      });

      // Affiche toujours les 6 emplacements du matchmaking.
      const count = currentRows.length;
      list.querySelectorAll(".lobby-v5-empty-player").forEach(el => el.remove());
      for (let i = count; i < 6; i++) {
        list.insertAdjacentHTML("beforeend", `
          <div class="lobby-v5-empty-player readonly quick-empty-player">
            <span class="lobby-v5-empty-plus">＋</span>
            <span>En attente d’un joueur…</span>
            <span class="quick-slot-dots">•••</span>
          </div>
        `);
      }

      // Bouton prêt sur la ligne du joueur local.
      const meRow = currentRows.find(row =>
        String(row.dataset.lobbyPlayerProfile || "") === String(window.session?.playerId || "")
      ) || currentRows[0];

      if (meRow && !meRow.querySelector(".quick-ready-btn")) {
        meRow.insertAdjacentHTML("beforeend", `
          <button class="quick-ready-btn ${quickReady ? "is-ready" : ""}" type="button">
            <span>${quickReady ? "✓" : ""}</span>
            <strong>${quickReady ? "PRÊT" : "PRÊT ?"}</strong>
          </button>
        `);

        meRow.querySelector(".quick-ready-btn")?.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          quickReady = !quickReady;
          const btn = event.currentTarget;
          btn.classList.toggle("is-ready", quickReady);
          btn.querySelector("span").textContent = quickReady ? "✓" : "";
          btn.querySelector("strong").textContent = quickReady ? "PRÊT" : "PRÊT ?";

          const badge = meRow.querySelector(".ready-badge");
          if (badge) badge.textContent = quickReady ? "● Prêt" : "○ Pas prêt";

          // Le matchmaking actuel reste géré par le serveur existant :
          // aucun événement de salon privé n'est envoyé ici.
        });
      }
    }

    // Remplace les actions privées par le panneau de recherche du prototype.
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
            <div class="quick-search-dots"><i></i><i></i><i></i></div>
            <button id="quickCancelSearch" class="quick-cancel-search" type="button">
              <b>×</b><span>Annuler la recherche</span>
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
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();