(() => {
  "use strict";

  let activeShopTab = "featured";

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

  function fmtNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.floor(Number(value) || 0)));
  }

  function moneyButton(label, product) {
    return `<button class="shop2-buy" type="button" data-shop-product="${product}">${label}<span>›</span></button>`;
  }

  function iconCheck(text) {
    return `<li><span class="shop2-check">✓</span><span>${text}</span></li>`;
  }

  function featuredMarkup() {
    return `
      <section class="shop2-view shop2-featured" data-shop-view="featured">
        <article class="shop2-hero-offer">
          <div class="shop2-hero-art">
            <div class="shop2-avatar-wrap">
              <img src="/avatar-prestige.png" alt="Avatar exclusif">
            </div>
            <div class="shop2-gift-cube" aria-hidden="true">
              <span>✦</span>
            </div>
          </div>

          <div class="shop2-hero-copy">
            <span class="shop2-badge is-gold">OFFRE EXCLUSIVE</span>
            <h2>Pack Royal</h2>
            <p>Un look de champion pour briller en partie !</p>
            <ul>
              ${iconCheck("Avatar exclusif")}
              ${iconCheck("Cadre prestige")}
              ${iconCheck("Tag spécial")}
            </ul>
            <button class="shop2-discover" type="button" data-shop-product="royal">Découvrir</button>
          </div>
        </article>

        <div class="shop2-feature-grid">
          <article class="shop2-card shop2-cosmetic-card">
            <span class="shop2-badge is-pink">PACK COSMÉTIQUE</span>
            <h3>Style P’tit Bac</h3>
            <p>Un look unique pour te démarquer !</p>
            <div class="shop2-cosmetic-art">
              <span class="shop2-mini-avatar"><img src="/avatar-prestige.png" alt=""></span>
              <span class="shop2-mini-frame"><img src="/frame-prestige.png" alt=""></span>
            </div>
            <ul>
              ${iconCheck("1 avatar exclusif")}
              ${iconCheck("1 cadre Prestige")}
              ${iconCheck("1 tag exclusif")}
            </ul>
            ${moneyButton("4,99 €", "style-pack")}
          </article>

          <article class="shop2-card shop2-chest-card">
            <span class="shop2-badge is-orange">COFFRE LÉGENDAIRE</span>
            <h3>Coffre Étoilé</h3>
            <p>Des cosmétiques rares et plein de surprises !</p>
            <div class="shop2-chest-art">
              <img src="/reward-legendary-simple-closed.png" alt="Coffre légendaire">
            </div>
            ${moneyButton("2,99 €", "star-chest")}
          </article>
        </div>

        <article class="shop2-champion">
          <div class="shop2-champion-copy">
            <span class="shop2-badge is-pink">OFFRE LIMITÉE</span>
            <h3>Pack Champion</h3>
            <p>Un max de style et de récompenses !</p>
            <div class="shop2-champion-items">
              <span><img src="/avatar-prestige.png" alt=""><small>Avatar</small></span>
              <span><img src="/frame-gold-stars.png" alt=""><small>Cadre</small></span>
              <span><img src="/gem.png" alt=""><b>250</b><small>gemmes</small></span>
              <span><img src="/coin.png" alt=""><b>5 000</b><small>pièces</small></span>
              <span><img src="/reward-legendary-simple-closed.png" alt=""><small>1 coffre</small></span>
            </div>
          </div>
          <div class="shop2-champion-gift">
            <div class="shop2-discount">-50%</div>
            <div class="shop2-present">✦</div>
          </div>
          <div class="shop2-champion-buy">
            ${moneyButton("9,99 €", "champion-pack")}
            <del>19,99 €</del>
          </div>
        </article>
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

  function bindShopV2() {
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
        const product = String(button.dataset.shopProduct || "");
        if (product === "royal") {
          notify("Le détail de cette offre sera disponible prochainement.");
          return;
        }
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
      <main class="screen shop-v2">
        <div class="shop2-sky" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>

        <header class="shop2-header">
          <button class="shop2-back" id="shopV2Back" type="button" aria-label="Retour">
            <img src="/back-arrow.png" alt="">
          </button>

          <div class="shop2-wallet">
            <div class="shop2-wallet-pill"><img src="/coin.png" alt=""><b>${fmtNumber(coins)}</b></div>
            <div class="shop2-wallet-pill"><img src="/gem.png" alt=""><b>${fmtNumber(gems)}</b></div>
            <div class="shop2-wallet-pill"><img src="/heart.png" alt=""><b>${unlimited ? "∞" : `${lives}/${maxLives}`}</b></div>
          </div>
        </header>

        <section class="shop2-brand">
          <h1>Boutique</h1>
          <p>Petites envies, grandes récompenses</p>
        </section>

        <nav class="shop2-tabs" aria-label="Catégories de la boutique">
          ${tabMarkup("featured", "★", "Offre à l’affiche")}
          ${tabMarkup("resources", "●", "Ressource")}
          ${tabMarkup("useful", "✦", "Utile")}
        </nav>

        <div class="shop2-content">
          ${viewMarkup()}
        </div>

        <footer class="shop2-footer">
          <span>💡</span>
          <p>Plus qu’un jeu de mots,<br>une belle aventure ensemble ! ♥</p>
        </footer>
      </main>`);

    bindShopV2();
  }

  window.renderShop = renderShopV2;
  window.PtitBacShop = {
    open: renderShopV2,
    tab: () => activeShopTab
  };
  try { renderShop = renderShopV2; } catch {}
})();
