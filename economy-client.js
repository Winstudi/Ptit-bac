(() => {
  "use strict";

  // Une seule connexion Socket.IO pour toute l'application.
  const ecoSocket = socket;
  const eco = {
    coins: Number(localStorage.getItem("petitbac_walletBalance") || 0),
    gems: 0,
    lives: 5,
    maxLives: 5,
    nextLifeAt: null,
    secondsToNext: 0,
    rewardedAdCoins: 80
  };

  let refreshing = false;
  let warmTimer = null;

  function walletToken() {
    return localStorage.getItem("petitbac_walletToken") || "";
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function ensureHud() {
    let el = document.getElementById("economyHud");
    if (el) return el;

    el = document.createElement("div");
    el.id = "economyHud";
    el.className = "economy-hud";
    document.body.appendChild(el);
    return el;
  }

  function renderHud() {
    const waiting = eco.lives < eco.maxLives;

    ensureHud().innerHTML = `
      <div class="economy-pill coins">🪙 <b>${Math.max(0, Number(eco.coins) || 0)}</b></div>
      <div class="economy-pill life">
        <span class="economy-heart">♥</span>
        <b>${Math.max(0, Number(eco.lives) || 0)}/${Math.max(1, Number(eco.maxLives) || 5)}</b>
        ${waiting ? `<small>${fmt(eco.secondsToNext)}</small>` : ""}
      </div>`;
  }

  function renderEconomyUI() {
    renderHud();
    document.dispatchEvent(new CustomEvent("ptitbac:economy-changed", {
      detail: { ...eco }
    }));
  }

  function requestState() {
    const token = walletToken();
    if (!token || !ecoSocket.connected || refreshing) return;

    refreshing = true;
    ecoSocket.timeout(8000).emit("economy:get", { walletToken: token }, (err, res) => {
      refreshing = false;
      if (err || !res?.ok) return;
      Object.assign(eco, res);
      renderEconomyUI();
    });
  }

  function warm(attempt = 0) {
    clearTimeout(warmTimer);

    if (walletToken() && ecoSocket.connected) {
      requestState();
      return;
    }

    if (attempt < 20) {
      warmTimer = setTimeout(() => warm(attempt + 1), 250);
    }
  }

  ecoSocket.on("connect", () => warm(0));

  ecoSocket.on("economy:update", value => {
    if (!value) return;
    Object.assign(eco, value);
    renderEconomyUI();
  });

  ecoSocket.on("wallet:update", ({ balance } = {}) => {
    if (!Number.isFinite(Number(balance))) return;
    eco.coins = Math.max(0, Math.floor(Number(balance)));
    localStorage.setItem("petitbac_walletBalance", String(eco.coins));
    renderEconomyUI();
  });

  // Filet de sécurité : l'accueil ne doit jamais rester bloqué sur "Chargement".
  setTimeout(() => {
    const app = document.getElementById("app");
    if (
      app &&
      (!app.children.length || app.querySelector('[role="status"]')) &&
      typeof window.renderHome === "function"
    ) {
      try {
        window.renderHome();
      } catch (err) {
        console.warn("Affichage accueil de secours:", err?.message || err);
      }
    }
  }, 1200);

  setInterval(() => {
    if (eco.lives >= eco.maxLives || !eco.nextLifeAt) return;

    eco.secondsToNext = Math.max(
      0,
      Math.ceil((Number(eco.nextLifeAt) - Date.now()) / 1000)
    );

    if (eco.secondsToNext <= 0) requestState();
    else renderHud();
  }, 1000);

  setInterval(requestState, 60000);

  window.PtitBacEconomy = {
    refresh: requestState,
    state: () => ({ ...eco }),
    rewardedAdCoins: 80,
    rules: Object.freeze({
      public: { lifeCost: 1, rewards: true, xp: true },
      quick: { lifeCost: 1, rewards: true, xp: true },
      private: { lifeCost: 0, rewards: false, xp: false }
    })
  };

  renderHud();
  warm(0);
})();
