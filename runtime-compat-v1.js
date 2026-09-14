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
