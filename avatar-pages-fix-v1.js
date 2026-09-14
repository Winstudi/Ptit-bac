(() => {
  "use strict";

  const BASE = [
    "/a1.webp",
    "/a2.webp",
    "/a3.webp",
    "/a4.webp",
    "/a5.webp"
  ];

  const LEGACY = {
    "/avatar-base-01.webp": "/a1.webp",
    "/avatar-base-02.webp": "/a2.webp",
    "/avatar-base-03.webp": "/a3.webp",
    "/avatar-base-04.webp": "/a4.webp",
    "/avatar-base-05.webp": "/a5.webp"
  };

  const AVATAR_BOXES = [
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

  function hashSeed(value) {
    const text = String(value || "ptitbac-avatar");
    let hash = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return Math.abs(hash >>> 0);
  }

  function normalizeAvatar(value, seed = "") {
    const raw = String(value || "").trim();

    if (BASE.includes(raw)) {
      return raw;
    }

    if (LEGACY[raw]) {
      return LEGACY[raw];
    }

    const key = seed || raw || "ptitbac-avatar";
    return BASE[hashSeed(key) % BASE.length];
  }

  function directAvatarValue(box) {
    const img = box.querySelector(":scope > img");

    if (img) {
      return img.getAttribute("src") || "";
    }

    const span = box.querySelector(":scope > span");

    if (span) {
      return span.textContent || "";
    }

    if (box.matches(".avatar-emoji")) {
      return box.textContent || "";
    }

    return "";
  }

  function nearbyPlayerSeed(box) {
    const row =
      box.closest(
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

    const name =
      row?.querySelector(
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
    const image =
      document.createElement("img");

    image.src = src;
    image.alt = "";
    image.draggable = false;

    const oldImg =
      box.querySelector(":scope > img");

    const oldSpan =
      box.querySelector(":scope > span");

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
    if (!(box instanceof Element)) {
      return;
    }

    const raw =
      directAvatarValue(box);

    const seed =
      nearbyPlayerSeed(box) ||
      raw ||
      box.className;

    const src =
      normalizeAvatar(raw, seed);

    const existing =
      box.querySelector(":scope > img");

    if (
      existing &&
      existing.getAttribute("src") === src
    ) {
      existing.draggable = false;
      box.classList.add("ptb-base-avatar");
      return;
    }

    setAvatarImage(box, src);
  }

  function chooserPlayer() {
    try {
      const state =
        session?.state;

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
    const box =
      document.querySelector(
        ".pbw1-screen .pbw1-chooser .pbw1-lightning"
      );

    if (!box) return;

    const chooser =
      chooserPlayer();

    const seed =
      chooser?.id ||
      chooser?.name ||
      "letter-chooser";

    const src =
      normalizeAvatar(
        chooser?.avatar,
        seed
      );

    const current =
      box.querySelector(":scope > img");

    if (
      current &&
      current.getAttribute("src") === src &&
      box.classList.contains("pbw1-chooser-avatar")
    ) {
      return;
    }

    box.classList.add(
      "pbw1-chooser-avatar"
    );

    box.innerHTML =
      `<img src="${src}" alt="" draggable="false">`;
  }

  function upgradeAll(root = document) {
    if (
      root instanceof Element &&
      root.matches(AVATAR_BOXES)
    ) {
      upgradeAvatarBox(root);
    }

    root
      .querySelectorAll?.(AVATAR_BOXES)
      .forEach(upgradeAvatarBox);

    upgradeWheelChooser();
  }

  function start() {
    upgradeAll(document);

    const observer =
      new MutationObserver(records => {
        let shouldCheckWheel = false;

        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) {
              continue;
            }

            upgradeAll(node);
            shouldCheckWheel = true;
          }
        }

        if (shouldCheckWheel) {
          upgradeWheelChooser();
        }
      });

    observer.observe(
      document.documentElement,
      {
        childList:true,
        subtree:true
      }
    );

    // Les room:state peuvent mettre à jour le joueur désigné
    // sans recréer immédiatement toute la page.
    try {
      socket?.on?.(
        "room:state",
        () => requestAnimationFrame(
          upgradeWheelChooser
        )
      );
    } catch {}
  }

  window.PtitBacAvatarPagesFix = {
    normalizeAvatar,
    upgradeAll,
    upgradeWheelChooser
  };

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once:true }
    );
  } else {
    start();
  }
})();
