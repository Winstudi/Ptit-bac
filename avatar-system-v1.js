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

  function normalize(value) {
    const raw = String(value || "").trim();

    if (BASE_AVATARS.includes(raw)) {
      return raw;
    }

    if (LEGACY_AVATARS[raw]) {
      return LEGACY_AVATARS[raw];
    }

    return DEFAULT_AVATAR;
  }

  function isBaseAvatar(value) {
    const raw = String(value || "").trim();

    return (
      BASE_AVATARS.includes(raw) ||
      Object.prototype.hasOwnProperty.call(
        LEGACY_AVATARS,
        raw
      )
    );
  }

  function isImageAvatar(value) {
    return isBaseAvatar(value);
  }

  function markup(value, className = "", alt = "") {
    const avatar = normalize(value);

    const safeClass =
      String(className || "")
        .replace(/[^a-zA-Z0-9 _-]/g, "");

    const safeAlt =
      String(alt || "")
        .replace(/"/g, "&quot;");

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
    isBaseAvatar,
    isImageAvatar,
    markup
  };

  // Les écrans Amis / Chat / Lobby utilisent déjà ce hook.
  window.PtitBacProfilePhoto = {
    ...(window.PtitBacProfilePhoto || {}),
    isImageAvatar
  };

  // Migration du joueur local.
  try {
    const current =
      localStorage.getItem("petitbac_profile_icon");

    const migrated = normalize(current);

    if (current !== migrated) {
      localStorage.setItem(
        "petitbac_profile_icon",
        migrated
      );
    }
  } catch {}

  // Compatibilité avec les helpers historiques.
  try {
    const oldGetProfile =
      typeof getProfile === "function"
        ? getProfile
        : null;

    if (oldGetProfile) {
      getProfile = function() {
        const profile =
          oldGetProfile() || {};

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
        return oldSaveProfile(
          name,
          normalize(icon)
        );
      };
    }
  } catch {}

  // Les anciens avatars peuvent encore exister dans des données déjà
  // enregistrées en base. On ne les affiche plus : l'interface bascule
  // automatiquement sur un avatar de base.
  const AVATAR_CONTAINERS = [
    ".hm-avatar",
    ".profile-v10-avatar-visual",
    ".friends-v2-avatar",
    ".friends-v3-avatar",
    ".chat-list-avatar",
    ".chat-header-avatar",
    ".lobby-v5-avatar",
    ".lobby-v5-host-avatar",
    ".lobby-v5-profile-avatar",
    ".lobby-v5-invite-friend-avatar",
    ".pl-avatar"
  ].join(",");

  function upgradeContainer(container) {
    if (!container) return;

    const image =
      container.querySelector(":scope > img");

    if (image) {
      const current =
        image.getAttribute("src") || "";

      const next =
        normalize(current);

      if (current !== next) {
        image.setAttribute("src", next);
      }

      image.setAttribute(
        "draggable",
        "false"
      );

      return;
    }

    const legacy =
      container.querySelector(":scope > span");

    if (!legacy) return;

    const imageNode =
      document.createElement("img");

    imageNode.src =
      normalize(legacy.textContent);

    imageNode.alt = "";
    imageNode.draggable = false;

    legacy.replaceWith(imageNode);
  }

  function upgradeAvatars(root = document) {
    if (
      root instanceof Element &&
      root.matches(AVATAR_CONTAINERS)
    ) {
      upgradeContainer(root);
    }

    root
      .querySelectorAll?.(AVATAR_CONTAINERS)
      .forEach(upgradeContainer);
  }

  function startUpgradeObserver() {
    upgradeAvatars(document);

    const observer =
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) {
              continue;
            }

            upgradeAvatars(node);
          }
        }
      });

    observer.observe(
      document.documentElement,
      {
        childList:true,
        subtree:true
      }
    );
  }

  // Les écrans de partie définis dans app.js utilisent ce helper global.
  // On convertit aussi leurs anciens avatars sans toucher au reste du rendu.
  try {
    if (typeof avatarMarkup === "function") {
      avatarMarkup =
        function(player, index = 0, extra = "") {
          const safeExtra =
            String(extra || "")
              .replace(
                /[^a-zA-Z0-9 _-]/g,
                ""
              );

          const avatar =
            normalize(player?.avatar);

          return `
            <div
              class="avatar avatar-${index % 6}
                     ptb-avatar-photo ${safeExtra}"
            >
              <img
                src="${avatar}"
                alt=""
                draggable="false"
              >
            </div>
          `;
        };
    }
  } catch {}

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      startUpgradeObserver,
      { once:true }
    );
  } else {
    startUpgradeObserver();
  }
})();
