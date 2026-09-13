(() => {
  "use strict";

  let homeTimer = null;

  function economyState() {
    try {
      const live = window.PtitBacEconomy?.state?.();
      if (live) return live;
    } catch {}

    return {
      coins: Number(localStorage.getItem("petitbac_walletBalance") || 0),
      lives: 5,
      maxLives: 5,
      secondsToNext: 0,
      gems: 0
    };
  }

  function formatRecharge(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    if (min >= 1) return `${min} min`;
    return `${sec}s`;
  }

  function safeAvatar(value) {
    const avatar = String(value || "").trim();
    if (!avatar || /^data:image\//i.test(avatar) || /^blob:/i.test(avatar)) return "🧠";
    return avatar;
  }

  function refreshHomeResources() {
    const state = economyState();
    const coin = document.getElementById("homePlaqueCoins");
    const lives = document.getElementById("homePlaqueLives");
    const gems = document.getElementById("homeGems");

    if (coin) coin.textContent = String(Math.max(0, Number(state.coins) || 0));
    if (lives) {
      lives.textContent =
        `${Math.max(0, Number(state.lives) || 0)}/${Math.max(1, Number(state.maxLives) || 5)}`;
    }
    if (gems) gems.textContent = String(Math.max(0, Number(state.gems) || 0));

    refreshResourcePopup();

    const quick = document.getElementById("homePlaqueQuick");
    if (quick) {
      const disabled = Number(state.lives) < 1;
      quick.disabled = disabled;
      quick.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
  }

  function closeResourcePopup() {
    document.getElementById("homeResourcePopover")?.remove();
  }

  function resourcePopupContent(type) {
    const state = economyState();
    const coins = Math.max(0, Number(state.coins) || 0);
    const lives = Math.max(0, Number(state.lives) || 0);
    const maxLives = Math.max(1, Number(state.maxLives) || 5);
    const isFull = lives >= maxLives;

    if (type === "coins") {
      return `
        <div class="home-resource-popup-card" role="dialog" aria-label="Mes pièces">
          <strong class="home-resource-popup-value home-resource-popup-coins">
            <img src="/coin.png" alt="">${coins} pièce${coins > 1 ? "s" : ""}
          </strong>
          <button id="homeResourceShop" type="button">Ajouter des pièces</button>
          <button id="homeResourceHistory" type="button">Historique</button>
        </div>`;
    }

    return `
      <div class="home-resource-popup-card" role="dialog" aria-label="Mes vies">
        <strong class="home-resource-popup-value home-resource-popup-lives">
          <img src="/heart.png" alt="">${lives}/${maxLives} vies
        </strong>
        <small>
          ${isFull
            ? "Vies rechargées"
            : `Prochaine vie dans ${formatRecharge(state.secondsToNext)}`}
        </small>
      </div>`;
  }

  function openResourcePopup(type) {
    const current = document.getElementById("homeResourcePopover");

    if (current?.dataset.type === type) {
      current.remove();
      return;
    }

    current?.remove();

    const layer = document.createElement("div");
    layer.id = "homeResourcePopover";
    layer.className = "home-resource-popover";
    layer.dataset.type = type;
    layer.innerHTML = resourcePopupContent(type);

    document.querySelector(".home-mobile")?.appendChild(layer);

    layer.addEventListener("click", event => {
      if (event.target === layer) closeResourcePopup();
    });

    bindResourcePopupActions();
  }

  function bindResourcePopupActions() {
    document.getElementById("homeResourceHistory")?.addEventListener("click", () => {
      closeResourcePopup();
      window.openWalletHistory?.();
    });

    document.getElementById("homeResourceShop")?.addEventListener("click", () => {
      closeResourcePopup();
      renderShop();
    });
  }

  function refreshResourcePopup() {
    const popup = document.getElementById("homeResourcePopover");
    if (!popup) return;

    const oldCard = popup.querySelector(".home-resource-popup-card");
    if (!oldCard) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = resourcePopupContent(popup.dataset.type);
    oldCard.replaceWith(wrapper.firstElementChild);
    bindResourcePopupActions();
  }

  function bindHomeGameActions() {
    const ensureProfile = () => {
      const profile = getProfile();

      if (!String(profile.name || "").trim()) {
        toast("Choisis d’abord ton pseudo.");
        renderProfile();
        return null;
      }

      return {
        ...profile,
        icon: safeAvatar(profile.icon)
      };
    };

    document.getElementById("homePlaqueAvatar")?.addEventListener("click", renderProfile);

    document.getElementById("homePlaqueCoinsBtn")?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("coins");
    });

    document.getElementById("homePlaqueLivesBtn")?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("lives");
    });

    document.getElementById("homePlaqueQuick")?.addEventListener("click", () => {
      const profile = ensureProfile();
      if (!profile) return;

      const eco = economyState();

      if (Number(eco.lives) < 1) {
        return toast(`Plus de vie. Recharge dans ${formatRecharge(eco.secondsToNext)}.`);
      }

      window.startQuickPlay(profile);
    });

    document.getElementById("homePlaqueCreate")?.addEventListener("click", () => {
      const profile = ensureProfile();
      if (!profile) return;

      socket.emit("room:create", {
        name: profile.name.trim(),
        rounds: 1,
        categoryCount: 6,
        categoryDifficulty: "medium",
        duration: 60,
        avatar: profile.icon,
        friendCode: String(localStorage.getItem("petitbac_friendCode") || "").trim(),
        walletToken: session.walletToken
      }, response => {
        if (!response?.ok) {
          return toast(response?.error || "Impossible de créer le salon.");
        }

        if (response.walletToken) {
          setWalletState(response.walletToken, response.balance);
        }

        saveSession(response.code, response.playerId);
        session.state = response.state;
        render();
      });
    });

    const codeInput = document.getElementById("homePlaqueCode");

    if (codeInput) {
      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 5);
      });

      codeInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          document.getElementById("homePlaqueJoin")?.click();
        }
      });
    }

    document.getElementById("homePlaqueJoin")?.addEventListener("click", () => {
      const profile = ensureProfile();
      if (!profile) return;

      const code = String(codeInput?.value || "").trim();

      if (code.length !== 5) {
        return toast("Entre le code à 5 caractères du salon.");
      }

      socket.emit("room:join", {
        code,
        name: profile.name.trim(),
        avatar: profile.icon,
        friendCode: String(localStorage.getItem("petitbac_friendCode") || "").trim(),
        walletToken: session.walletToken
      }, response => {
        if (!response?.ok) {
          return toast(response?.error || "Impossible de rejoindre.");
        }

        if (response.walletToken) {
          setWalletState(response.walletToken, response.balance);
        }

        saveSession(response.code, response.playerId);
        session.state = response.state;
        document.getElementById("homeJoinDialog")?.close();
        render();
      });
    });

    document.getElementById("homePlaqueShop")?.addEventListener("click", renderShop);

    const betaTrigger = document.getElementById("homeBrandLogo");
    let adminTapCount = 0;
    let adminTapTimer = null;

    betaTrigger?.addEventListener("click", () => {
      adminTapCount += 1;
      clearTimeout(adminTapTimer);
      adminTapTimer = setTimeout(() => {
        adminTapCount = 0;
      }, 2200);

      if (adminTapCount >= 7) {
        adminTapCount = 0;
        clearTimeout(adminTapTimer);
        openAdminCoinAccess();
      }
    });
  }

  function lockIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5.5" y="10" width="13" height="10" rx="3"></rect>
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"></path>
      </svg>`;
  }

  function renderPlaquetteHome() {
    if (session.state) return render();

    clearInterval(homeTimer);

    const profile = getProfile();
    const coins = getCoins();
    const eco = economyState();
    const lives = Math.max(0, Number(eco.lives) || 0);
    const maxLives = Math.max(1, Number(eco.maxLives) || 5);
    const avatar = safeAvatar(profile.icon);

    const img = file =>
      `<img src="/${file}.png" alt="" draggable="false">`;

    const side = (id, file, label, soon = false) => `
      <button
        type="button"
        id="${id}"
        ${soon ? `data-soon="${label}"` : ""}
        aria-label="${label}${soon ? ", bientôt disponible" : ""}"
      >
        ${img(file)}
        <b>${label}</b>
      </button>`;

    const milestones = [
      ["coin", "100", "is-active"],
      ["gem", "250", "is-active"],
      ["rewards", "500", ""],
      ["rewards", "750", ""],
      ["rewards", "1000", ""]
    ];

    setScreen(`
      <main class="home-mobile">
        <header class="hm-header">
          <button id="homePlaqueAvatar" class="hm-profile" type="button" aria-label="Mon profil">
            <span class="hm-avatar">${escapeHtml(avatar)}</span>
            <span class="hm-profile-copy">
              <b>${escapeHtml(profile.name || "Mon profil")}</b>
              <small title="Système de niveau à venir">Niv. —</small>
            </span>
          </button>

          <div class="hm-resources" aria-label="Mes ressources">
            <button id="homePlaqueLivesBtn" type="button" aria-label="Mes vies">
              ${img("heart")}
              <b id="homePlaqueLives">${lives}/${maxLives}</b>
              <i aria-hidden="true">+</i>
            </button>

            <button id="homePlaqueCoinsBtn" type="button" aria-label="Mes pièces">
              ${img("coin")}
              <b id="homePlaqueCoins">${coins}</b>
              <i aria-hidden="true">+</i>
            </button>

            <button id="homeGemButton" type="button" aria-label="Mes gemmes">
              ${img("gem")}
              <b id="homeGems">${Math.max(0, Number(eco.gems) || 0)}</b>
              <i aria-hidden="true">+</i>
            </button>
          </div>

          <button
            id="homeMenuButton"
            class="hm-menu-button"
            type="button"
            aria-label="Ouvrir le menu"
            aria-expanded="false"
            aria-controls="homeMenu"
          >
            <span></span><span></span><span></span>
          </button>

          <nav id="homeMenu" class="hm-menu" aria-label="Menu" hidden>
            <button id="homeSettings" type="button">${img("settings")}<span>Paramètres</span></button>
            <button id="homeProfileLink" type="button">${img("profile-icon")}<span>Mon profil</span></button>
            <button id="homeHistory" type="button">${img("coin")}<span>Historique des pièces</span></button>
            <button id="homeMenuClose" class="hm-menu-close" type="button">Fermer</button>
          </nav>
        </header>

        <section class="hm-hero" aria-label="P’tit Bac">
          <div class="hm-letters" aria-hidden="true">
            <span>A</span><span>C</span><span>E</span><span>B</span>
          </div>

          <nav class="hm-side hm-left" aria-label="Activités">
            ${side("homeQuests", "task", "Quêtes", true)}
            ${side("homePlaqueShop", "shop", "Boutique")}
          </nav>

          <nav class="hm-side hm-right" aria-label="Communauté">
            ${side("homeInfo", "info", "Info", true)}
            ${side("homeFriends", "friends", "Amis")}
          </nav>

          <div class="hm-brand">
            <div class="hm-brand-glow" aria-hidden="true"></div>
            <img
              id="homeBrandLogo"
              class="hm-logo"
              src="/ptitbac.logo.png"
              alt="P’tit Bac"
              fetchpriority="high"
            >
          </div>

          <div class="hm-book" aria-hidden="true">
            <span>ANIMAL<br>PAYS<br>PRÉNOM</span>
            <span>OBJET<br>MÉTIER<br>COULEUR</span>
          </div>
        </section>

        <section class="hm-modes" aria-labelledby="homeModesTitle">
          <h1 id="homeModesTitle">
            <span aria-hidden="true">✦</span>
            Choisis ton mode de jeu
            <span aria-hidden="true">✦</span>
          </h1>

          <div class="hm-mode-grid">
            <button id="homePlaqueQuick" class="hm-quick" type="button">
              ${img("lightning")}
              <b>Partie rapide <span>›</span></b>
            </button>

            <button id="homePlaqueCreate" class="hm-create" type="button">
              ${img("create")}
              <b>Créer un salon <span>›</span></b>
            </button>

            <button id="homeJoinOpen" class="hm-join" type="button">
              ${img("join")}
              <b>Rejoindre une partie <span>›</span></b>
            </button>
          </div>

          <button class="hm-ranked" type="button" data-soon="Mode classé">
            ${img("scoreboard-trophy")}
            <span class="hm-ranked-copy">
              <b>Mode Classé <i class="hm-lock">${lockIcon()}</i></b>
              <small>Bientôt disponible…</small>
            </span>
            <span class="hm-ranked-note">
              Grimpe dans le classement<br>et deviens le meilleur !
            </span>
            <span class="hm-ranked-crown" aria-hidden="true">♔</span>
          </button>
        </section>

        <section class="hm-bottom" aria-label="Progression et inventaire">
          <button class="hm-trophies" type="button" data-soon="La voie des trophées">
            <b class="hm-trophies-title">
              ${img("scoreboard-trophy")}
              <span>La voie des trophées</span>
              <i>›</i>
            </b>

            <div class="hm-milestones" aria-hidden="true">
              <div class="hm-trophy-track">
                <span class="hm-trophy-track-fill"></span>
              </div>

              ${milestones.map(([icon, value, state]) => `
                <span class="${state}">
                  <span class="hm-milestone-icon">${img(icon)}</span>
                  <i></i>
                  <small>${value}</small>
                </span>
              `).join("")}
            </div>
          </button>

          <button id="homeInventory" class="hm-inventory" type="button">
            ${img("inventaire")}
            <b>Inventaire <span>›</span></b>
          </button>
        </section>

        <dialog id="homeJoinDialog" class="hm-dialog">
          <form method="dialog">
            <button class="hm-close" aria-label="Fermer">×</button>
          </form>
          <h2>Rejoindre une partie</h2>
          <label for="homePlaqueCode">Code du salon</label>
          <input
            id="homePlaqueCode"
            maxlength="5"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="ABCDE"
          >
          <button id="homePlaqueJoin" type="button">Rejoindre</button>
        </dialog>

        <dialog id="homeDetailDialog" class="hm-dialog">
          <form method="dialog">
            <button class="hm-close" aria-label="Fermer">×</button>
          </form>
          <div id="homeDetailContent"></div>
        </dialog>
      </main>
    `);

    bindHomeGameActions();

    const menu = document.getElementById("homeMenu");
    const trigger = document.getElementById("homeMenuButton");
    const screen = document.querySelector(".home-mobile");

    const closeMenu = () => {
      if (!menu || !trigger) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };

    trigger?.addEventListener("click", event => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
    });

    document.getElementById("homeMenuClose")?.addEventListener("click", () => {
      closeMenu();
      trigger?.focus();
    });

    screen?.addEventListener("click", event => {
      if (!menu?.contains(event.target) && !trigger?.contains(event.target)) {
        closeMenu();
      }
    });

    screen?.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu();
    });

    const showDetails = html => {
      closeMenu();
      const content = document.getElementById("homeDetailContent");
      const dialog = document.getElementById("homeDetailDialog");
      if (!content || !dialog) return;

      content.innerHTML = html;
      dialog.showModal();
    };

    document.getElementById("homeJoinOpen")?.addEventListener("click", () => {
      document.getElementById("homeJoinDialog")?.showModal();
      setTimeout(() => document.getElementById("homePlaqueCode")?.focus(), 20);
    });

    document.getElementById("homeGemButton")?.addEventListener("click", () => {
      showDetails(`
        <h2>Mes gemmes</h2>
        <div class="hm-detail-resource">
          ${img("gem")}
          <strong>${Math.max(0, Number(economyState().gems) || 0)}</strong>
        </div>
        <p>Les gemmes seront utilisées dans de futures fonctionnalités.</p>
      `);
    });

    document.querySelectorAll("[data-soon]").forEach(button => {
      button.addEventListener("click", () => {
        toast(`${button.dataset.soon} : bientôt disponible.`);
      });
    });

    document.getElementById("homeFriends")?.addEventListener("click", () => {
      window.PtitBacFriends?.open?.();
    });

    document.getElementById("homeProfileLink")?.addEventListener("click", renderProfile);

    document.getElementById("homeHistory")?.addEventListener("click", () => {
      closeMenu();
      window.openWalletHistory?.();
    });

    document.getElementById("homeSettings")?.addEventListener("click", () => {
      showDetails(`
        <h2>Paramètres</h2>
        <p>Les réglages du jeu arrivent bientôt.</p>
      `);
    });

    document.getElementById("homeInventory")?.addEventListener("click", () => {
      showDetails(`
        <h2>Inventaire</h2>
        <p>Avatar équipé</p>
        <div class="hm-inventory-avatar">${escapeHtml(safeAvatar(getProfile().icon))}</div>
        <button id="homeChangeAvatar" type="button">Changer mon avatar</button>
        <p>Les autres objets arriveront plus tard.</p>
      `);

      document.getElementById("homeChangeAvatar")?.addEventListener("click", () => {
        document.getElementById("homeDetailDialog")?.close();

        if (typeof window.openProfileAvatarPicker === "function") {
          window.openProfileAvatarPicker();
        } else {
          renderProfile();
        }
      });
    });

    window.PtitBacEconomy?.refresh?.();
    refreshHomeResources();

    homeTimer = setInterval(() => {
      if (!document.querySelector(".home-mobile")) {
        clearInterval(homeTimer);
        return;
      }

      refreshHomeResources();
    }, 1000);
  }

  window.renderHome = renderPlaquetteHome;

  try {
    renderHome = renderPlaquetteHome;
  } catch {}

  if (!session.state && document.getElementById("app")?.children.length) {
    renderPlaquetteHome();
  }
})();
