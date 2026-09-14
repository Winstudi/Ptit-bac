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

/* =========================================================
   P'tit Bac — Inventaire V1
   Aperçu joueur + avatars + cadres + tags
   ========================================================= */
(() => {
  "use strict";

  const STORAGE_KEY = "petitbac_inventory_v1";
  const BASE_AVATARS = ["/a1.webp", "/a2.webp", "/a3.webp", "/a4.webp", "/a5.webp"];

  const FRAMES = Object.freeze({
    frame_purple_flame: {
      id: "frame_purple_flame",
      name: "Flamme violette",
      className: "inv-frame-purple-flame"
    },
    frame_ice: {
      id: "frame_ice",
      name: "Glace",
      className: "inv-frame-ice"
    },
    frame_gold: {
      id: "frame_gold",
      name: "Royal",
      className: "inv-frame-gold"
    },
    frame_nature: {
      id: "frame_nature",
      name: "Nature",
      className: "inv-frame-nature"
    }
  });

  const TAGS = Object.freeze({
    tag_debutant: {
      id: "tag_debutant",
      name: "Débutant",
      icon: "🌱",
      className: "inv-tag-starter"
    },
    tag_curieux: {
      id: "tag_curieux",
      name: "Curieux",
      icon: "💡",
      className: "inv-tag-curious"
    },
    tag_maitre_bac: {
      id: "tag_maitre_bac",
      name: "Maître du Bac",
      icon: "👑",
      className: "inv-tag-master"
    },
    tag_champion: {
      id: "tag_champion",
      name: "Champion",
      icon: "🏆",
      className: "inv-tag-champion"
    },
    tag_legende: {
      id: "tag_legende",
      name: "Légende",
      icon: "✦",
      className: "inv-tag-legend"
    }
  });

  function esc(value = "") {
    try {
      if (typeof escapeHtml === "function") return escapeHtml(value);
    } catch {}

    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    })[char]);
  }

  function avatars() {
    const list = window.PtitBacAvatars?.list;
    return Array.isArray(list) && list.length ? [...list] : [...BASE_AVATARS];
  }

  function normalizeAvatar(value) {
    if (window.PtitBacAvatars?.normalize) {
      return window.PtitBacAvatars.normalize(value);
    }

    const list = avatars();
    const raw = String(value || "").trim();
    return list.includes(raw) ? raw : list[0];
  }

  function profileNow() {
    try {
      if (typeof getProfile === "function") return getProfile();
    } catch {}

    return {
      name: localStorage.getItem("petitbac_profile_name") || "Joueur",
      icon: localStorage.getItem("petitbac_profile_icon") || avatars()[0]
    };
  }

  function defaultState() {
    return {
      owned: {
        avatars: avatars(),
        // Prototype : ce premier cadre est disponible afin de tester le système.
        frames: ["frame_purple_flame"],
        tags: ["tag_debutant"]
      },
      equipped: {
        avatar: normalizeAvatar(profileNow().icon),
        frame: "",
        tag: "tag_debutant"
      }
    };
  }

  function sanitize(raw) {
    const base = defaultState();
    const allAvatars = avatars();

    const ownedAvatars = Array.isArray(raw?.owned?.avatars)
      ? raw.owned.avatars.map(normalizeAvatar)
      : [...base.owned.avatars];

    allAvatars.forEach(avatar => {
      if (!ownedAvatars.includes(avatar)) ownedAvatars.push(avatar);
    });

    const ownedFrames = Array.isArray(raw?.owned?.frames)
      ? raw.owned.frames.filter(id => FRAMES[id])
      : [...base.owned.frames];

    const ownedTags = Array.isArray(raw?.owned?.tags)
      ? raw.owned.tags.filter(id => TAGS[id])
      : [...base.owned.tags];

    if (!ownedFrames.includes("frame_purple_flame")) {
      ownedFrames.push("frame_purple_flame");
    }

    if (!ownedTags.includes("tag_debutant")) {
      ownedTags.push("tag_debutant");
    }

    const equippedAvatar = normalizeAvatar(
      raw?.equipped?.avatar || profileNow().icon
    );

    return {
      owned: {
        avatars: [...new Set(ownedAvatars)],
        frames: [...new Set(ownedFrames)],
        tags: [...new Set(ownedTags)]
      },
      equipped: {
        avatar: ownedAvatars.includes(equippedAvatar)
          ? equippedAvatar
          : ownedAvatars[0],
        frame: ownedFrames.includes(raw?.equipped?.frame)
          ? raw.equipped.frame
          : "",
        tag: raw?.equipped?.tag === ""
          ? ""
          : ownedTags.includes(raw?.equipped?.tag)
            ? raw.equipped.tag
            : (ownedTags[0] || "")
      }
    };
  }

  function loadState() {
    try {
      return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch {
      return defaultState();
    }
  }

  function saveState(state) {
    const clean = sanitize(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function saveAvatarToProfile(avatar) {
    const profile = profileNow();

    try {
      if (typeof saveProfile === "function") {
        saveProfile(profile.name || "Joueur", avatar);
      } else {
        localStorage.setItem("petitbac_profile_icon", avatar);
      }
    } catch {
      localStorage.setItem("petitbac_profile_icon", avatar);
    }
  }

  function grantItem(type, id) {
    const state = loadState();
    const bucket = {
      avatar: "avatars",
      frame: "frames",
      tag: "tags"
    }[type];

    if (!bucket) return false;
    if (type === "avatar" && !avatars().includes(id)) return false;
    if (type === "frame" && !FRAMES[id]) return false;
    if (type === "tag" && !TAGS[id]) return false;

    if (!state.owned[bucket].includes(id)) {
      state.owned[bucket].push(id);
      saveState(state);
    }

    return true;
  }

  function hasItem(type, id) {
    const state = loadState();
    const bucket = {
      avatar: "avatars",
      frame: "frames",
      tag: "tags"
    }[type];

    return !!bucket && state.owned[bucket].includes(id);
  }

  function equipItem(type, id) {
    const state = loadState();

    if (type === "avatar") {
      const avatar = normalizeAvatar(id);
      if (!state.owned.avatars.includes(avatar)) return false;
      state.equipped.avatar = avatar;
      saveState(state);
      saveAvatarToProfile(avatar);
      return true;
    }

    if (type === "frame") {
      if (id === "") {
        state.equipped.frame = "";
        saveState(state);
        return true;
      }

      if (!state.owned.frames.includes(id) || !FRAMES[id]) return false;
      state.equipped.frame = id;
      saveState(state);
      return true;
    }

    if (type === "tag") {
      if (id === "") {
        state.equipped.tag = "";
        saveState(state);
        return true;
      }

      if (!state.owned.tags.includes(id) || !TAGS[id]) return false;
      state.equipped.tag = id;
      saveState(state);
      return true;
    }

    return false;
  }

  function frameMarkup(frameId, extraClass = "") {
    const frame = FRAMES[frameId];
    if (!frame) return "";

    return `<span class="inv-frame ${frame.className} ${esc(extraClass)}" aria-hidden="true"></span>`;
  }

  function tagMarkup(tagId, extraClass = "") {
    const tag = TAGS[tagId];
    if (!tag) return "";

    return `
      <span class="inv-tag ${tag.className} ${esc(extraClass)}">
        <span aria-hidden="true">${tag.icon}</span>
        <strong>${esc(tag.name)}</strong>
      </span>`;
  }

  function inventoryHtml() {
    const state = loadState();
    const profile = profileNow();
    const equippedAvatar = normalizeAvatar(state.equipped.avatar);

    return `
      <section class="inventory-v1" aria-label="Inventaire">
        <section class="inventory-v1-preview" aria-label="Aperçu du joueur">
          <div class="inventory-v1-preview-avatar">
            <img src="${esc(equippedAvatar)}" alt="" draggable="false">
            ${frameMarkup(state.equipped.frame, "inv-frame-preview")}
          </div>

          <div class="inventory-v1-preview-copy">
            <small>Aperçu du joueur</small>
            <strong>${esc(profile.name || "Joueur")}</strong>
            ${state.equipped.tag
              ? tagMarkup(state.equipped.tag, "inv-tag-preview")
              : '<span class="inventory-v1-no-tag">Aucun tag équipé</span>'}
          </div>
        </section>

        <section class="inventory-v1-section">
          <div class="inventory-v1-section-head">
            <div><span class="inventory-v1-section-icon"><img src="/profile-icon.png" alt="" draggable="false"></span><h3>Choix de l’avatar</h3></div>
            <small>${state.owned.avatars.length} possédés</small>
          </div>

          <div class="inventory-v1-avatar-grid">
            ${state.owned.avatars.map((avatar, index) => {
              const selected = avatar === equippedAvatar;
              return `
                <button
                  class="inventory-v1-avatar-choice ${selected ? "is-selected" : ""}"
                  type="button"
                  data-inventory-type="avatar"
                  data-inventory-id="${esc(avatar)}"
                  aria-label="Équiper l’avatar ${index + 1}"
                  aria-pressed="${selected ? "true" : "false"}"
                >
                  <img src="${esc(avatar)}" alt="" draggable="false">
                  <span class="inventory-v1-check">✓</span>
                </button>`;
            }).join("")}
          </div>
        </section>

        <section class="inventory-v1-section">
          <div class="inventory-v1-section-head">
            <div><span class="inventory-v1-section-icon"><img src="/inventaire.png" alt="" draggable="false"></span><h3>Choix du cadre</h3></div>
            <small>${state.owned.frames.length} possédé${state.owned.frames.length > 1 ? "s" : ""}</small>
          </div>

          <div class="inventory-v1-frame-grid">
            <button
              class="inventory-v1-frame-choice is-empty ${state.equipped.frame === "" ? "is-selected" : ""}"
              type="button"
              data-inventory-type="frame"
              data-inventory-id=""
              aria-label="Sans cadre"
              aria-pressed="${state.equipped.frame === "" ? "true" : "false"}"
            >
              <span class="inventory-v1-frame-swatch"><i></i></span>
              <strong>Sans cadre</strong>
              <span class="inventory-v1-check">✓</span>
            </button>

            ${state.owned.frames.map(frameId => {
              const frame = FRAMES[frameId];
              if (!frame) return "";
              const selected = state.equipped.frame === frameId;

              return `
                <button
                  class="inventory-v1-frame-choice ${selected ? "is-selected" : ""}"
                  type="button"
                  data-inventory-type="frame"
                  data-inventory-id="${esc(frameId)}"
                  aria-label="Équiper le cadre ${esc(frame.name)}"
                  aria-pressed="${selected ? "true" : "false"}"
                >
                  <span class="inventory-v1-frame-swatch">
                    <img src="${esc(equippedAvatar)}" alt="" draggable="false">
                    ${frameMarkup(frameId, "inv-frame-mini")}
                  </span>
                  <strong>${esc(frame.name)}</strong>
                  <span class="inventory-v1-check">✓</span>
                </button>`;
            }).join("")}
          </div>
        </section>

        <section class="inventory-v1-section inventory-v1-tags">
          <div class="inventory-v1-section-head">
            <div><span class="inventory-v1-section-icon"><img src="/rewards.png" alt="" draggable="false"></span><h3>Choix du tag</h3></div>
            <small>${state.owned.tags.length} possédé${state.owned.tags.length > 1 ? "s" : ""}</small>
          </div>

          <div class="inventory-v1-tag-grid">
            <button
              class="inventory-v1-tag-choice is-none ${state.equipped.tag === "" ? "is-selected" : ""}"
              type="button"
              data-inventory-type="tag"
              data-inventory-id=""
              aria-pressed="${state.equipped.tag === "" ? "true" : "false"}"
            >
              Aucun tag
              <span class="inventory-v1-check">✓</span>
            </button>

            ${state.owned.tags.map(tagId => {
              const tag = TAGS[tagId];
              if (!tag) return "";
              const selected = state.equipped.tag === tagId;

              return `
                <button
                  class="inventory-v1-tag-choice ${tag.className} ${selected ? "is-selected" : ""}"
                  type="button"
                  data-inventory-type="tag"
                  data-inventory-id="${esc(tagId)}"
                  aria-label="Équiper le tag ${esc(tag.name)}"
                  aria-pressed="${selected ? "true" : "false"}"
                >
                  <span aria-hidden="true">${tag.icon}</span>
                  <strong>${esc(tag.name)}</strong>
                  <span class="inventory-v1-check">✓</span>
                </button>`;
            }).join("")}
          </div>
        </section>
      </section>
    `;
  }

  function bindInventory(dialog) {
    dialog.querySelectorAll("[data-inventory-type]").forEach(button => {
      button.addEventListener("click", () => {
        const type = button.dataset.inventoryType || "";
        const id = button.dataset.inventoryId || "";

        if (!equipItem(type, id)) {
          try { toast("Impossible d’équiper cet objet."); } catch {}
          return;
        }

        renderInto(dialog);
      });
    });
  }

  function renderInto(dialog) {
    const content = dialog?.querySelector("#homeDetailContent");
    if (!content) return;

    content.innerHTML = inventoryHtml();
    bindInventory(dialog);
  }

  function openInventory() {
    const dialog = document.getElementById("homeDetailDialog");

    if (!dialog) {
      try { toast("Inventaire indisponible."); } catch {}
      return;
    }

    dialog.classList.add("inventory-v1-dialog");

    const backButton = dialog.querySelector(".hm-close");
    if (backButton) {
      backButton.classList.add("inventory-v1-back");
      backButton.setAttribute("aria-label", "Retour");
      backButton.innerHTML = '<img src="/back-arrow.png" alt="" draggable="false">';
    }

    renderInto(dialog);

    if (!dialog.open) dialog.showModal();

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

  // Le bouton d'accueil possède encore l'ancien prototype dans home-screen-v1.js.
  // On l'intercepte ici pour ouvrir la nouvelle version sans toucher au reste de l'accueil.
  document.addEventListener("click", event => {
    const trigger = event.target.closest?.("#homeInventory");
    if (!trigger) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openInventory();
  }, true);

  window.PtitBacInventory = {
    open: openInventory,
    state: loadState,
    grantItem,
    hasItem,
    equipItem,
    frames: FRAMES,
    tags: TAGS
  };
})();
