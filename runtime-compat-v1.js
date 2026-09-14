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

/* =========================================================
   P'tit Bac — Progression XP / niveaux V1
   Accueil : niveau + barre uniquement.
   Fin de partie : niveau + barre + XP gagné + animation level-up.
   ========================================================= */
(() => {
  "use strict";

  const CACHE_KEY = "petitbac_progression_v1";
  const shownLevelUps = new Set();
  let state = null;
  let lastAward = null;
  let requestPromise = null;
  let scheduled = false;

  function walletToken() {
    return String(
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function normalizeState(value) {
    if (!value || typeof value !== "object") return null;
    const level = Math.max(1, Math.min(50, Math.floor(Number(value.level) || 1)));
    return {
      level,
      totalXp: Math.max(0, Math.floor(Number(value.totalXp) || 0)),
      xpIntoLevel: Math.max(0, Math.floor(Number(value.xpIntoLevel) || 0)),
      xpForNext: Math.max(0, Math.floor(Number(value.xpForNext) || 0)),
      progress: Math.max(0, Math.min(1, Number(value.progress) || 0)),
      progressPercent: clampPercent(value.progressPercent),
      maxLevel: value.maxLevel === true || level >= 50,
      completedGames: Math.max(0, Math.floor(Number(value.completedGames) || 0)),
      wins: Math.max(0, Math.floor(Number(value.wins) || 0))
    };
  }

  function readCache() {
    if (state) return state;
    try {
      state = normalizeState(JSON.parse(localStorage.getItem(CACHE_KEY) || "null"));
    } catch {
      state = null;
    }
    return state;
  }

  function cacheState(value) {
    const clean = normalizeState(value);
    if (!clean) return null;
    state = clean;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch {}
    schedulePatch();
    return clean;
  }

  function requestState({ force = false } = {}) {
    if (!force && readCache()) return Promise.resolve(state);
    if (requestPromise) return requestPromise;

    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      return Promise.reject(new Error("Progression indisponible."));
    }

    requestPromise = new Promise((resolve, reject) => {
      socket.timeout(8000).emit("progression:get", { walletToken: token }, (err, res) => {
        requestPromise = null;
        if (err || !res?.ok || !res.state) {
          reject(new Error(res?.error || "Progression indisponible."));
          return;
        }
        resolve(cacheState(res.state));
      });
    });

    return requestPromise;
  }

  function styleOnce() {
    if (document.getElementById("ptbProgressionStyle")) return;

    const style = document.createElement("style");
    style.id = "ptbProgressionStyle";
    style.textContent = `
      .hm-profile-copy .ptb-home-xp-bar{
        width:82px;height:5px;margin-top:4px;overflow:hidden;
        border:1px solid rgba(149,101,255,.42);border-radius:999px;
        background:rgba(7,13,48,.78);box-shadow:inset 0 1px 4px rgba(0,0,0,.3)
      }
      .hm-profile-copy .ptb-home-xp-fill{
        display:block;width:0;height:100%;border-radius:inherit;
        background:linear-gradient(90deg,#7139ee,#c257ff);
        box-shadow:0 0 8px rgba(171,72,255,.55);
        transition:width .45s ease
      }
      .ptb-final-xp-card{
        width:min(100%,420px);margin:14px auto 12px;padding:13px 15px 14px;
        border:1px solid rgba(137,87,235,.52);border-radius:16px;
        background:linear-gradient(145deg,rgba(21,34,82,.94),rgba(19,19,63,.96));
        box-shadow:inset 0 0 18px rgba(126,69,231,.08),0 8px 22px rgba(0,0,0,.17)
      }
      .ptb-final-xp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
      .ptb-final-xp-head strong{color:#fff;font-size:.9rem;font-weight:900}
      .ptb-final-xp-gain{color:#c995ff;font-size:.76rem;font-weight:900}
      .ptb-final-xp-track{
        height:9px;overflow:hidden;border:1px solid rgba(155,107,255,.45);
        border-radius:999px;background:#09133b;box-shadow:inset 0 2px 5px rgba(0,0,0,.34)
      }
      .ptb-final-xp-fill{
        display:block;width:0;height:100%;border-radius:inherit;
        background:linear-gradient(90deg,#6938ea,#b348ff,#e66dff);
        box-shadow:0 0 12px rgba(176,67,255,.58);
        transition:width .8s cubic-bezier(.22,.8,.25,1)
      }
      .ptb-final-xp-card.is-level-up{
        animation:ptbXpCardPulse .8s ease both
      }
      .ptb-level-up-burst{
        position:fixed;z-index:99999;left:50%;top:44%;transform:translate(-50%,-50%) scale(.72);
        min-width:220px;padding:18px 24px;text-align:center;pointer-events:none;
        border:1px solid rgba(220,154,255,.9);border-radius:20px;
        background:radial-gradient(circle at 50% 0%,rgba(172,74,255,.35),transparent 58%),linear-gradient(180deg,#211866,#111744);
        box-shadow:0 0 28px rgba(179,76,255,.56),0 20px 55px rgba(0,0,0,.45);
        opacity:0;animation:ptbLevelBurst 1.7s ease forwards
      }
      .ptb-level-up-burst small{display:block;color:#d8b8ff;font-size:.68rem;font-weight:900;letter-spacing:.12em}
      .ptb-level-up-burst strong{display:block;margin-top:4px;color:#fff;font-size:1.55rem;font-weight:1000;text-shadow:0 0 14px rgba(218,127,255,.72)}
      .ptb-level-up-burst::before,.ptb-level-up-burst::after{
        content:"✦";position:absolute;color:#e5b5ff;font-size:1.4rem;animation:ptbStarSpin 1.5s ease both
      }
      .ptb-level-up-burst::before{left:16px;top:13px}.ptb-level-up-burst::after{right:16px;bottom:12px}
      @keyframes ptbXpCardPulse{0%,100%{transform:scale(1)}45%{transform:scale(1.025);box-shadow:0 0 24px rgba(175,76,255,.34)}}
      @keyframes ptbLevelBurst{0%{opacity:0;transform:translate(-50%,-50%) scale(.72)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}32%,72%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-58%) scale(.94)}}
      @keyframes ptbStarSpin{0%{opacity:0;transform:scale(.4) rotate(0)}30%,75%{opacity:1}100%{opacity:0;transform:scale(1.4) rotate(180deg)}}
    `;
    document.head.appendChild(style);
  }

  function patchHome() {
    const current = readCache();
    const copy = document.querySelector(".home-mobile .hm-profile-copy");
    if (!copy || !current) return;

    const level = copy.querySelector("small");
    if (level) {
      const nextLabel = String(current.level);
      if (level.textContent !== nextLabel) level.textContent = nextLabel;
      level.removeAttribute("title");
      level.setAttribute("aria-label", `Niveau ${current.level}`);
    }

    let bar = copy.querySelector(".ptb-home-xp-bar");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "ptb-home-xp-bar";
      bar.setAttribute("role", "progressbar");
      bar.innerHTML = '<i class="ptb-home-xp-fill"></i>';
      copy.appendChild(bar);
    }

    bar.setAttribute("aria-label", `Progression du niveau ${current.level}`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(current.progressPercent)));
    const fill = bar.querySelector(".ptb-home-xp-fill");
    if (fill) fill.style.width = `${current.progressPercent}%`;
  }

  function liveRoomState() {
    try {
      return typeof session !== "undefined" ? session?.state || null : null;
    } catch {
      return null;
    }
  }

  function burstLevelUp(level, eventKey) {
    if (!eventKey || shownLevelUps.has(eventKey)) return;
    shownLevelUps.add(eventKey);

    const old = document.querySelector(".ptb-level-up-burst");
    old?.remove();

    const burst = document.createElement("div");
    burst.className = "ptb-level-up-burst";
    burst.innerHTML = `<small>NIVEAU SUPÉRIEUR</small><strong>NIVEAU ${level} !</strong>`;
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 1900);
  }

  function animateFinalBar(card, current, award) {
    const fill = card.querySelector(".ptb-final-xp-fill");
    if (!fill || card.dataset.animated === "1") return;
    card.dataset.animated = "1";

    const afterPercent = clampPercent(current.progressPercent);
    const beforePercent = clampPercent(award?.before?.progressPercent ?? afterPercent);
    fill.style.transition = "none";
    fill.style.width = `${beforePercent}%`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.transition = "width .8s cubic-bezier(.22,.8,.25,1)";

        if (award?.levelUp) {
          card.classList.add("is-level-up");
          fill.style.width = "100%";
          setTimeout(() => {
            fill.style.transition = "none";
            fill.style.width = "0%";
            requestAnimationFrame(() => {
              fill.style.transition = "width .72s cubic-bezier(.22,.8,.25,1)";
              fill.style.width = `${afterPercent}%`;
            });
          }, 760);
          setTimeout(() => burstLevelUp(current.level, award.eventKey), 420);
        } else {
          fill.style.width = `${afterPercent}%`;
        }
      });
    });
  }

  function patchFinal() {
    const root = document.querySelector(".final-mobile");
    const current = readCache();
    if (!root || !current) return;

    const roomState = liveRoomState();
    const progressionEnabled = roomState?.progressionEnabled === true;
    const roomAward = roomState?.myProgression || null;
    const award = progressionEnabled
      ? roomAward
      : null;

    let card = root.querySelector(".ptb-final-xp-card");
    if (!card) {
      card = document.createElement("section");
      card.className = "ptb-final-xp-card";
      const actions = root.querySelector(".fin-actions");
      if (actions) actions.before(card);
      else root.appendChild(card);
    }

    const gainedXp = progressionEnabled
      ? Math.max(0, Number(award?.gainedXp) || 0)
      : 0;

    const signature = [
      current.level,
      Math.round(current.progressPercent * 100) / 100,
      gainedXp,
      award?.eventKey || "private"
    ].join(":");

    if (card.dataset.progressionSignature !== signature) {
      card.dataset.progressionSignature = signature;
      card.dataset.animated = "0";
      card.classList.remove("is-level-up");
      card.innerHTML = `
        <div class="ptb-final-xp-head">
          <strong>Niv. ${current.level}</strong>
          <span class="ptb-final-xp-gain">+${gainedXp} XP</span>
        </div>
        <div class="ptb-final-xp-track" role="progressbar"
             aria-label="Progression du niveau ${current.level}"
             aria-valuemin="0" aria-valuemax="100"
             aria-valuenow="${Math.round(current.progressPercent)}">
          <i class="ptb-final-xp-fill"></i>
        </div>`;
    }

    animateFinalBar(card, current, award);
  }

  function patch() {
    scheduled = false;
    styleOnce();
    patchHome();
    patchFinal();
  }

  function schedulePatch() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(patch);
  }

  function handleProgressionUpdate(payload) {
    if (!payload?.state) return;
    lastAward = payload.result && typeof payload.result === "object"
      ? payload.result
      : null;
    cacheState(payload.state);
  }

  function warm(attempt = 0) {
    if (walletToken() && typeof socket !== "undefined" && socket?.connected) {
      requestState({ force:true }).catch(() => {});
      return;
    }
    if (attempt < 20) setTimeout(() => warm(attempt + 1), 500);
  }

  function start() {
    styleOnce();
    readCache();

    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.documentElement, { childList:true, subtree:true });

    try {
      socket?.on?.("connect", () => setTimeout(() => warm(0), 100));
      socket?.on?.("progression:update", handleProgressionUpdate);
      socket?.on?.("room:state", room => {
        if (room?.myProgression?.after) {
          lastAward = room.myProgression;
          cacheState(room.myProgression.after);
        }
        schedulePatch();
      });
    } catch {}

    warm(0);
    schedulePatch();
  }

  window.PtitBacProgression = {
    state: () => normalizeState(readCache()),
    refresh: () => requestState({ force:true })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
  } else {
    start();
  }
})();
