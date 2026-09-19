(() => {
  "use strict";

  let activeShopTab = "featured";
  let featuredOffers = [];
  let featuredLoaded = false;
  let featuredLoading = false;
  let shopSocketBound = false;
  let timerHandle = null;
  let expiryRefreshPending = false;

  function shopEconomyState() {
    try {
      const live = window.PtitBacEconomy?.state?.();
      if (live) return live;
    } catch {}

    return {
      coins: typeof getCoins === "function"
        ? getCoins()
        : Number(localStorage.getItem("petitbac_walletBalance") || 0),
      gems: 0,
      lives: 5,
      maxLives: 5,
      unlimitedLivesUntil: 0
    };
  }

  function walletToken() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[char]));
  }

  function fmtNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.floor(Number(value) || 0)));
  }

  function requestId() {
    return globalThis.crypto?.randomUUID?.() ||
      `shop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  }

  function emitShop(name, payload = {}) {
    return new Promise(resolve => {
      try {
        socket.emit(name, { ...payload, walletToken:walletToken() }, response => resolve(response || {}));
      } catch {
        resolve({ ok:false, error:"Connexion à la boutique indisponible." });
      }
    });
  }

  function moneyButton(label, product) {
    return `<button class="shop2-buy" type="button" data-shop-product="${product}">${label}<span>›</span></button>`;
  }

  function iconCheck(text) {
    return `<li><span class="shop2-check">✓</span><span>${text}</span></li>`;
  }

  function offerAt(block, position) {
    return featuredOffers.find(offer => Number(offer.block) === block && Number(offer.position) === position) || null;
  }

  function offerAssetMarkup(offer) {
    if (offer?.itemType === "tag") {
      return `<div class="shop2-dyn-tag"><span>🏷️</span><b>${esc(offer.name)}</b></div>`;
    }
    const asset = String(offer?.asset || "").trim();
    if (!asset) return `<div class="shop2-dyn-fallback">✦</div>`;
    return `<img src="${esc(asset)}" alt="">`;
  }

  function durationLabel(endsAt) {
    const remaining = Math.max(0, Number(endsAt) - Date.now());
    if (!remaining) return "Terminé";
    const mins = Math.ceil(remaining / 60000);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ${mins % 60 ? `${mins % 60} min` : ""}`.trim();
    const days = Math.floor(hours / 24);
    return `${days} j ${hours % 24 ? `${hours % 24} h` : ""}`.trim();
  }

  function offerCardMarkup(offer, size = "small") {
    if (!offer) {
      return `
        <article class="shop2-dyn-offer is-empty size-${size}" aria-hidden="true">
          <div class="shop2-empty-star">✦</div>
        </article>`;
    }

    const currencyAsset = offer.currency === "gems" ? "/gem.png" : "/coin.png";
    const rarity = String(offer.rarity || "commun").replace(/[^a-z0-9_-]/gi, "");
    const badge = String(offer.badge || "").trim();
    const promo = Math.max(0, Number(offer.discountPercent) || 0);
    const owned = offer.owned === true;

    return `
      <article class="shop2-dyn-offer size-${size} rarity-${rarity}${owned ? " is-owned" : ""}" data-shop-offer-card="${esc(offer.id)}">
        <div class="shop2-dyn-topline">
          <span class="shop2-dyn-rarity">${esc(offer.rarityLabel || "Commun")}</span>
          <small data-offer-ends="${Number(offer.endsAt) || 0}">${esc(durationLabel(offer.endsAt))}</small>
        </div>
        ${badge ? `<span class="shop2-dyn-badge">${esc(badge)}</span>` : ""}
        ${promo ? `<span class="shop2-dyn-promo">-${promo}%</span>` : ""}
        <div class="shop2-dyn-art">${offerAssetMarkup(offer)}</div>
        <h3>${esc(offer.name)}</h3>
        <div class="shop2-dyn-price-row">
          ${promo ? `<del>${fmtNumber(offer.basePrice)}</del>` : ""}
          <button class="shop2-dyn-buy" type="button" data-shop-offer="${esc(offer.id)}" ${owned ? "disabled" : ""}>
            ${owned
              ? `<span>Possédé</span>`
              : `<img src="${currencyAsset}" alt=""><b>${fmtNumber(offer.finalPrice)}</b>`}
          </button>
        </div>
      </article>`;
  }

  function featuredMarkup() {
    if (!featuredLoaded && featuredLoading) {
      return `
        <section class="shop2-view shop2-featured shop2-featured-dynamic" data-shop-view="featured">
          <div class="shop2-featured-loading"><span></span><b>Chargement des offres…</b></div>
        </section>`;
    }

    return `
      <section class="shop2-view shop2-featured shop2-featured-dynamic" data-shop-view="featured">
        <div class="shop2-offer-block shop2-block-1">
          ${offerCardMarkup(offerAt(1,1), "large")}
          ${offerCardMarkup(offerAt(1,2), "small")}
          ${offerCardMarkup(offerAt(1,3), "small")}
        </div>
        <div class="shop2-offer-block shop2-block-2">
          ${offerCardMarkup(offerAt(2,1), "small")}
          ${offerCardMarkup(offerAt(2,2), "small")}
          ${offerCardMarkup(offerAt(2,3), "large")}
        </div>
        <div class="shop2-offer-block shop2-block-3">
          ${offerCardMarkup(offerAt(3,1), "tiny")}
          ${offerCardMarkup(offerAt(3,2), "tiny")}
          ${offerCardMarkup(offerAt(3,3), "tiny")}
          ${offerCardMarkup(offerAt(3,4), "tiny")}
        </div>
      </section>`;
  }

  function gemCard(amount, price, product, ribbon = "") {
    return `
      <article class="shop2-resource-card">
        <strong>${fmtNumber(amount)}</strong>
        <small>gemmes</small>
        <div class="shop2-gem-pile">
          <img src="/gem.png" alt="">
          <img src="/gem.png" alt="">
          <img src="/gem.png" alt="">
        </div>
        ${ribbon ? `<span class="shop2-ribbon">${ribbon}</span>` : ""}
        ${moneyButton(price, product)}
      </article>`;
  }

  function coinExchangeCard(coins, gems) {
    return `
      <article class="shop2-resource-card shop2-exchange-card">
        <strong>${fmtNumber(coins)}</strong>
        <small>pièces</small>
        <div class="shop2-coin-pile">
          <img src="/coin.png" alt="">
          <img src="/coin.png" alt="">
          <img src="/coin.png" alt="">
        </div>
        <button class="shop2-buy is-gem-price" type="button" data-gem-exchange="${coins}" data-gem-cost="${gems}">
          <img src="/gem.png" alt="">${fmtNumber(gems)}
        </button>
      </article>`;
  }

  function resourcesMarkup() {
    return `
      <section class="shop2-view shop2-resources-view" data-shop-view="resources">
        <article class="shop2-resource-panel">
          <header class="shop2-panel-title">
            <img src="/gem.png" alt="">
            <div>
              <h2>Acheter des gemmes</h2>
              <p>Des gemmes pour encore plus de fun !</p>
            </div>
          </header>

          <div class="shop2-resource-grid">
            ${gemCard(50, "1,99 €", "gems-50")}
            ${gemCard(150, "4,99 €", "gems-150", "Le plus populaire")}
            ${gemCard(500, "12,99 €", "gems-500", "Meilleur choix")}
            ${gemCard(1200, "24,99 €", "gems-1200", "Super offre")}
          </div>
        </article>

        <div class="shop2-slogan">
          <div class="shop2-slogan-gems">
            <img src="/gem.png" alt=""><img src="/gem.png" alt=""><img src="/gem.png" alt="">
          </div>
          <strong>Plus de gemmes,<br>plus de possibilités !</strong>
          <span>Fais briller<br>tes parties ! ♥</span>
        </div>

        <article class="shop2-resource-panel shop2-coin-panel">
          <header class="shop2-panel-title">
            <img src="/coin.png" alt="">
            <div>
              <h2>Échanger des gemmes contre des pièces</h2>
              <p>Transforme tes gemmes en pièces et joue encore plus !</p>
            </div>
          </header>

          <div class="shop2-resource-grid">
            ${coinExchangeCard(100, 10)}
            ${coinExchangeCard(500, 50)}
            ${coinExchangeCard(1000, 100)}
            ${coinExchangeCard(5000, 400)}
          </div>
        </article>

        <div class="shop2-slogan shop2-slogan-coins">
          <div class="shop2-slogan-gems">
            <img src="/coin.png" alt=""><img src="/coin.png" alt=""><img src="/coin.png" alt="">
          </div>
          <strong>Plus de pièces,<br>plus de parties !</strong>
          <span>Les mots n’attendent<br>que toi ! ♥</span>
        </div>
      </section>`;
  }

  function usefulMarkup() {
    return `
      <section class="shop2-view shop2-useful" data-shop-view="useful">
        <article class="shop2-useful-card is-starter">
          <div class="shop2-useful-copy">
            <div class="shop2-title-line">
              <h2>Starter Pack</h2>
              <span class="shop2-badge is-pink">MEILLEURE OFFRE</span>
            </div>
            <p>Le départ parfait !</p>
            <ul class="shop2-big-list">
              <li><img src="/coin.png" alt=""><b>1 000 pièces</b></li>
              <li><img src="/gem.png" alt=""><b>200 gemmes</b></li>
              <li><img src="/reward-legendary-simple-closed.png" alt=""><b>3 coffres légendaires</b></li>
            </ul>
          </div>
          <div class="shop2-useful-art starter-art">
            <img src="/reward-legendary-simple-open.png" alt="Starter Pack">
          </div>
          ${moneyButton("9,99 €", "starter-pack")}
        </article>

        <article class="shop2-useful-card is-noads">
          <div class="shop2-noads-icon" aria-hidden="true">AD</div>
          <div class="shop2-useful-copy">
            <h2>Pack sans publicité</h2>
            <p>Profite du jeu en toute tranquillité !</p>
            <ul class="shop2-useful-checks">
              ${iconCheck("Aucune publicité")}
              ${iconCheck("Une expérience plus fluide")}
              ${iconCheck("100% concentré sur le jeu")}
            </ul>
          </div>
          <div class="shop2-noads-sign">SANS<br>PUB</div>
          ${moneyButton("4,99 €", "no-ads")}
        </article>

        <article class="shop2-useful-card is-unlimited">
          <div class="shop2-heart-infinity"><img src="/heart.png" alt=""><span>∞</span></div>
          <div class="shop2-useful-copy">
            <h2>Pack vie illimitée</h2>
            <p>Joue sans limite !</p>
            <ul class="shop2-useful-checks">
              ${iconCheck("Vies illimitées")}
              ${iconCheck("Plus de temps pour jouer")}
              ${iconCheck("Ne rate plus aucune partie")}
            </ul>
          </div>
          ${moneyButton("6,99 €", "unlimited-lives")}
        </article>
      </section>`;
  }

  function tabMarkup(tab, icon, label) {
    return `
      <button class="shop2-tab ${activeShopTab === tab ? "is-active" : ""}" type="button" data-shop-tab="${tab}">
        <span class="shop2-tab-icon">${icon}</span>
        <span>${label}</span>
      </button>`;
  }

  function viewMarkup() {
    if (activeShopTab === "resources") return resourcesMarkup();
    if (activeShopTab === "useful") return usefulMarkup();
    return featuredMarkup();
  }

  function notify(message) {
    if (typeof toast === "function") toast(message);
  }

  function updateFeaturedTimers() {
    let expired = false;
    document.querySelectorAll("[data-offer-ends]").forEach(node => {
      const endsAt = Number(node.dataset.offerEnds) || 0;
      node.textContent = durationLabel(endsAt);
      if (endsAt > 0 && endsAt <= Date.now()) expired = true;
    });

    if (expired && !expiryRefreshPending && activeShopTab === "featured") {
      expiryRefreshPending = true;
      featuredLoaded = false;
      refreshFeaturedOffers({ force:true }).finally(() => {
        expiryRefreshPending = false;
      });
    }
  }

  function bindFeaturedButtons() {
    document.querySelectorAll("[data-shop-offer]").forEach(button => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const offerId = String(button.dataset.shopOffer || "");
        const offer = featuredOffers.find(item => item.id === offerId);
        if (!offer) return;

        const unit = offer.currency === "gems" ? "gemmes" : "pièces";
        if (!window.confirm(`Acheter ${offer.name} pour ${fmtNumber(offer.finalPrice)} ${unit} ?`)) return;

        button.disabled = true;
        const old = button.innerHTML;
        button.textContent = "…";

        const response = await emitShop("shop:purchase", {
          offerId,
          requestId:requestId()
        });

        if (!response.ok) {
          button.disabled = false;
          button.innerHTML = old;
          notify(response.error || "Achat impossible.");
          return;
        }

        notify(`${offer.name} ajouté à ton inventaire !`);
        featuredLoaded = false;
        await refreshFeaturedOffers({ force:true });
      });
    });
  }

  async function refreshFeaturedOffers({ force = false } = {}) {
    if (featuredLoading && !force) return;
    featuredLoading = true;
    if (!featuredLoaded && activeShopTab === "featured") {
      const content = document.querySelector(".shop2-content");
      if (content) content.innerHTML = featuredMarkup();
    }

    const response = await emitShop("shop:get");
    featuredLoading = false;

    if (response.ok) {
      featuredOffers = Array.isArray(response.offers) ? response.offers : [];
      featuredLoaded = true;
    } else if (!featuredLoaded) {
      featuredOffers = [];
      featuredLoaded = true;
      notify(response.error || "Offres indisponibles.");
    }

    if (activeShopTab === "featured") {
      const content = document.querySelector(".shop2-content");
      if (content) {
        content.innerHTML = featuredMarkup();
        bindFeaturedButtons();
        updateFeaturedTimers();
      }
    }
  }

  function bindShopSocket() {
    if (shopSocketBound) return;
    shopSocketBound = true;
    try {
      socket.on("shop:update", () => {
        featuredLoaded = false;
        if (activeShopTab === "featured" && document.querySelector(".shop-v2")) {
          refreshFeaturedOffers({ force:true });
        }
      });
    } catch {}
  }

  function bindShopV2() {
    bindShopSocket();

    document.getElementById("shopV2Back")?.addEventListener("click", () => {
      if (typeof renderHome === "function") renderHome();
    });

    document.querySelectorAll("[data-shop-tab]").forEach(button => {
      button.addEventListener("click", () => {
        const next = String(button.dataset.shopTab || "featured");
        if (!["featured", "resources", "useful"].includes(next) || next === activeShopTab) return;
        activeShopTab = next;
        renderShopV2();
      });
    });

    document.querySelectorAll("[data-shop-product]").forEach(button => {
      button.addEventListener("click", () => {
        notify("Les achats seront activés avec les achats intégrés de l’application.");
      });
    });

    document.querySelectorAll("[data-gem-exchange]").forEach(button => {
      button.addEventListener("click", () => {
        const eco = shopEconomyState();
        const cost = Math.max(0, Number(button.dataset.gemCost) || 0);
        const coins = Math.max(0, Number(button.dataset.gemExchange) || 0);
        if ((Number(eco.gems) || 0) < cost) {
          notify(`Il te faut ${fmtNumber(cost)} gemmes pour cet échange.`);
          return;
        }
        notify(`Échange ${fmtNumber(cost)} gemmes → ${fmtNumber(coins)} pièces : connexion serveur à venir.`);
      });
    });

    bindFeaturedButtons();
    clearInterval(timerHandle);
    timerHandle = setInterval(updateFeaturedTimers, 30000);

    if (activeShopTab === "featured" && !featuredLoaded) {
      refreshFeaturedOffers();
    }
  }

  function renderShopV2(tab = null) {
    if (tab && ["featured", "resources", "useful"].includes(tab)) activeShopTab = tab;

    const eco = shopEconomyState();
    const coins = Math.max(0, Number(eco.coins) || 0);
    const gems = Math.max(0, Number(eco.gems) || 0);
    const unlimited = Number(eco.unlimitedLivesUntil) > Date.now();
    const lives = Math.max(0, Number(eco.lives) || 0);
    const maxLives = Math.max(1, Number(eco.maxLives) || 5);

    setScreen(`
      <main class="screen shop-v2 is-compact-shop-header">
        <div class="shop2-sky" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>

        <section class="shop2-brand shop2-brand-featured">
          <div class="shop2-brand-notice">
            <div class="shop2-brand-notice-main">
              <button class="shop2-back shop2-notice-back" id="shopV2Back" type="button" aria-label="Retour">
                <img src="/back-arrow.png" alt="">
              </button>
              <img class="shop2-notice-logo" src="/shop.png" alt="">
              <h1>Boutique</h1>
            </div>
            <div class="shop2-wallet shop2-notice-wallet">
              <div class="shop2-wallet-pill"><img src="/coin.png" alt=""><b>${fmtNumber(coins)}</b></div>
              <div class="shop2-wallet-pill"><img src="/gem.png" alt=""><b>${fmtNumber(gems)}</b></div>
              <div class="shop2-wallet-pill"><img src="/heart.png" alt=""><b>${unlimited ? "∞" : `${lives}/${maxLives}`}</b></div>
            </div>
          </div>
        </section>

        <nav class="shop2-tabs" aria-label="Catégories de la boutique">
          ${tabMarkup("featured", "★", "Offre à l’affiche")}
          ${tabMarkup("resources", "●", "Ressource")}
          ${tabMarkup("useful", "✦", "Utile")}
        </nav>

        <div class="shop2-content">
          ${viewMarkup()}
        </div>

        ${activeShopTab === "featured" ? "" : `
          <footer class="shop2-footer">
            <span>💡</span>
            <p>Plus qu’un jeu de mots,<br>une belle aventure ensemble ! ♥</p>
          </footer>`}
      </main>`);

    bindShopV2();
  }

  window.renderShop = renderShopV2;
  window.PtitBacShop = {
    open: renderShopV2,
    tab: () => activeShopTab,
    refreshFeatured:() => refreshFeaturedOffers({ force:true })
  };
  try { renderShop = renderShopV2; } catch {}
})();
