(() => {
  "use strict";

  const originalRenderCategorySelection =
    typeof renderCategorySelection === "function" ? renderCategorySelection : null;

  let categoryExitMenuOpen = false;
  let pendingCategoryReroll = null;

  function categoryRequestId(prefix = "category") {
    try {
      if (globalThis.crypto?.randomUUID) {
        return `${prefix}:${globalThis.crypto.randomUUID()}`;
      }
    } catch {}
    return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  }

  function ptitBacImageAvatar(value) {
    return typeof value === "string" &&
      /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
  }

  // Les écrans historiques du jeu utilisaient avatarMarkup(),
  // qui affichait une data URL comme du texte. On le remplace pour
  // que TOUS les joueurs voient aussi les photos importées.
  function ptitBacSharedAvatarMarkup(player, index = 0, extra = "") {
    const raw = String(player?.avatar || "");
    const safeExtra = String(extra || "").replace(/[^a-zA-Z0-9 _-]/g, "");

    if (ptitBacImageAvatar(raw)) {
      return `
        <div class="avatar avatar-${index % 6} ptb-avatar-photo ${safeExtra}">
          <img src="${raw}" alt="" draggable="false">
        </div>`;
    }

    const value = raw || String(player?.name || "?").charAt(0).toUpperCase();
    return `
      <div class="avatar avatar-${index % 6} ${raw ? "avatar-emoji" : ""} ${safeExtra}">
        ${escapeHtml(value)}
      </div>`;
  }

  window.avatarMarkup = ptitBacSharedAvatarMarkup;
  try { avatarMarkup = ptitBacSharedAvatarMarkup; } catch {}

  function renderForfeitWinScreen(payload = {}) {
    if (Number.isFinite(Number(payload.balance))) {
      setWalletState(session.walletToken, Number(payload.balance));
    }

    const reward = Math.max(0, Math.floor(Number(payload.reward || 0)));
    const quitterName = String(payload.quitterName || "L’autre joueur");
    const winnerName = String(payload.winnerName || getProfile()?.name || "Joueur");

    categoryExitMenuOpen = false;
    clearSession();

    setScreen(`
      <main class="screen ptb-forfeit-screen">
        <section class="ptb-forfeit-card">
          <div class="ptb-forfeit-trophy">🏆</div>
          <small>PARTIE TERMINÉE</small>
          <h1>Victoire par forfait</h1>
          <p><strong>${escapeHtml(quitterName)}</strong> a quitté la partie.</p>
          <div class="ptb-forfeit-winner">${escapeHtml(winnerName)} remporte la partie</div>

          ${reward > 0 ? `
            <div class="ptb-forfeit-reward">
              <img src="/coin.png" alt="">
              <strong>+${reward}</strong>
              <span>pièces</span>
            </div>
          ` : ""}

          <button id="forfeitHomeBtn" type="button">Retour à l’accueil</button>
        </section>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>
      </main>
    `);

    document.getElementById("forfeitHomeBtn")?.addEventListener("click", () => {
      renderHome();
    });
  }

  socket.on("room:closed", payload => {
    if (!payload || payload.reason !== "forfeit_win") return;
    renderForfeitWinScreen(payload);
  });

  function categoryDecorLetters() {
    return "";
  }

  function categoryExitMenu() {
    if (!categoryExitMenuOpen) return "";

    return `
      <div class="cat-v2-exit-backdrop" id="categoryExitBackdrop">
        <section class="cat-v2-exit-modal" role="dialog" aria-modal="true" aria-labelledby="categoryExitTitle">
          <h2 id="categoryExitTitle">Voulez-vous quitter la partie ?</h2>

          <div class="cat-v2-exit-actions">
            <button id="categoryExitNo" class="cat-v2-exit-no" type="button">
              Non
            </button>

            ${me()?.isHost && Number(session.state?.roundIndex ?? -1) < 0 && session.state?.mode !== "quick" ? `<button id="categoryExitLobby" class="cat-v2-exit-lobby" type="button">
              Revenir au salon
            </button>` : ""}

            <button id="categoryExitHome" class="cat-v2-exit-home" type="button">
              Revenir à l’accueil
            </button>
          </div>
        </section>
      </div>`;
  }

  function categoryCoinPill(value, extra = "") {
    return `
      <span class="cat-v2-coin-pill ${extra}">
        <img src="/coin.png" alt="">
        <strong>${Number(value || 0)}</strong>
      </span>
    `;
  }

  function categoryCard(category, index) {
    return `
      <article class="category-pick-card cat-v2-card" style="--pick-index:${index}">
        <span class="category-pick-icon cat-v2-icon">${categoryIcon(category)}</span>
        <strong>${escapeHtml(category)}</strong>
      </article>
    `;
  }

  let lastDraw = "";
  function renderCategorySelectionV2() {
    if (!session?.state) {
      if (originalRenderCategorySelection) return originalRenderCategorySelection();
      return;
    }

    clearInterval(session.timerHandle);

    const state = session.state;
    session.localAnswers = {};
    const user = me();
    const categories = Array.isArray(state.categories) ? state.categories : [];
    const categoryRerollCost = Number(state.categoryRerollCost || 20);
    const balance = getCoins();
    const chooser = state.players.find(p => p.id === state.categoryChooserPlayerId);
    const host = !!user && user.id === state.categoryChooserPlayerId;
    const insufficient = balance < categoryRerollCost;
    const missingCoins = Math.max(0, categoryRerollCost - balance);
    const drawKey = JSON.stringify([state.code, state.gameSessionId, state.roundIndex, categories]);
    if (pendingCategoryReroll?.drawKey !== drawKey) {
      pendingCategoryReroll = null;
    }
    const reveal = drawKey !== lastDraw;
    lastDraw = drawKey;
    const categoryCountClass =
      categories.length >= 9 ? "cat-v2-many" :
      categories.length >= 7 ? "cat-v2-medium" : "cat-v2-normal";

    setScreen(`
      <main class="screen category-pick-screen cat-v2 cat-prototype ${categoryCountClass} ${reveal ? "cat-reveal" : ""}">
        <div class="cat-v2-glow glow-a"></div>
        <div class="cat-v2-glow glow-b"></div>
        ${categoryDecorLetters()}

        <header class="category-pick-header cat-v2-top">
          ${user
            ? `<button class="pregame-return-btn cat-v2-back" id="returnLobbyCategoriesBtn" type="button" aria-label="Retour au salon">
                <img src="/lobby-exit.png" alt="">
              </button>`
            : `<span class="pregame-return-spacer cat-v2-back-spacer"></span>`}

          <img class="cat-brand" src="/ptitbac.logo.png" alt="P’tit Bac" width="62" height="52">
          ${categoryCoinPill(balance, "cat-v2-balance")}
        </header>

        <nav class="cat-steps" aria-label="Étapes de préparation">
          <span aria-current="step">Catégories</span><i aria-hidden="true">•</i>
          <span>Lettre</span><i aria-hidden="true">•</i><span>À vous de jouer</span>
        </nav>
        <section class="category-pick-copy cat-v2-copy">
          <h1>Votre tirage !</h1>
          <p>${categories.length} catégories <b>•</b> Niveau ${difficultyLabel(state.categoryDifficulty)}</p>
          <p class="cat-chooser" role="status">${host ? "C’est à toi de choisir !" : chooser ? "C’est à " + escapeHtml(chooser.name) + " de choisir." : "En attente d’un joueur connecté…"}</p>
        </section>

        <section class="category-pick-grid cat-v2-grid" aria-label="Catégories tirées">
          ${categories.map(categoryCard).join("")}
        </section>

        ${host ? `
          <section class="category-pick-actions cat-v2-actions">
            <button class="category-reroll-btn cat-v2-reroll" id="rerollCategoriesBtn" type="button" ${insufficient ? "disabled" : ""}>
              <span class="cat-v2-reroll-title">
                <b class="cat-v2-reroll-icon">↻</b>
                Relancer le tirage
              </span>
              ${categoryCoinPill(categoryRerollCost, "cat-v2-cost")}
              <small>Obtenez ${categories.length} nouvelles catégories aléatoires.</small>
            </button>

            ${insufficient
              ? `<p class="letter-cost-note cat-v2-cost-note">
                  Il te manque ${missingCoins} pièce${missingCoins > 1 ? "s" : ""} pour relancer le tirage.
                </p>`
              : ""}

            <button class="btn btn-primary category-confirm-btn cat-v2-confirm" id="confirmCategoriesBtn" type="button">
              Continuer vers la lettre <span>→</span>
            </button>
          </section>
        ` : `
          <section class="cat-v2-wait">
            <span class="spinner small-spinner"></span>
            <strong>${chooser ? "En attente de " + escapeHtml(chooser.name) + "…" : "En attente d’un joueur…"}</strong>
            <small>Le joueur désigné valide le tirage avant la lettre.</small>
          </section>
        `}

        ${categoryExitMenu()}
      </main>
    `);

    const backBtn = document.getElementById("returnLobbyCategoriesBtn");
    if (backBtn) {
      backBtn.onclick = () => {
        categoryExitMenuOpen = true;
        renderCategorySelectionV2();
      };
    }

    const closeExitMenu = () => {
      categoryExitMenuOpen = false;
      renderCategorySelectionV2();
    };

    document.getElementById("categoryExitNo")?.addEventListener("click", closeExitMenu);

    document.getElementById("categoryExitBackdrop")?.addEventListener("click", event => {
      if (event.target.id === "categoryExitBackdrop") closeExitMenu();
    });

    document.getElementById("categoryExitLobby")?.addEventListener("click", () => {
      const buttons = document.querySelectorAll(".cat-v2-exit-actions button");
      buttons.forEach(button => { button.disabled = true; });

      if (!socket.connected) {
        buttons.forEach(button => { button.disabled = false; });
        categoryExitMenuOpen = true;
        return toast("Connexion interrompue. Attends la reconnexion.");
      }

      categoryExitMenuOpen = false;

      socket.emit(
        "game:returnLobby",
        {
          code: state.code,
          playerId: session.playerId
        }
      );

      setTimeout(() => {
        const current = session.state;
        const stillInPreparation =
          current?.phase === "category_selection" &&
          String(current?.code || "") === String(state.code || "");

        if (socket.connected && stillInPreparation) {
          buttons.forEach(button => { button.disabled = false; });
          categoryExitMenuOpen = true;
          toast("Le retour au salon n’a pas été confirmé. Réessaie.");
        }
      }, 8000);
    });

    document.getElementById("categoryExitHome")?.addEventListener("click", () => {
      const buttons = document.querySelectorAll(".cat-v2-exit-actions button");
      buttons.forEach(button => { button.disabled = true; });

      socket.emit("game:leave", {
        code: state.code,
        playerId: session.playerId
      }, res => {
        if (!res?.ok) {
          buttons.forEach(button => { button.disabled = false; });
          return toast(res?.error || "Impossible de quitter la partie.");
        }

        categoryExitMenuOpen = false;
        clearSession();

        if (typeof initWallet === "function") {
          initWallet(() => {
            renderHome();
            if (res?.message) toast(res.message);
          });
        } else {
          renderHome();
          if (res?.message) toast(res.message);
        }
      });
    });

    if (host) {
      const rerollBtn = document.getElementById("rerollCategoriesBtn");
      const confirmBtn = document.getElementById("confirmCategoriesBtn");

      if (rerollBtn) {
        rerollBtn.onclick = () => {
          if (rerollBtn.disabled) return;
          if (!socket.connected) {
            return toast("Connexion interrompue. Attends la reconnexion.");
          }

          const requestedDrawKey = drawKey;
          const requestId =
            pendingCategoryReroll?.drawKey === requestedDrawKey
              ? pendingCategoryReroll.requestId
              : categoryRequestId("category-reroll");
          pendingCategoryReroll = { drawKey: requestedDrawKey, requestId };

          rerollBtn.classList.add("is-loading");
          rerollBtn.disabled = true;
          if (confirmBtn) confirmBtn.disabled = true;

          socket.emit(
            "game:rerollCategories",
            {
              code: state.code,
              playerId: session.playerId,
              requestId
            }
          );

          setTimeout(() => {
            const current = session.state;
            const currentDrawKey = current
              ? JSON.stringify([
                  current.code,
                  current.gameSessionId,
                  current.roundIndex,
                  Array.isArray(current.categories) ? current.categories : []
                ])
              : "";

            const stillSameDraw =
              current?.phase === "category_selection" &&
              String(current?.categoryChooserPlayerId || "") ===
                String(session.playerId || "") &&
              currentDrawKey === requestedDrawKey;

            if (socket.connected && rerollBtn.isConnected && stillSameDraw) {
              rerollBtn.classList.remove("is-loading");
              rerollBtn.disabled = getCoins() < categoryRerollCost;
              if (confirmBtn?.isConnected) confirmBtn.disabled = false;
              toast("La relance n’a pas été confirmée. Réessaie.");
            }
          }, 8000);
        };
      }

      if (confirmBtn) {
        confirmBtn.onclick = () => {
          if (!socket.connected) {
            return toast("Connexion interrompue. Attends la reconnexion.");
          }

          confirmBtn.disabled = true;
          if (rerollBtn) rerollBtn.disabled = true;

          socket.emit(
            "game:confirmCategories",
            {
              code: state.code,
              playerId: session.playerId
            }
          );

          setTimeout(() => {
            const current = session.state;
            const stillChoosingCategories =
              current?.phase === "category_selection" &&
              String(current?.categoryChooserPlayerId || "") ===
                String(session.playerId || "");

            if (
              socket.connected &&
              confirmBtn.isConnected &&
              stillChoosingCategories
            ) {
              confirmBtn.disabled = false;
              if (rerollBtn?.isConnected) {
                rerollBtn.disabled = getCoins() < categoryRerollCost;
                rerollBtn.classList.remove("is-loading");
              }
              toast("Le passage à la lettre n’a pas été confirmé. Réessaie.");
            }
          }, 8000);
        };
      }
    }
  }

  // Remplace uniquement l'écran de sélection des catégories.
  // Le reste de la logique de partie reste dans app.js.
  window.renderCategorySelection = renderCategorySelectionV2;

  // Dans les scripts classiques, le binding global et window partagent la fonction.
  // Cette affectation couvre aussi les navigateurs qui gardent la référence globale.
  try {
    renderCategorySelection = renderCategorySelectionV2;
  } catch (_) {}
})();