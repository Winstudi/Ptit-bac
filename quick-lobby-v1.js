(() => {
  "use strict";

  /*
   * CLEAN-01A — Partie Rapide
   *
   * Le rendu du salon Quick n'appartient plus à ce fichier.
   * Il est désormais pris en charge par le lobby V3 commun
   * (lobby-screen-v4.js + ui-runtime-v1.js + private-lobby.css).
   *
   * Ce fichier ne conserve que les fonctions encore spécifiques
   * au déroulement Quick après le lobby :
   * - relance de la lettre ;
   * - relance des catégories ;
   * - confirmation des catégories.
   */

  const QUICK_REROLL_FALLBACK_COST = 20;
  const QUICK_DIFFICULTY_ICON = "/difficulty.png";
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
      return typeof getCoins === "function"
        ? Number(getCoins())
        : Infinity;
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
    const value =
      kind === "letter"
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
    if (
      !button ||
      button.dataset.ptbQuickRerollBound === "1"
    ) {
      return;
    }

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
        return showToast(
          `Il te faut ${cost} pièces pour relancer.`
        );
      }

      if (!socket?.connected) {
        return showToast(
          "Connexion interrompue. Attends la reconnexion."
        );
      }

      const requestedVersion =
        Number(state.letterSpinVersion || 0);

      const requestedLetter =
        String(state.pendingLetter || "").slice(0, 1);

      button.disabled = true;

      const confirm =
        document.getElementById("pbw1Confirm");

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
          String(current?.letterChooserPlayerId || "") ===
            playerId &&
          Number(current?.letterSpinVersion || 0) ===
            requestedVersion &&
          String(current?.pendingLetter || "").slice(0, 1) ===
            requestedLetter;

        if (
          socket?.connected &&
          button.isConnected &&
          stillSameLetter
        ) {
          button.disabled = coinBalance() < cost;

          if (confirm?.isConnected) {
            confirm.disabled = false;
          }

          showToast(
            "La relance de la lettre n’a pas été confirmée. Réessaie."
          );
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

    const actions =
      document.querySelector(".pbw1-screen .pbw1-actions");

    if (!actions) return;

    const cost = costFromState("letter");
    let button =
      document.getElementById("pbw1Reroll");

    if (!button) {
      button = document.createElement("button");
      button.className =
        "pbw1-reroll ptb-quick-reroll-restored";
      button.id = "pbw1Reroll";
      button.type = "button";
      button.innerHTML = `
        <span>↻ Relancer</span>
        <b><img src="/coin.png" alt="">${cost}</b>
      `;

      const confirm =
        document.getElementById("pbw1Confirm");

      actions.insertBefore(
        button,
        confirm || actions.firstChild
      );
    }

    setCoinCostMarkup(button, cost);
    button.disabled = coinBalance() < cost;
    bindQuickLetterReroll(button);
  }

  function bindQuickCategoryControls(
    reroll,
    confirm
  ) {
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
          String(current.categoryChooserPlayerId || "") !==
            playerIdNow()
        ) {
          return;
        }

        if (coinBalance() < cost) {
          return showToast(
            `Il te faut ${cost} pièces pour relancer le tirage.`
          );
        }

        if (!socket?.connected) {
          return showToast(
            "Connexion interrompue. Attends la reconnexion."
          );
        }

        const originalCategories =
          JSON.stringify(
            Array.isArray(current.categories)
              ? current.categories
              : []
          );

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
            String(latest?.categoryChooserPlayerId || "") ===
              playerIdNow() &&
            JSON.stringify(
              Array.isArray(latest?.categories)
                ? latest.categories
                : []
            ) === originalCategories;

          if (
            socket?.connected &&
            reroll.isConnected &&
            stillSameDraw
          ) {
            reroll.disabled = coinBalance() < cost;
            reroll.classList.remove("is-loading");

            if (confirm?.isConnected) {
              confirm.disabled = false;
            }

            showToast(
              "La relance des catégories n’a pas été confirmée. Réessaie."
            );
          }
        }, 8000);
      });
    }

    if (
      confirm &&
      confirm.dataset.ptbQuickConfirmBound !== "1"
    ) {
      confirm.dataset.ptbQuickConfirmBound = "1";

      confirm.addEventListener(
        "click",
        event => {
          if (
            confirm.dataset.ptbQuickCreated !== "1"
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const current = stateNow();

          if (
            !current ||
            current.mode !== "quick" ||
            String(
              current.categoryChooserPlayerId || ""
            ) !== playerIdNow()
          ) {
            return;
          }

          if (!socket?.connected) {
            return showToast(
              "Connexion interrompue. Attends la reconnexion."
            );
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
              String(
                latest?.categoryChooserPlayerId || ""
              ) === playerIdNow();

            if (
              socket?.connected &&
              confirm.isConnected &&
              stillChoosing
            ) {
              confirm.disabled = false;

              if (reroll?.isConnected) {
                reroll.disabled =
                  coinBalance() <
                  costFromState("category");

                reroll.classList.remove("is-loading");
              }

              showToast(
                "Le passage à la lettre n’a pas été confirmé. Réessaie."
              );
            }
          }, 8000);
        },
        true
      );
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
      String(state.categoryChooserPlayerId || "") !==
        playerId
    ) {
      return;
    }

    const cost = costFromState("category");

    let actions =
      root.querySelector(".cat-v2-actions");

    let reroll =
      document.getElementById("rerollCategoriesBtn");

    let confirm =
      document.getElementById("confirmCategoriesBtn");

    if (!actions) {
      const wait =
        root.querySelector(".cat-v2-wait");

      actions = document.createElement("section");
      actions.className =
        "category-pick-actions cat-v2-actions ptb-quick-actions-restored";

      actions.innerHTML = `
        <button
          class="category-reroll-btn cat-v2-reroll"
          id="rerollCategoriesBtn"
          type="button"
          data-ptb-quick-created="1"
        >
          <span class="cat-v2-reroll-title">
            <b class="cat-v2-reroll-icon">↻</b>
            Relancer le tirage
          </span>
          <span class="cat-v2-coin-pill cat-v2-cost">
            <img src="/coin.png" alt="">
            <strong>${cost}</strong>
          </span>
          <small>
            Obtenez de nouvelles catégories aléatoires.
          </small>
        </button>

        <button
          class="btn btn-primary category-confirm-btn cat-v2-confirm"
          id="confirmCategoriesBtn"
          type="button"
          data-ptb-quick-created="1"
        >
          Continuer vers la lettre <span>→</span>
        </button>
      `;

      if (wait) {
        wait.replaceWith(actions);
      } else {
        root.appendChild(actions);
      }

      reroll =
        document.getElementById(
          "rerollCategoriesBtn"
        );

      confirm =
        document.getElementById(
          "confirmCategoriesBtn"
        );

      if (confirm) {
        confirm.dataset.ptbQuickCreated = "1";
      }
    }

    if (reroll) {
      const costStrong =
        reroll.querySelector(
          ".cat-v2-cost strong"
        );

      if (costStrong) {
        costStrong.textContent = String(cost);
      }

      reroll.disabled = coinBalance() < cost;
    }

    bindQuickCategoryControls(
      reroll,
      confirm
    );
  }

  function syncQuickModeClass() {
    let quick = false;

    try {
      quick = stateNow()?.mode === "quick";
    } catch {}

    document.documentElement.classList.toggle("ptb-quick-game", quick);
  }

  function enhance() {
    scheduled = false;
    syncQuickModeClass();
    ensureQuickLetterReroll();
    ensureQuickCategoryReroll();
  }

  /*
   * Nom conservé volontairement pendant Clean-01A :
   * les tests d'architecture existants vérifient encore ce point
   * d'entrée. Il ne redessine plus le lobby ; il programme uniquement
   * les fonctions Quick encore nécessaires après le salon.
   */
  function scheduleEnhance() {
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(enhance);
  }

  function start() {
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

      socket?.on?.(
        "wallet:update",
        scheduleEnhance
      );
    } catch {}

    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once:true }
    );
  } else {
    start();
  }
})();
