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
      secondsToNext: 0
    };
  }

  function formatRecharge(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    if (min >= 1) return `${min} min`;
    return `${sec}s`;
  }

  function refreshHomeResources() {
    const state = economyState();
    const coin = document.getElementById("homePlaqueCoins");
    const lives = document.getElementById("homePlaqueLives");
    if (coin) coin.textContent = String(Math.max(0, Number(state.coins) || 0));
    if (lives) lives.textContent = `${Math.max(0, Number(state.lives) || 0)}/${Math.max(1, Number(state.maxLives) || 5)}`;

    const gems = document.getElementById("homeGems");
    if (gems) gems.textContent = String(Math.max(0, Number(state.gems) || 0));
    refreshResourcePopup();

    const quick = document.getElementById("homePlaqueQuick");
    if (quick) {
      quick.disabled = Number(state.lives) < 1;
      quick.setAttribute("aria-disabled", Number(state.lives) < 1 ? "true" : "false");
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
          <strong class="home-resource-popup-value home-resource-popup-coins"><img src="/coin.png" alt="">${coins} pièce${coins > 1 ? "s" : ""}</strong>
          <button id="homeResourceShop" type="button">Ajouter des pièces</button><button id="homeResourceHistory" type="button">Historique</button>
        </div>`;
    }

    return `
      <div class="home-resource-popup-card" role="dialog" aria-label="Mes vies">
        <strong class="home-resource-popup-value home-resource-popup-lives"><img src="/heart.png" alt="">${lives}/${maxLives} vies</strong>
        <small>
          ${isFull
            ? "Vies rechargées"
            : `Prochaine vie dans ${formatRecharge(state.secondsToNext)}`}
        </small>
      </div>`;
  }

  function openResourcePopup(type, anchorEl) {
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

    const rect = anchorEl?.getBoundingClientRect?.();
    const host = document.querySelector(".home-mobile")?.getBoundingClientRect?.();
    if (rect && host) {
      const center = rect.left - host.left + rect.width / 2;
      const top = rect.bottom - host.top + 7;
      layer.style.setProperty("--popup-center", `${center}px`, "important");
      layer.style.setProperty("--popup-top", `${top}px`, "important");
    }

    layer.addEventListener("click", event => {
      if (event.target === layer) closeResourcePopup();
    });

    document.getElementById("homeResourceHistory")?.addEventListener("click",()=>{closeResourcePopup();window.openWalletHistory();});
    document.getElementById("homeResourceShop")?.addEventListener("click", () => {
      closeResourcePopup();
      renderShop();
    });
  }

  function refreshResourcePopup() {
    const popup = document.getElementById("homeResourcePopover");
    if (!popup) return;
    const type = popup.dataset.type;
    const oldCard = popup.querySelector(".home-resource-popup-card");
    if (!oldCard) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = resourcePopupContent(type);
    const newCard = wrapper.firstElementChild;
    oldCard.replaceWith(newCard);

    document.getElementById("homeResourceHistory")?.addEventListener("click",()=>{closeResourcePopup();window.openWalletHistory();});
    document.getElementById("homeResourceShop")?.addEventListener("click", () => {
      closeResourcePopup();
      renderShop();
    });
  }

  function bindHomeActions(profile) {
    const ensureProfile = () => {
      const p = getProfile();
      if (!String(p.name || "").trim()) {
        toast("Choisis d’abord ton pseudo.");
        renderProfile();
        return null;
      }
      return p;
    };

    const ensureHydratedProfile = async () => {
      try {
        await window.PtitBacProfilePhoto?.hydrateSelectedPhoto?.();
      } catch {}
      return ensureProfile();
    };

    document.getElementById("homePlaqueAvatar")?.addEventListener("click", renderProfile);

    const coinsButton = document.getElementById("homePlaqueCoinsBtn");
    const livesButton = document.getElementById("homePlaqueLivesBtn");

    coinsButton?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("coins", coinsButton);
    });

    livesButton?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("lives", livesButton);
    });

    document.getElementById("homePlaqueQuick")?.addEventListener("click", () => {
      const p = ensureProfile();
      if (!p) return;

      const eco = economyState();
      if (Number(eco.lives) < 1) {
        return toast(`Plus de vie. Recharge dans ${formatRecharge(eco.secondsToNext)}.`);
      }

      window.startQuickPlay(p);
    });

    document.getElementById("homePlaqueCreate")?.addEventListener("click", async () => {
      const p = await ensureHydratedProfile();
      if (!p) return;

      socket.emit("room:create", {
        name: p.name.trim(),
        rounds: 1,
        categoryCount: 6,
        categoryDifficulty: "medium",
        duration: 60,
        avatar: p.icon,
        friendCode: String(localStorage.getItem("petitbac_friendCode") || "").trim(),
        walletToken: session.walletToken
      }, res => {
        if (!res?.ok) return toast(res?.error || "Impossible de créer le salon.");
        if (res.walletToken) setWalletState(res.walletToken, res.balance);
        saveSession(res.code, res.playerId);
        session.state = res.state;
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
        if (event.key === "Enter") document.getElementById("homePlaqueJoin")?.click();
      });
    }

    document.getElementById("homePlaqueJoin")?.addEventListener("click", async () => {
      const p = await ensureHydratedProfile();
      if (!p) return;

      const code = String(codeInput?.value || "").trim();
      if (code.length !== 5) return toast("Entre le code à 5 caractères du salon.");

      socket.emit("room:join", {
        code,
        name: p.name.trim(),
        avatar: p.icon,
        friendCode: String(localStorage.getItem("petitbac_friendCode") || "").trim(),
        walletToken: session.walletToken
      }, res => {
        if (!res?.ok) return toast(res?.error || "Impossible de rejoindre.");
        if (res.walletToken) setWalletState(res.walletToken, res.balance);
        saveSession(res.code, res.playerId);
        session.state = res.state;
        render();
      });
    });

    document.getElementById("homePlaqueShop")?.addEventListener("click", renderShop);
    document.getElementById("homePlaqueRewards")?.addEventListener("click", () => {
      toast("La page Récompenses sera la prochaine à finaliser.");
    });
    document.getElementById("homePlaqueSettings")?.addEventListener("click", () => {
      toast("La page Paramètres sera finalisée ensuite.");
    });

    const betaTrigger = document.getElementById("homePlaqueCrown");
    let adminTapCount = 0;
    let adminTapTimer = null;
    betaTrigger?.addEventListener("click", () => {
      adminTapCount += 1;
      clearTimeout(adminTapTimer);
      adminTapTimer = setTimeout(() => adminTapCount = 0, 2200);
      if (adminTapCount >= 7) {
        adminTapCount = 0;
        clearTimeout(adminTapTimer);
        openAdminCoinAccess();
      }
    });
  }

  function renderPlaquetteHome() {
    if (session.state) return render();

    clearInterval(homeTimer);

    const profile = getProfile();
    const coins = getCoins();
    const eco = economyState();
    const lives = Math.max(0, Number(eco.lives) || 0);
    const maxLives = Math.max(1, Number(eco.maxLives) || 5);

    const img = (file) => `<img src="/${file}.png" alt="" draggable="false">`;
    const side = (id,file,label,soon=false) => `<button type="button" id="${id}" ${soon?'data-soon="'+label+'"':''}>${img(file)}<b>${label}</b>${soon?'<small>À venir</small>':''}</button>`;
    setScreen(`
      <main class="home-mobile">
        <header class="hm-header">
          <button id="homePlaqueAvatar" class="hm-profile" aria-label="Mon profil">
            <span class="hm-avatar">${window.PtitBacProfilePhoto?.isImageAvatar?.(profile.icon)
              ? '<img src="'+escapeHtml(profile.icon)+'" alt="">':escapeHtml(profile.icon || "🐼")}</span>
            <span class="hm-profile-copy"><b>${escapeHtml(profile.name || "Mon profil")}</b><small title="Système de niveau à venir">Niv. —</small></span>
          </button>
          <div class="hm-resources">
            <button id="homePlaqueLivesBtn" aria-label="Mes vies">${img('heart')}<b id="homePlaqueLives">${lives}/${maxLives}</b><i>+</i></button>
            <button id="homePlaqueCoinsBtn" aria-label="Mes pièces">${img('coin')}<b id="homePlaqueCoins">${coins}</b><i>+</i></button>
            <button id="homeGemButton" aria-label="Mes gemmes">${img('gem')}<b id="homeGems">0</b><i>+</i></button>
          </div>
          <button id="homeMenuButton" class="hm-menu-button" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="homeMenu">☰</button>
          <nav id="homeMenu" class="hm-menu" aria-label="Menu" hidden>
            <button id="homeSettings">${img('settings')}Paramètres</button>
            <button id="homeProfileLink">${img('profile-icon')}Mon profil</button>
            <button id="homeHistory">${img('coin')}Historique des pièces</button>
            <button id="homeMenuClose">Fermer</button>
          </nav>
        </header>
        <section class="hm-hero" aria-label="P’tit Bac">
          <div class="hm-letters" aria-hidden="true"><span>A</span><span>C</span><span>E</span><span>B</span></div>
          <nav class="hm-side hm-left" aria-label="Activités">
            ${side('homeQuests','task','Quêtes',true)}${side('homePlaqueShop','shop','Boutique')}
          </nav>
          <nav class="hm-side hm-right" aria-label="Communauté">
            ${side('homeInfo','info','Info',true)}${side('homeFriends','friends','Amis')}
          </nav>
          <img class="hm-logo" src="/ptitbac.logo.png" alt="P’tit Bac" fetchpriority="high">
          <div class="hm-book" aria-hidden="true"><span>ANIMAL<br>PAYS<br>PRÉNOM</span><span>OBJET<br>MÉTIER<br>COULEUR</span></div>
        </section>
        <section class="hm-modes" aria-labelledby="homeModesTitle">
          <h1 id="homeModesTitle">Choisis ton mode de jeu</h1>
          <div class="hm-mode-grid">
            <button id="homePlaqueQuick" class="hm-quick">${img('lightning')}<b>Partie rapide <span>›</span></b></button>
            <button id="homePlaqueCreate" class="hm-create">${img('create')}<b>Créer un salon <span>›</span></b></button>
            <button id="homeJoinOpen" class="hm-join">${img('join')}<b>Rejoindre une partie <span>›</span></b></button>
          </div>
          <button class="hm-ranked" data-soon="Mode classé">${img('scoreboard-trophy')}<span><b>Mode Classé <i>♙</i></b><small>Bientôt disponible…</small></span><span class="hm-ranked-note">Grimpe dans le classement<br>et deviens le meilleur !</span></button>
        </section>
        <section class="hm-bottom" aria-label="Progression et inventaire">
          <button class="hm-trophies" data-soon="La voie des trophées">
            <b>${img('scoreboard-trophy')}La voie des trophées <span>›</span></b>
            <div class="hm-milestones" aria-hidden="true">${['coin','gem','rewards','rewards','rewards'].map((x,i)=>'<span>'+img(x)+'<i></i><small>'+[100,250,500,750,1000][i]+'</small></span>').join('')}</div>
            <small>À venir</small>
          </button>
          <button id="homeInventory" class="hm-inventory">${img('inventaire')}<b>Inventaire ›</b></button>
        </section>
        <footer class="hm-footer"><button id="homePlaqueCrown" aria-label="Version bêta">◆</button><small>Version bêta</small></footer>
        <dialog id="homeJoinDialog" class="hm-dialog"><form method="dialog"><button class="hm-close" aria-label="Fermer">×</button></form><h2>Rejoindre une partie</h2><label for="homePlaqueCode">Code du salon</label><input id="homePlaqueCode" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="ABCDE"><button id="homePlaqueJoin">Rejoindre</button></dialog>
        <dialog id="homeDetailDialog" class="hm-dialog"><form method="dialog"><button class="hm-close" aria-label="Fermer">×</button></form><div id="homeDetailContent"></div></dialog>
      </main>`);
    bindHomeActions(profile);
    const menu = document.getElementById("homeMenu");
    const trigger = document.getElementById("homeMenuButton");
    const closeMenu = () => { menu.hidden = true; trigger.setAttribute("aria-expanded","false"); };
    trigger.onclick = () => { menu.hidden = !menu.hidden; trigger.setAttribute("aria-expanded",String(!menu.hidden)); };
    document.getElementById("homeMenuClose").onclick = () => { closeMenu(); trigger.focus(); };
    document.querySelector(".home-mobile").addEventListener("click", e => { if (!menu.contains(e.target) && !trigger.contains(e.target)) closeMenu(); });
    document.querySelector(".home-mobile").addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
    const details = (html) => { closeMenu(); document.getElementById("homeDetailContent").innerHTML=html; document.getElementById("homeDetailDialog").showModal(); };
    document.getElementById("homeJoinOpen").onclick = () => document.getElementById("homeJoinDialog").showModal();
    document.getElementById("homeGemButton").onclick = () => details('<h2>Mes gemmes</h2><p>'+Math.max(0,Number(economyState().gems)||0)+' gemmes</p><p>Les utilisations des gemmes arrivent bientôt.</p>');
    document.querySelectorAll("[data-soon]").forEach(button => button.onclick=()=>toast(button.dataset.soon+" : bientôt disponible."));
    document.getElementById("homeFriends").onclick = () => window.PtitBacFriends?.open?.();
    document.getElementById("homeProfileLink").onclick = () => renderProfile();
    document.getElementById("homeHistory").onclick = () => { closeMenu(); window.openWalletHistory?.(); };
    document.getElementById("homeSettings").onclick = () => details('<h2>Paramètres</h2><p>Les réglages du jeu arrivent bientôt.</p>');
    document.getElementById("homeInventory").onclick = () => {
      details('<h2>Inventaire</h2><p>Ton avatar équipé</p><div class="hm-inventory-avatar"></div><button id="homeChangeAvatar">Changer mon avatar</button><p>Les autres objets arrivent bientôt.</p>');
      document.querySelector(".hm-inventory-avatar").append(document.querySelector(".hm-avatar").cloneNode(true));
      document.getElementById("homeChangeAvatar").onclick=()=>renderProfile();
    };
    window.PtitBacEconomy?.refresh?.();
    refreshHomeResources();
    homeTimer = setInterval(() => {
      if (!document.querySelector(".home-mobile")) { clearInterval(homeTimer); return; }
      refreshHomeResources();
    }, 1000);
  }

  window.renderHome = renderPlaquetteHome;
  try { renderHome = renderPlaquetteHome; } catch {}

  if (!session.state && document.getElementById("app")?.children.length) {
    renderPlaquetteHome();
  }
})();

