(() => {
  "use strict";

  const DEFAULT_AVATAR = "🧠";

  /*
   * Compatibilité réseau transitoire
   * --------------------------------
   * app.js crée déjà la socket principale avec `const socket = io();`.
   * Plusieurs anciens modules demandent encore `io({ forceNew:true })`.
   *
   * Tant que ces modules ne sont pas consolidés individuellement, on renvoie
   * une façade vers la socket principale au lieu d'ouvrir 4 connexions réseau
   * supplémentaires.
   */
  function installSharedSocketCompatibility() {
    let primarySocket = null;

    try {
      primarySocket = typeof socket !== "undefined" ? socket : null;
    } catch {
      primarySocket = null;
    }

    const nativeIo = window.io;

    if (
      !primarySocket ||
      typeof nativeIo !== "function" ||
      nativeIo.__ptbSharedSocketCompat === true
    ) {
      return;
    }

    const makeFacade = () => {
      let facade = null;

      facade = new Proxy(primarySocket, {
        get(target, property) {
          if (property === "__ptbSharedSocketFacade") return true;

          if (property === "on") {
            return (event, handler) => {
              target.on(event, handler);

              // Avec forceNew, l'ancien code recevait forcément un futur
              // événement "connect". Avec une socket partagée, cet événement
              // a pu se produire avant le chargement du module.
              if (
                event === "connect" &&
                target.connected &&
                typeof handler === "function"
              ) {
                queueMicrotask(() => {
                  if (target.connected) handler();
                });
              }

              return facade;
            };
          }

          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },

        set(target, property, value) {
          return Reflect.set(target, property, value, target);
        }
      });

      return facade;
    };

    const sharedIo = new Proxy(nativeIo, {
      apply(target, thisArg, args) {
        const onlyOptions =
          args.length === 1 &&
          args[0] &&
          typeof args[0] === "object" &&
          !Array.isArray(args[0]);

        if (onlyOptions && args[0].forceNew === true) {
          return makeFacade();
        }

        return Reflect.apply(target, thisArg, args);
      },

      get(target, property, receiver) {
        if (property === "__ptbSharedSocketCompat") return true;
        return Reflect.get(target, property, receiver);
      }
    });

    window.io = sharedIo;
    window.PtitBacSharedSocket = primarySocket;
  }

  installSharedSocketCompatibility();

  function isLegacyPhotoAvatar(value) {
    const avatar = String(value || "").trim();
    return /^data:image\//i.test(avatar) || /^blob:/i.test(avatar);
  }

  function sanitizeAvatar(value) {
    const avatar = String(value || "").trim();
    return !avatar || isLegacyPhotoAvatar(avatar) ? DEFAULT_AVATAR : avatar;
  }

  // One-time migration: old imported photos are replaced locally by the default game avatar.
  const storedAvatar = localStorage.getItem("petitbac_profile_icon");
  if (isLegacyPhotoAvatar(storedAvatar)) {
    localStorage.setItem("petitbac_profile_icon", DEFAULT_AVATAR);
  }

  // Enforce the "game avatars only" rule everywhere without keeping the old photo database.
  const originalGetProfile =
    typeof window.getProfile === "function"
      ? window.getProfile
      : (typeof getProfile === "function" ? getProfile : null);

  if (originalGetProfile) {
    const safeGetProfile = function () {
      const profile = originalGetProfile();
      return {
        ...profile,
        icon: sanitizeAvatar(profile?.icon)
      };
    };

    window.getProfile = safeGetProfile;
    try { getProfile = safeGetProfile; } catch {}
  }

  const originalSaveProfile =
    typeof window.saveProfile === "function"
      ? window.saveProfile
      : (typeof saveProfile === "function" ? saveProfile : null);

  if (originalSaveProfile) {
    const safeSaveProfile = function (name, icon) {
      return originalSaveProfile(name, sanitizeAvatar(icon));
    };

    window.saveProfile = safeSaveProfile;
    try { saveProfile = safeSaveProfile; } catch {}
  }

  // Temporary asset bridge while the lobby module is being consolidated.
  // Current GitHub only contains difficulty.png, while the V5 lobby still asks
  // for difficulty-easy/normal/hard.png.
  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    const src = String(image.getAttribute("src") || "");

    if (/\/difficulty-(?:easy|normal|hard)\.png(?:\?.*)?$/i.test(src)) {
      if (image.dataset.ptbFallbackApplied === "1") return;
      image.dataset.ptbFallbackApplied = "1";
      image.src = "/difficulty.png";
      return;
    }

    // A few dormant legacy renderers inside app.js still reference the old logo name.
    if (/\/?ptit-bac-logo-v2\.png(?:\?.*)?$/i.test(src)) {
      if (image.dataset.ptbFallbackApplied === "1") return;
      image.dataset.ptbFallbackApplied = "1";
      image.src = "/ptitbac.logo.png";
    }
  }, true);

  window.PtitBacRuntimeCompat = Object.freeze({
    sanitizeAvatar,
    isLegacyPhotoAvatar,
    sharedSocket: () => window.PtitBacSharedSocket || null
  });
})();

