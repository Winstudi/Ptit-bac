(() => {
  "use strict";

  const BASE_AVATARS = Object.freeze([
    "/a1.webp",
    "/a2.webp",
    "/a3.webp",
    "/a4.webp",
    "/a5.webp"
  ]);

  const LEGACY_AVATARS = Object.freeze({
    "/avatar-base-01.webp": "/a1.webp",
    "/avatar-base-02.webp": "/a2.webp",
    "/avatar-base-03.webp": "/a3.webp",
    "/avatar-base-04.webp": "/a4.webp",
    "/avatar-base-05.webp": "/a5.webp"
  });

  const DEFAULT_AVATAR = BASE_AVATARS[0];

  function hashSeed(value) {
    const text = String(value || "ptitbac-avatar");
    let hash = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return Math.abs(hash >>> 0);
  }

  function normalize(value, seed = "") {
    const raw = String(value || "").trim();

    if (BASE_AVATARS.includes(raw)) return raw;
    if (LEGACY_AVATARS[raw]) return LEGACY_AVATARS[raw];

    const key = seed || raw || "ptitbac-avatar";
    return BASE_AVATARS[hashSeed(key) % BASE_AVATARS.length];
  }

  function isBaseAvatar(value) {
    const raw = String(value || "").trim();
    return BASE_AVATARS.includes(raw) ||
      Object.prototype.hasOwnProperty.call(LEGACY_AVATARS, raw);
  }

  function isImageAvatar(value) {
    return isBaseAvatar(value);
  }

  function markup(value, className = "", alt = "", seed = "") {
    const avatar = normalize(value, seed);
    const safeClass = String(className || "").replace(/[^a-zA-Z0-9 _-]/g, "");
    const safeAlt = String(alt || "").replace(/"/g, "&quot;");

    return (
      `<img class="${safeClass}" ` +
      `src="${avatar}" ` +
      `alt="${safeAlt}" ` +
      `draggable="false">`
    );
  }

  window.PtitBacAvatars = {
    list: BASE_AVATARS,
    defaultAvatar: DEFAULT_AVATAR,
    normalize,
    normalizeAvatar: normalize,
    isBaseAvatar,
    isImageAvatar,
    markup
  };

  // Compatibilité Amis / Chat / Lobby.
  window.PtitBacProfilePhoto = {
    ...(window.PtitBacProfilePhoto || {}),
    isImageAvatar
  };

  // Migration locale unique : ancien emoji/photo/ancien nom -> avatar de base.
  try {
    const current = localStorage.getItem("petitbac_profile_icon");
    const name = localStorage.getItem("petitbac_profile_name") || "";
    const migrated = normalize(current, name || current);

    if (current !== migrated) {
      localStorage.setItem("petitbac_profile_icon", migrated);
    }
  } catch {}

  // Les helpers historiques restent utilisables mais passent désormais
  // tous par le même normaliseur.
  try {
    const oldGetProfile =
      typeof getProfile === "function"
        ? getProfile
        : null;

    if (oldGetProfile && !oldGetProfile.__ptbUnifiedAvatar) {
      const unifiedGetProfile = function() {
        const profile = oldGetProfile() || {};
        return {
          ...profile,
          icon: normalize(profile.icon, profile.name || profile.icon)
        };
      };
      unifiedGetProfile.__ptbUnifiedAvatar = true;
      getProfile = unifiedGetProfile;
      window.getProfile = unifiedGetProfile;
    }
  } catch {}

  try {
    const oldSaveProfile =
      typeof saveProfile === "function"
        ? saveProfile
        : null;

    if (oldSaveProfile && !oldSaveProfile.__ptbUnifiedAvatar) {
      const unifiedSaveProfile = function(name, icon) {
        return oldSaveProfile(name, normalize(icon, name || icon));
      };
      unifiedSaveProfile.__ptbUnifiedAvatar = true;
      saveProfile = unifiedSaveProfile;
      window.saveProfile = unifiedSaveProfile;
    }
  } catch {}

  const AVATAR_CONTAINERS = [
    ".hm-avatar",
    ".profile-v10-avatar-visual",
    ".profile-avatar-choice",
    ".friends-v2-avatar",
    ".friends-v3-avatar",
    ".chat-list-avatar",
    ".chat-header-avatar",
    ".lobby-v5-avatar",
    ".lobby-v5-host-avatar",
    ".lobby-v5-profile-avatar",
    ".lobby-v5-invite-friend-avatar",
    ".pl-avatar",
    ".wsv1-avatar",
    ".res-avatar",
    ".fin-avatar",
    ".ptb-avatar-photo",
    ".avatar-emoji"
  ].join(",");

  function directAvatarValue(box) {
    const img = box.querySelector(":scope > img");
    if (img) return img.getAttribute("src") || "";

    const span = box.querySelector(":scope > span");
    if (span) return span.textContent || "";

    if (box.matches(".avatar-emoji")) return box.textContent || "";
    return "";
  }

  function nearbyPlayerSeed(box) {
    const row = box.closest(
      ".wsv1-player," +
      ".res-row," +
      ".fin-row," +
      ".fin-podium-card," +
      ".lobby-v5-player," +
      ".pl-player," +
      ".friends-v4-card," +
      ".friends-v2-card," +
      ".chat-conversation-row," +
      ".chat-new-row"
    );

    const name = row?.querySelector(
      ".wsv1-player > strong," +
      ".res-player > strong," +
      ".fin-player > strong," +
      ".fin-podium-card > strong," +
      ".lobby-v5-player-copy strong," +
      ".pl-player-copy > strong," +
      ".friends-v2-card-main > strong," +
      ".chat-row-copy > strong," +
      "strong"
    )?.textContent || "";

    return String(name).trim();
  }

  function setAvatarImage(box, src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.draggable = false;

    const oldImg = box.querySelector(":scope > img");
    const oldSpan = box.querySelector(":scope > span");

    if (oldImg) {
      oldImg.replaceWith(image);
    } else if (oldSpan) {
      oldSpan.replaceWith(image);
    } else if (box.matches(".avatar-emoji")) {
      box.replaceChildren(image);
      box.classList.remove("avatar-emoji");
      box.classList.add("ptb-avatar-photo");
    } else {
      box.prepend(image);
    }

    box.classList.add("ptb-base-avatar");
  }

  function upgradeAvatarBox(box) {
    if (!(box instanceof Element)) return;

    const raw = directAvatarValue(box);
    const seed = nearbyPlayerSeed(box) || raw || box.className;
    const src = normalize(raw, seed);
    const existing = box.querySelector(":scope > img");

    if (existing && existing.getAttribute("src") === src) {
      existing.draggable = false;
      box.classList.add("ptb-base-avatar");
      return;
    }

    setAvatarImage(box, src);
  }

  function chooserPlayer() {
    try {
      const state = session?.state;
      if (!state) return null;

      return state.players?.find(
        player =>
          String(player.id) ===
          String(state.letterChooserPlayerId)
      ) || null;
    } catch {
      return null;
    }
  }

  function upgradeWheelChooser() {
    const box = document.querySelector(
      ".pbw1-screen .pbw1-chooser .pbw1-lightning"
    );
    if (!box) return;

    const chooser = chooserPlayer();
    const seed = chooser?.id || chooser?.name || "letter-chooser";
    const src = normalize(chooser?.avatar, seed);
    const current = box.querySelector(":scope > img");

    if (
      current &&
      current.getAttribute("src") === src &&
      box.classList.contains("pbw1-chooser-avatar")
    ) {
      return;
    }

    box.classList.add("pbw1-chooser-avatar");
    box.innerHTML = `<img src="${src}" alt="" draggable="false">`;
  }

  function upgradeAll(root = document) {
    if (root instanceof Element && root.matches(AVATAR_CONTAINERS)) {
      upgradeAvatarBox(root);
    }

    root.querySelectorAll?.(AVATAR_CONTAINERS).forEach(upgradeAvatarBox);
    upgradeWheelChooser();
  }

  let avatarUpgradeScheduled = false;

  function scheduleAvatarUpgrade() {
    if (avatarUpgradeScheduled) return;
    avatarUpgradeScheduled = true;

    requestAnimationFrame(() => {
      avatarUpgradeScheduled = false;
      upgradeAll(document);
    });
  }

  function start() {
    upgradeAll(document);

    document.addEventListener(
      "ptitbac:screen-rendered",
      scheduleAvatarUpgrade
    );

    document.addEventListener(
      "ptitbac:dom-updated",
      scheduleAvatarUpgrade
    );

    try {
      socket?.on?.("room:state", scheduleAvatarUpgrade);
    } catch {}
  }

  // Alias temporaire pour d'anciens appels. Aucun second observer n'est créé.
  window.PtitBacAvatarPagesFix = {
    normalizeAvatar: normalize,
    upgradeAll,
    upgradeWheelChooser
  };

  // Les écrans historiques de app.js passent aussi par ce moteur.
  try {
    if (typeof avatarMarkup === "function") {
      avatarMarkup = function(player, index = 0, extra = "") {
        const safeExtra = String(extra || "").replace(/[^a-zA-Z0-9 _-]/g, "");
        const seed = player?.id || player?.name || player?.avatar || "";
        const avatar = normalize(player?.avatar, seed);

        return `
          <div class="avatar avatar-${index % 6} ptb-avatar-photo ${safeExtra}">
            <img src="${avatar}" alt="" draggable="false">
          </div>
        `;
      };
      window.avatarMarkup = avatarMarkup;
    }
  } catch {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
