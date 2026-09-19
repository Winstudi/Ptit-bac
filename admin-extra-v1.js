(() => {
  "use strict";

  const CHESTS = Object.freeze([
    { type:"bag", value:"chest:bag", label:"🎒 Sac" },
    { type:"star", value:"chest:star", label:"⭐ Étoile" },
    { type:"legendary", value:"chest:legendary", label:"🌟 Étoile légendaire" }
  ]);

  const SHOP_SLOTS = Object.freeze({ 1:3, 2:3, 3:4 });
  const SHOP_DURATIONS = Object.freeze([
    [60,"1 heure"],
    [360,"6 heures"],
    [720,"12 heures"],
    [1440,"1 jour"],
    [4320,"3 jours"],
    [10080,"7 jours"],
    [20160,"14 jours"]
  ]);
  let shopCatalog = [];
  let shopOffers = [];
  let selectedShopOfferId = "";

  const walletToken = () => String(
    window.session?.walletToken ||
    localStorage.getItem("petitbac_walletToken") ||
    ""
  ).trim();

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[char]));
  }

  function notify(message) {
    const text = String(message || "").trim();
    if (!text) return;

    const node = document.querySelector("#toast");
    if (!node) return;

    node.textContent = text;
    node.classList.add("show");
    clearTimeout(node.__adminExtraTimer);
    node.__adminExtraTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  function emit(name, payload = {}) {
    return new Promise(resolve => {
      try {
        socket.emit(
          name,
          { ...payload, walletToken:walletToken() },
          response => resolve(response || {})
        );
      } catch {
        resolve({ ok:false, error:"Connexion au serveur indisponible." });
      }
    });
  }

  function isChestValue(value) {
    return /^chest:(bag|star|legendary)$/.test(String(value || ""));
  }

  function enhanceGiveItem() {
    const select = document.querySelector("#admItemKey");
    const button = document.querySelector("#admItemSend");
    const quantity = document.querySelector("#admItemQuantity");
    if (!select || !button) return;

    if (!select.querySelector('optgroup[data-admin-chests]')) {
      const group = document.createElement("optgroup");
      group.label = "Coffres";
      group.dataset.adminChests = "1";

      for (const chest of CHESTS) {
        const option = document.createElement("option");
        option.value = chest.value;
        option.textContent = chest.label;
        group.appendChild(option);
      }

      select.prepend(group);
    }

    const syncQuantity = () => {
      if (!quantity) return;
      const chestSelected = isChestValue(select.value);
      quantity.disabled = chestSelected;
      if (chestSelected) quantity.value = "1";
      quantity.closest("label")?.classList.toggle("admin-extra-disabled-field", chestSelected);
    };

    if (!select.dataset.adminExtraBound) {
      select.dataset.adminExtraBound = "1";
      select.addEventListener("change", syncQuantity);
    }
    syncQuantity();

    if (button.dataset.adminExtraBound) return;
    button.dataset.adminExtraBound = "1";

    button.addEventListener("click", async event => {
      if (!isChestValue(select.value)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const friendCode = String(
        document.querySelector("#admItemId")?.value || ""
      ).replace("#", "").trim();

      if (!/^\d{5}$/.test(friendCode)) {
        notify("Entre un ID joueur valide.");
        return;
      }

      const chestType = select.value.split(":")[1];
      const chest = CHESTS.find(entry => entry.type === chestType);

      button.disabled = true;
      const previousText = button.textContent;
      button.textContent = "Envoi du coffre…";

      const response = await emit("admin:grantChest", {
        friendCode,
        chestType
      });

      button.disabled = false;
      button.textContent = previousText || "Envoyer l’objet";

      if (!response.ok) {
        notify(response.error || "Envoi du coffre impossible.");
        return;
      }

      const suffix = response.online
        ? " Le joueur peut l’ouvrir maintenant."
        : " Récompense attribuée (joueur hors ligne).";

      notify(`${response.chestLabel || chest?.label || "Coffre"} donné à ${response.name}.${suffix}`);
    }, true);
  }

  function playerFriendCode(card) {
    const text = card?.querySelector(".admin-v4-player-head small")?.textContent || "";
    return (text.match(/\d{5}/) || [""])[0];
  }

  function enhancePlayerInventoryReset() {
    const result = document.querySelector("#admPlayerResult");
    const card = result?.querySelector(".admin-v4-player-card");
    const moderation = card?.querySelector(".admin-v5-player-moderation");
    if (!card || !moderation || moderation.querySelector("#admResetInventoryBtn")) return;

    const block = document.createElement("div");
    block.className = "admin-v5-mod-block admin-extra-inventory-reset";
    block.innerHTML = `
      <div class="admin-extra-inventory-reset-copy">
        <b>Inventaire du joueur</b>
        <small>Supprime tous les objets débloqués et conserve uniquement les 5 avatars de base.</small>
      </div>
      <button id="admResetInventoryBtn" class="admin-extra-danger-btn" type="button">
        Réinitialiser l’inventaire
      </button>
    `;

    moderation.appendChild(block);

    block.querySelector("#admResetInventoryBtn")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const friendCode = playerFriendCode(card);

      if (!/^\d{5}$/.test(friendCode)) {
        notify("ID joueur introuvable.");
        return;
      }

      const confirmed = window.confirm(
        `Réinitialiser l’inventaire du joueur #${friendCode} ?\n\nTous ses avatars débloqués, cadres et titres seront supprimés. Seuls les 5 avatars de base resteront.`
      );
      if (!confirmed) return;

      button.disabled = true;
      button.textContent = "Réinitialisation…";

      const response = await emit("admin:inventoryReset", { friendCode });

      if (!response.ok) {
        button.disabled = false;
        button.textContent = "Réinitialiser l’inventaire";
        notify(response.error || "Réinitialisation impossible.");
        return;
      }

      notify(response.message || "Inventaire réinitialisé.");

      const searchInput = document.querySelector("#admPlayerSearch");
      if (searchInput) searchInput.value = friendCode;
      document.querySelector("#admPlayerSearchBtn")?.click();
    });
  }

  function bindInventoryResetSync() {
    try {
      if (typeof socket === "undefined" || !socket?.on || socket.__ptbAdminExtraResetBound) return;
      socket.__ptbAdminExtraResetBound = true;
      socket.on("admin:inventory-reset", payload => {
        const avatar = String(payload?.avatar || "/a1.webp");
        try {
          localStorage.setItem("petitbac_profile_icon", avatar);
        } catch {}
        document.dispatchEvent(new CustomEvent("ptitbac:inventory-changed"));
      });
    } catch {}
  }

  function shopTabIcon() {
    return `<span class="admin-v4-icon"><svg viewBox="0 0 24 24"><path d="M4 9h16l-1 11H5L4 9Z"></path><path d="M7 9V7a5 5 0 0 1 10 0v2"></path><path d="M9 13h6"></path></svg></span>`;
  }

  function formatRemaining(endsAt) {
    const ms = Math.max(0, Number(endsAt) - Date.now());
    if (!ms) return "Expirée";
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    return `${Math.floor(hours / 24)} j ${hours % 24} h`;
  }

  function itemVisual(item) {
    if (!item) return `<span class="admin-shop-item-fallback">✦</span>`;
    if (item.type === "tag") return `<span class="admin-shop-tag-preview">🏷️ ${esc(item.label)}</span>`;
    const asset = String(item.asset || (item.type === "avatar" ? item.id : ""));
    return asset
      ? `<img src="${esc(asset)}" alt="">`
      : `<span class="admin-shop-item-fallback">✦</span>`;
  }

  function activeShopOffer(block, position) {
    return shopOffers.find(offer =>
      offer.active &&
      Number(offer.block) === block &&
      Number(offer.position) === position &&
      Number(offer.endsAt) > Date.now()
    ) || null;
  }

  function adminSlotMarkup(block, position, size) {
    const offer = activeShopOffer(block, position);
    return `
      <button class="admin-shop-slot size-${size}${offer ? " is-filled" : ""}" type="button" data-admin-shop-slot="${block}:${position}" ${offer ? `data-admin-shop-edit="${esc(offer.id)}"` : ""}>
        <small>B${block} · P${position}</small>
        ${offer ? `
          <div class="admin-shop-slot-art">${itemVisual(shopCatalog.find(item => item.key === offer.itemKey))}</div>
          <b>${esc(offer.name)}</b>
          <span>${offer.currency === "gems" ? "💎" : "🪙"} ${Number(offer.finalPrice || 0).toLocaleString("fr-FR")}</span>
          <em>${formatRemaining(offer.endsAt)}</em>
        ` : `<strong>+</strong><span>Ajouter</span>`}
      </button>`;
  }

  function shopBoardMarkup() {
    return `
      <div class="admin-shop-board">
        <section><h4>Bloc 1</h4><div class="admin-shop-grid block-1">
          ${adminSlotMarkup(1,1,"large")}${adminSlotMarkup(1,2,"small")}${adminSlotMarkup(1,3,"small")}
        </div></section>
        <section><h4>Bloc 2</h4><div class="admin-shop-grid block-2">
          ${adminSlotMarkup(2,1,"small")}${adminSlotMarkup(2,2,"small")}${adminSlotMarkup(2,3,"large")}
        </div></section>
        <section><h4>Bloc 3</h4><div class="admin-shop-grid block-3">
          ${adminSlotMarkup(3,1,"tiny")}${adminSlotMarkup(3,2,"tiny")}${adminSlotMarkup(3,3,"tiny")}${adminSlotMarkup(3,4,"tiny")}
        </div></section>
      </div>`;
  }

  function itemOptions(selected = "") {
    const groups = { avatar:[], frame:[], tag:[] };
    shopCatalog.forEach(item => groups[item.type]?.push(item));
    const labels = { avatar:"Avatars", frame:"Cadres", tag:"Tags" };
    return Object.entries(groups).map(([type, items]) => `
      <optgroup label="${labels[type]}">
        ${items.map(item => `<option value="${esc(item.key)}" ${item.key === selected ? "selected" : ""}>${esc(item.label)} · ${esc(item.rarityLabel)}</option>`).join("")}
      </optgroup>`).join("");
  }

  function positionOptions(block, selected = 1) {
    const count = SHOP_SLOTS[Number(block)] || 3;
    return Array.from({ length:count }, (_, index) => index + 1)
      .map(position => `<option value="${position}" ${position === Number(selected) ? "selected" : ""}>Position ${position}</option>`)
      .join("");
  }

  function offerEditorMarkup(offer = null, presetBlock = 1, presetPosition = 1) {
    const item = shopCatalog.find(entry => entry.key === offer?.itemKey) || shopCatalog[0] || null;
    const block = Number(offer?.block || presetBlock || 1);
    const position = Number(offer?.position || presetPosition || 1);
    const price = Number(offer?.basePrice || item?.configuredPrice || 100);
    const currency = String(offer?.currency || item?.configuredCurrency || "coins");
    return `
      <section class="admin-v4-card admin-shop-editor" id="adminShopEditor">
        <div class="admin-shop-editor-head">
          <div><small>OFFRE</small><h3>${offer ? "Modifier l’offre" : "Créer une offre"}</h3></div>
          ${offer ? `<button id="admShopNew" type="button">Nouvelle</button>` : ""}
        </div>
        <div class="admin-shop-form">
          <label class="admin-shop-wide">Item
            <select id="admShopItem">${itemOptions(item?.key || "")}</select>
          </label>
          <div class="admin-shop-item-preview" id="admShopItemPreview">${itemVisual(item)}</div>
          <label>Rareté<input id="admShopRarity" value="${esc(item?.rarityLabel || "Commun")}" disabled></label>
          <label class="admin-shop-wide">Nom affiché<input id="admShopName" maxlength="40" value="${esc(offer?.name || item?.label || "")}"></label>
          <label>Monnaie<select id="admShopCurrency"><option value="coins" ${currency === "coins" ? "selected" : ""}>Pièces</option><option value="gems" ${currency === "gems" ? "selected" : ""}>Gemmes</option></select></label>
          <label>Prix<input id="admShopPrice" type="number" min="1" max="999999" value="${Math.max(1, price)}"></label>
          <label>Promotion<select id="admShopDiscount">${[0,10,20,30,40,50,60,70,80,90].map(v => `<option value="${v}" ${Number(offer?.discountPercent || 0) === v ? "selected" : ""}>${v ? `-${v}%` : "Aucune"}</option>`).join("")}</select></label>
          <label>Bloc<select id="admShopBlock">${[1,2,3].map(v => `<option value="${v}" ${block === v ? "selected" : ""}>Bloc ${v}</option>`).join("")}</select></label>
          <label>Position<select id="admShopPosition">${positionOptions(block, position)}</select></label>
          <label>Durée<select id="admShopDuration">${SHOP_DURATIONS.map(([value,label]) => `<option value="${value}" ${Number(offer?.durationMinutes || 60) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="admin-shop-wide">Badge facultatif<input id="admShopBadge" maxlength="24" placeholder="NOUVEAU, EXCLUSIF…" value="${esc(offer?.badge || "")}"></label>
          <label class="admin-shop-active"><input id="admShopActive" type="checkbox" ${offer?.active === false ? "" : "checked"}> Offre active</label>
        </div>
        <div class="admin-shop-editor-actions">
          <button id="admShopSave" class="admin-shop-primary" type="button">${offer ? "Enregistrer" : "Publier l’offre"}</button>
          ${offer ? `<button id="admShopDeactivate" class="admin-extra-danger-btn" type="button">Retirer de la boutique</button>` : ""}
        </div>
      </section>`;
  }

  function recentOffersMarkup() {
    const recent = shopOffers.slice(0,20);
    if (!recent.length) return `<div class="admin-v1-empty">Aucune offre enregistrée.</div>`;
    return `<div class="admin-shop-recent">${recent.map(offer => `
      <button type="button" data-admin-shop-edit="${esc(offer.id)}" class="${offer.active && Number(offer.endsAt) > Date.now() ? "is-live" : ""}">
        <span><b>${esc(offer.name)}</b><small>Bloc ${offer.block} · Position ${offer.position}</small></span>
        <em>${offer.active ? formatRemaining(offer.endsAt) : "Retirée"}</em>
      </button>`).join("")}</div>`;
  }

  function bindAdminShopEditor(body, presetBlock = 1, presetPosition = 1) {
    const editor = body.querySelector("#adminShopEditor");
    if (!editor) return;

    const itemSelect = editor.querySelector("#admShopItem");
    const blockSelect = editor.querySelector("#admShopBlock");
    const positionSelect = editor.querySelector("#admShopPosition");

    const syncItem = ({ overwriteName = false } = {}) => {
      const item = shopCatalog.find(entry => entry.key === itemSelect?.value);
      if (!item) return;
      const preview = editor.querySelector("#admShopItemPreview");
      if (preview) preview.innerHTML = itemVisual(item);
      const rarity = editor.querySelector("#admShopRarity");
      if (rarity) rarity.value = item.rarityLabel || "Commun";
      const name = editor.querySelector("#admShopName");
      if (name && (overwriteName || !name.value.trim())) name.value = item.label || "";
      if (overwriteName) {
        const price = editor.querySelector("#admShopPrice");
        const currency = editor.querySelector("#admShopCurrency");
        if (price && Number(item.configuredPrice) > 0) price.value = String(item.configuredPrice);
        if (currency) currency.value = item.configuredCurrency || "coins";
      }
    };

    itemSelect?.addEventListener("change", () => syncItem({ overwriteName:true }));
    blockSelect?.addEventListener("change", () => {
      if (positionSelect) positionSelect.innerHTML = positionOptions(blockSelect.value, 1);
    });

    editor.querySelector("#admShopNew")?.addEventListener("click", () => {
      selectedShopOfferId = "";
      renderAdminShopEditor(body, null, presetBlock, presetPosition);
    });

    editor.querySelector("#admShopSave")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Enregistrement…";
      const response = await emit("admin:shopSave", {
        offerId:selectedShopOfferId,
        itemKey:itemSelect?.value,
        name:editor.querySelector("#admShopName")?.value,
        currency:editor.querySelector("#admShopCurrency")?.value,
        price:editor.querySelector("#admShopPrice")?.value,
        discountPercent:editor.querySelector("#admShopDiscount")?.value,
        block:blockSelect?.value,
        position:positionSelect?.value,
        durationMinutes:editor.querySelector("#admShopDuration")?.value,
        badge:editor.querySelector("#admShopBadge")?.value,
        active:editor.querySelector("#admShopActive")?.checked !== false
      });
      if (!response.ok) {
        button.disabled = false;
        button.textContent = selectedShopOfferId ? "Enregistrer" : "Publier l’offre";
        notify(response.error || "Enregistrement impossible.");
        return;
      }
      notify("Offre boutique enregistrée.");
      selectedShopOfferId = "";
      await renderAdminShop();
    });

    editor.querySelector("#admShopDeactivate")?.addEventListener("click", async () => {
      if (!selectedShopOfferId) return;
      if (!window.confirm("Retirer cette offre de la boutique ?")) return;
      const response = await emit("admin:shopDeactivate", { offerId:selectedShopOfferId });
      if (!response.ok) return notify(response.error || "Retrait impossible.");
      notify("Offre retirée.");
      selectedShopOfferId = "";
      await renderAdminShop();
    });

    syncItem();
  }

  function renderAdminShopEditor(body, offer = null, block = 1, position = 1) {
    body.querySelector("#adminShopEditor")?.remove();
    const holder = body.querySelector("#adminShopEditorHolder");
    if (!holder) return;
    holder.innerHTML = offerEditorMarkup(offer, block, position);
    bindAdminShopEditor(body, block, position);
    holder.scrollIntoView({ behavior:"smooth", block:"nearest" });
  }

  function bindAdminShopBody(body) {
    body.querySelectorAll("[data-admin-shop-slot]").forEach(slot => {
      slot.addEventListener("click", () => {
        const [block, position] = String(slot.dataset.adminShopSlot || "1:1").split(":").map(Number);
        const offer = shopOffers.find(item => item.id === slot.dataset.adminShopEdit) || null;
        selectedShopOfferId = offer?.id || "";
        renderAdminShopEditor(body, offer, block, position);
      });
    });

    body.querySelectorAll("[data-admin-shop-edit]").forEach(button => {
      if (button.hasAttribute("data-admin-shop-slot")) return;
      button.addEventListener("click", () => {
        const offer = shopOffers.find(item => item.id === button.dataset.adminShopEdit);
        if (!offer) return;
        selectedShopOfferId = offer.id;
        renderAdminShopEditor(body, offer, offer.block, offer.position);
      });
    });

    bindAdminShopEditor(body);
  }

  async function renderAdminShop() {
    const body = document.querySelector("#adminV4Body");
    if (!body) return;
    body.innerHTML = `<div class="admin-v1-empty">Chargement de la boutique…</div>`;

    const [catalogResponse, offersResponse] = await Promise.all([
      emit("admin:shopCatalog"),
      emit("admin:shopOffers")
    ]);

    if (!catalogResponse.ok || !offersResponse.ok) {
      body.innerHTML = `<div class="admin-v1-empty">${esc(catalogResponse.error || offersResponse.error || "Boutique admin indisponible.")}</div>`;
      return;
    }

    shopCatalog = Array.isArray(catalogResponse.items) ? catalogResponse.items : [];
    shopOffers = Array.isArray(offersResponse.offers) ? offersResponse.offers : [];
    selectedShopOfferId = "";

    body.innerHTML = `
      <section class="admin-v4-card admin-shop-intro">
        <small>BOUTIQUE DYNAMIQUE</small>
        <h3>Offre à l’affiche</h3>
        <p>10 emplacements fixes. Clique une case pour publier ou modifier l’offre affichée à cet endroit.</p>
      </section>
      ${shopBoardMarkup()}
      <div id="adminShopEditorHolder">${offerEditorMarkup(null,1,1)}</div>
      <section class="admin-v4-card admin-shop-history">
        <small>OFFRES</small><h3>Actives et récentes</h3>${recentOffersMarkup()}
      </section>`;

    bindAdminShopBody(body);
  }

  function enhanceShopTab() {
    const nav = document.querySelector(".admin-v4-main-tabs");
    if (!nav) return;

    let button = nav.querySelector("[data-admin-extra-shop]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.adminExtraShop = "1";
      button.innerHTML = `${shopTabIcon()}<span>Boutique</span>`;
      nav.appendChild(button);
      button.addEventListener("click", () => {
        nav.querySelectorAll("[data-admin-tab]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderAdminShop();
      });
    }

    if (!nav.dataset.adminShopNativeBound) {
      nav.dataset.adminShopNativeBound = "1";
      nav.addEventListener("click", event => {
        if (event.target.closest?.("[data-admin-tab]")) button?.classList.remove("active");
      });
    }
  }

  function bindShopAdminSocket() {
    try {
      if (typeof socket === "undefined" || !socket?.on || socket.__ptbAdminShopBound) return;
      socket.__ptbAdminShopBound = true;
      socket.on("shop:update", () => {
        if (document.querySelector("[data-admin-extra-shop].active")) renderAdminShop();
      });
    } catch {}
  }

  function enhance() {
    enhanceGiveItem();
    enhancePlayerInventoryReset();
    bindInventoryResetSync();
    enhanceShopTab();
    bindShopAdminSocket();
  }

  let scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  const observer = new MutationObserver(scheduleEnhance);

  function start() {
    enhance();
    observer.observe(document.documentElement, {
      childList:true,
      subtree:true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
  } else {
    start();
  }
})();
