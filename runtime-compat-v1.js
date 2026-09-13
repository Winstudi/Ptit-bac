(() => {
  "use strict";

  const DEFAULT_AVATAR = "🧠";

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
    isLegacyPhotoAvatar
  });
})();
