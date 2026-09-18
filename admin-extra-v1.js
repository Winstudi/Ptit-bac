(() => {
  "use strict";

  const CHESTS = Object.freeze([
    { type:"bag", value:"chest:bag", label:"🎒 Sac" },
    { type:"star", value:"chest:star", label:"⭐ Étoile" },
    { type:"legendary", value:"chest:legendary", label:"🌟 Étoile légendaire" }
  ]);

  const walletToken = () => String(
    window.session?.walletToken ||
    localStorage.getItem("petitbac_walletToken") ||
    ""
  ).trim();

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

  function enhance() {
    enhanceGiveItem();
    enhancePlayerInventoryReset();
    bindInventoryResetSync();
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
