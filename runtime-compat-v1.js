(() => {
  "use strict";

  const FALLBACK_AVATAR = "/a1.webp";

  function isLegacyPhotoAvatar(value) {
    const avatar = String(value || "").trim();
    return /^data:image\//i.test(avatar) || /^blob:/i.test(avatar);
  }

  // API de compatibilité minimale pour les très anciens appels encore présents.
  // La normalisation réelle des avatars appartient désormais à avatar-system-v1.js.
  function sanitizeAvatar(value) {
    if (window.PtitBacAvatars?.normalize) {
      return window.PtitBacAvatars.normalize(value);
    }

    const avatar = String(value || "").trim();
    return !avatar || isLegacyPhotoAvatar(avatar)
      ? FALLBACK_AVATAR
      : avatar;
  }

  // Filet de sécurité temporaire pour d'anciens renderers dormants.
  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    const src = String(image.getAttribute("src") || "");
    if (!/\/?ptit-bac-logo-v2\.png(?:\?.*)?$/i.test(src)) return;
    if (image.dataset.ptbFallbackApplied === "1") return;

    image.dataset.ptbFallbackApplied = "1";
    image.src = "/ptitbac.logo.png";
  }, true);

  window.PtitBacRuntimeCompat = Object.freeze({
    sanitizeAvatar,
    isLegacyPhotoAvatar
  });
})();
