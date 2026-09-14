(() => {
  "use strict";

  const BASE_AVATARS = Object.freeze(["/avatar-base-01.webp", "/avatar-base-02.webp", "/avatar-base-03.webp", "/avatar-base-04.webp", "/avatar-base-05.webp"]);
  const DEFAULT_AVATAR = BASE_AVATARS[0];

  function normalize(value) {
    const avatar = String(value || "").trim();
    return BASE_AVATARS.includes(avatar)
      ? avatar
      : DEFAULT_AVATAR;
  }

  function isBaseAvatar(value) {
    return BASE_AVATARS.includes(String(value || "").trim());
  }

  function isImageAvatar(value) {
    return isBaseAvatar(value);
  }

  function markup(value, className = "", alt = "") {
    const avatar = normalize(value);
    const safeClass = String(className || "")
      .replace(/[^a-zA-Z0-9 _-]/g, "");

    return `<img class="${safeClass}" src="${avatar}" alt="${String(alt || "").replace(/"/g, "&quot;")}" draggable="false">`;
  }

  window.PtitBacAvatars = {
    list: BASE_AVATARS,
    defaultAvatar: DEFAULT_AVATAR,
    normalize,
    isBaseAvatar,
    isImageAvatar,
    markup
  };

  // Compatibilité avec les écrans Amis / Chat / Lobby qui utilisent déjà ce hook.
  window.PtitBacProfilePhoto = {
    ...(window.PtitBacProfilePhoto || {}),
    isImageAvatar
  };

  // Migration automatique : les anciens emojis / anciennes photos
  // sont remplacés par le premier avatar de base.
  try {
    const current = localStorage.getItem("petitbac_profile_icon");
    if (!isBaseAvatar(current)) {
      localStorage.setItem("petitbac_profile_icon", DEFAULT_AVATAR);
    }
  } catch {}

  // Rend les helpers historiques compatibles avec les nouveaux avatars.
  try {
    const oldGetProfile =
      typeof getProfile === "function"
        ? getProfile
        : null;

    if (oldGetProfile) {
      getProfile = function() {
        const profile = oldGetProfile() || {};
        return {
          ...profile,
          icon: normalize(profile.icon)
        };
      };
    }
  } catch {}

  try {
    const oldSaveProfile =
      typeof saveProfile === "function"
        ? saveProfile
        : null;

    if (oldSaveProfile) {
      saveProfile = function(name, icon) {
        return oldSaveProfile(name, normalize(icon));
      };
    }
  } catch {}

  try {
    if (typeof avatarMarkup === "function") {
      avatarMarkup = function(player, index = 0, extra = "") {
        const raw = String(player?.avatar || "");
        const safeExtra = String(extra || "")
          .replace(/[^a-zA-Z0-9 _-]/g, "");

        if (isBaseAvatar(raw)) {
          return `
            <div class="avatar avatar-${index % 6} ptb-avatar-photo ${safeExtra}">
              <img src="${raw}" alt="" draggable="false">
            </div>`;
        }

        const fallback =
          raw ||
          String(player?.name || "?")
            .charAt(0)
            .toUpperCase();

        return `
          <div class="avatar avatar-${index % 6} avatar-emoji ${safeExtra}">
            ${typeof escapeHtml === "function" ? escapeHtml(fallback) : fallback}
          </div>`;
      };
    }
  } catch {}
})();