/* =========================================================
   P'tit Bac — Inventaire serveur V2
   PostgreSQL = source de vérité ; localStorage = cache visuel.
   ========================================================= */
(() => {
  "use strict";

  const STORAGE_KEY = "petitbac_inventory_v1";
  const BASE_AVATARS = ["/a1.webp", "/a2.webp", "/a3.webp", "/a4.webp", "/a5.webp"];

  // Infrastructure conservée : de nouveaux cadres pourront être ajoutés plus tard.
  const FRAMES = Object.freeze({});

  const TAGS = Object.freeze({
    tag_debutant: { id:"tag_debutant", name:"Débutant", icon:"🌱", className:"inv-tag-starter" }
  });

  let serverState = null;
  let loadingPromise = null;

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    })[char]);
  }

  function walletToken() {
    return String(localStorage.getItem("petitbac_walletToken") || "").trim();
  }

  function legacyEquipped() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        avatar: String(raw?.equipped?.avatar || localStorage.getItem("petitbac_profile_icon") || BASE_AVATARS[0]),
        frame: String(raw?.equipped?.frame || ""),
        tag: String(raw?.equipped?.tag || "tag_debutant")
      };
    } catch {
      return {
        avatar: String(localStorage.getItem("petitbac_profile_icon") || BASE_AVATARS[0]),
        frame: "",
        tag: "tag_debutant"
      };
    }
  }

  function purgeDeprecatedLocalCosmetics() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return;
      raw.owned = raw.owned && typeof raw.owned === "object" ? raw.owned : {};
      raw.equipped = raw.equipped && typeof raw.equipped === "object" ? raw.equipped : {};
      raw.owned.frames = [];
      raw.owned.tags = ["tag_debutant"];
      raw.equipped.frame = "";
      raw.equipped.tag = raw.equipped.tag === "" ? "" : "tag_debutant";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    } catch {}
  }

  purgeDeprecatedLocalCosmetics();

  function normalizeState(value) {
    const owned = value?.owned || {};
    const equipped = value?.equipped || {};
    const avatars = Array.isArray(owned.avatars)
      ? owned.avatars.filter(id => BASE_AVATARS.includes(id))
      : [...BASE_AVATARS];
    const frames = Array.isArray(owned.frames)
      ? owned.frames.filter(id => FRAMES[id])
      : [];
    const tags = Array.isArray(owned.tags)
      ? owned.tags.filter(id => TAGS[id])
      : ["tag_debutant"];

    return {
      owned: {
        avatars: [...new Set(avatars)],
        frames: [...new Set(frames)],
        tags: [...new Set(tags)]
      },
      equipped: {
        avatar: avatars.includes(equipped.avatar) ? equipped.avatar : (avatars[0] || BASE_AVATARS[0]),
        frame: frames.includes(equipped.frame) ? equipped.frame : "",
        tag: equipped.tag === "" || tags.includes(equipped.tag) ? String(equipped.tag || "") : (tags[0] || "")
      }
    };
  }

  function cacheState(value) {
    serverState = normalizeState(value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverState));

    if (serverState.equipped.avatar) {
      const name = localStorage.getItem("petitbac_profile_name") || "Joueur";
      try {
        if (typeof saveProfile === "function") saveProfile(name, serverState.equipped.avatar);
        else localStorage.setItem("petitbac_profile_icon", serverState.equipped.avatar);
      } catch {
        localStorage.setItem("petitbac_profile_icon", serverState.equipped.avatar);
      }
    }

    document.dispatchEvent(new CustomEvent("ptitbac:inventory-changed", {
      detail: { source:"server" }
    }));

    return serverState;
  }

  function fallbackState() {
    if (serverState) return normalizeState(serverState);
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch {
      return normalizeState(null);
    }
  }

  function requestState({ force = false } = {}) {
    if (!force && serverState) return Promise.resolve(normalizeState(serverState));
    if (loadingPromise) return loadingPromise;

    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      return Promise.reject(new Error("Connexion inventaire indisponible."));
    }

    loadingPromise = new Promise((resolve, reject) => {
      socket.timeout(8000).emit("inventory:get", {
        walletToken: token,
        legacyEquipped: legacyEquipped()
      }, (err, res) => {
        loadingPromise = null;
        if (err || !res?.ok || !res.state) {
          reject(new Error(res?.error || "Inventaire indisponible."));
          return;
        }
        resolve(cacheState(res.state));
      });
    });

    return loadingPromise;
  }

  function profileName() {
    try {
      return String(typeof getProfile === "function" ? getProfile()?.name || "Joueur" : "Joueur");
    } catch {
      return String(localStorage.getItem("petitbac_profile_name") || "Joueur");
    }
  }

  function frameMarkup(frameId, extraClass = "") {
    const frame = FRAMES[frameId];
    if (!frame) return "";
    return `<span class="inv-frame ${frame.className} ${esc(extraClass)}" aria-hidden="true"></span>`;
  }

  function tagMarkup(tagId, extraClass = "") {
    const tag = TAGS[tagId];
    if (!tag) return "";
    return `<span class="inv-tag ${tag.className} ${esc(extraClass)}"><span aria-hidden="true">${tag.icon}</span><strong>${esc(tag.name)}</strong></span>`;
  }

  function inventoryHtml(state) {
    const equippedAvatar = state.equipped.avatar || BASE_AVATARS[0];

    return `
      <section class="inventory-v1" aria-label="Inventaire">
        <section class="inventory-v1-preview" aria-label="Aperçu du joueur">
          <div class="inventory-v1-preview-avatar">
            <img src="${esc(equippedAvatar)}" alt="" draggable="false">
            ${frameMarkup(state.equipped.frame, "inv-frame-preview")}
          </div>
          <div class="inventory-v1-preview-copy">
            <small>Aperçu du joueur</small>
            <strong>${esc(profileName())}</strong>
            ${state.equipped.tag ? tagMarkup(state.equipped.tag, "inv-tag-preview") : '<span class="inventory-v1-no-tag">Aucun tag équipé</span>'}
          </div>
        </section>

        <section class="inventory-v1-section">
          <div class="inventory-v1-section-head">
            <div><span class="inventory-v1-section-icon"><img src="/profile-icon.png" alt=""></span><h3>Choix de l’avatar</h3></div>
            <small>${state.owned.avatars.length} possédés</small>
          </div>
          <div class="inventory-v1-avatar-grid">
            ${state.owned.avatars.map((avatar, index) => {
              const selected = avatar === equippedAvatar;
              return `<button class="inventory-v1-avatar-choice ${selected ? "is-selected" : ""}" type="button" data-server-inventory-type="avatar" data-server-inventory-id="${esc(avatar)}" aria-label="Équiper l’avatar ${index + 1}" aria-pressed="${selected}"><img src="${esc(avatar)}" alt=""><span class="inventory-v1-check">✓</span></button>`;
            }).join("")}
          </div>
        </section>

        <section class="inventory-v1-section">
          <div class="inventory-v1-section-head">
            <div><span class="inventory-v1-section-icon"><img src="/inventaire.png" alt=""></span><h3>Choix du cadre</h3></div>
            <small>${state.owned.frames.length} possédé${state.owned.frames.length > 1 ? "s" : ""}</small>
          </div>
          <div class="inventory-v1-frame-grid">
            <button class="inventory-v1-frame-choice is-empty ${state.equipped.frame === "" ? "is-selected" : ""}" type="button" data-server-inventory-type="frame" data-server-inventory-id="" aria-pressed="${state.equipped.frame === ""}"><span class="inventory-v1-frame-swatch"><i></i></span><strong>Sans cadre</strong><span class="inventory-v1-check">✓</span></button>
            ${state.owned.frames.map(frameId => {
              const frame = FRAMES[frameId];
              if (!frame) return "";
              const selected = state.equipped.frame === frameId;
              return `<button class="inventory-v1-frame-choice ${selected ? "is-selected" : ""}" type="button" data-server-inventory-type="frame" data-server-inventory-id="${esc(frameId)}" aria-pressed="${selected}"><span class="inventory-v1-frame-swatch"><img src="${esc(equippedAvatar)}" alt="">${frameMarkup(frameId, "inv-frame-mini")}</span><strong>${esc(frame.name)}</strong><span class="inventory-v1-check">✓</span></button>`;
            }).join("")}
          </div>
        </section>

        <section class="inventory-v1-section inventory-v1-tags">
          <div class="inventory-v1-section-head">
            <div><span class="inventory-v1-section-icon"><img src="/rewards.png" alt=""></span><h3>Choix du tag</h3></div>
            <small>${state.owned.tags.length} possédé${state.owned.tags.length > 1 ? "s" : ""}</small>
          </div>
          <div class="inventory-v1-tag-grid">
            <button class="inventory-v1-tag-choice is-none ${state.equipped.tag === "" ? "is-selected" : ""}" type="button" data-server-inventory-type="tag" data-server-inventory-id="" aria-pressed="${state.equipped.tag === ""}">Aucun tag<span class="inventory-v1-check">✓</span></button>
            ${state.owned.tags.map(tagId => {
              const tag = TAGS[tagId];
              if (!tag) return "";
              const selected = state.equipped.tag === tagId;
              return `<button class="inventory-v1-tag-choice ${tag.className} ${selected ? "is-selected" : ""}" type="button" data-server-inventory-type="tag" data-server-inventory-id="${esc(tagId)}" aria-pressed="${selected}"><span aria-hidden="true">${tag.icon}</span><strong>${esc(tag.name)}</strong><span class="inventory-v1-check">✓</span></button>`;
            }).join("")}
          </div>
        </section>
      </section>`;
  }

  function showToast(message) {
    try {
      if (typeof toast === "function") return toast(message);
    } catch {}
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._inventoryServerTimer);
    el._inventoryServerTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function bindInventory(dialog, state) {
    dialog.querySelectorAll("[data-server-inventory-type]").forEach(button => {
      button.addEventListener("click", () => {
        const type = String(button.dataset.serverInventoryType || "");
        const id = String(button.dataset.serverInventoryId || "");
        const token = walletToken();
        if (!token || button.disabled) return;

        dialog.querySelectorAll("[data-server-inventory-type]").forEach(el => { el.disabled = true; });

        socket.timeout(8000).emit("inventory:equip", {
          walletToken: token,
          type,
          id
        }, (err, res) => {
          if (err || !res?.ok || !res.state) {
            showToast(res?.error || "Impossible d’équiper cet objet.");
            renderInto(dialog, state);
            return;
          }

          const next = cacheState(res.state);
          renderInto(dialog, next);
        });
      });
    });
  }

  function renderInto(dialog, state) {
    const content = dialog?.querySelector("#homeDetailContent");
    if (!content) return;
    content.innerHTML = inventoryHtml(normalizeState(state));
    bindInventory(dialog, normalizeState(state));
  }

  async function openInventory() {
    const dialog = document.getElementById("homeDetailDialog");
    if (!dialog) return showToast("Inventaire indisponible.");

    dialog.classList.add("inventory-v1-dialog");
    const backButton = dialog.querySelector(".hm-close");
    if (backButton) {
      backButton.classList.add("inventory-v1-back");
      backButton.setAttribute("aria-label", "Retour");
      backButton.innerHTML = '<img src="/back-arrow.png" alt="">';
    }

    const content = dialog.querySelector("#homeDetailContent");
    if (content) content.innerHTML = '<div class="inventory-v1-server-loading" role="status">Chargement de ton inventaire…</div>';
    if (!dialog.open) dialog.showModal();

    try {
      renderInto(dialog, await requestState({ force:true }));
    } catch (err) {
      if (content) {
        content.innerHTML = `<div class="inventory-v1-server-loading" role="status"><strong>Inventaire indisponible</strong><small>${esc(err.message || "Réessaie dans un instant.")}</small></div>`;
      }
    }

    const onClose = () => {
      dialog.classList.remove("inventory-v1-dialog");
      if (backButton) {
        backButton.classList.remove("inventory-v1-back");
        backButton.setAttribute("aria-label", "Fermer");
        backButton.textContent = "×";
      }
      dialog.removeEventListener("close", onClose);
    };
    dialog.addEventListener("close", onClose);
  }

  function hasItem(type, id) {
    const state = fallbackState();
    const bucket = type === "avatar" ? "avatars" : type === "frame" ? "frames" : type === "tag" ? "tags" : "";
    return !!bucket && state.owned[bucket].includes(id);
  }

  function lockPublicApi() {
    const old = window.PtitBacInventory || {};
    window.PtitBacInventory = {
      ...old,
      open: openInventory,
      state: fallbackState,
      hasItem,
      grantItem() {
        console.warn("Inventaire V2: grantItem côté client est désactivé.");
        return false;
      },
      equipItem() {
        console.warn("Inventaire V2: utilise l’équipement serveur.");
        return false;
      },
      frames: FRAMES,
      tags: TAGS,
      serverManaged: true,
      refresh: () => requestState({ force:true })
    };
  }

  // Window est traversé avant document en phase capture : ce listener prend la
  // priorité sur l'ancien prototype local présent dans avatar-pages-fix-v1.js.
  window.addEventListener("click", event => {
    const trigger = event.target?.closest?.("#homeInventory");
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openInventory();
  }, true);

  function warm(attempt = 0) {
    if (walletToken() && typeof socket !== "undefined" && socket?.connected) {
      requestState().catch(() => {});
      return;
    }
    if (attempt < 20) setTimeout(() => warm(attempt + 1), 500);
  }

  try {
    socket?.on?.("connect", () => setTimeout(() => warm(0), 80));
    socket?.on?.("inventory:update", state => {
      if (state) cacheState(state);
    });
  } catch {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      lockPublicApi();
      warm(0);
    }, { once:true });
  } else {
    lockPublicApi();
    warm(0);
  }
})();
