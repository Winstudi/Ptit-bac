(() => {
  "use strict";

  const FALLBACK_CONFIG = Object.freeze({
    starUpgrade:{
      blue:{ upgradeChance:0, next:"" }
    },
    dropTables:{
      bag:[
        { kind:"coins", weight:52, min:30, max:100 },
        { kind:"gems", weight:30, min:1, max:5 },
        { kind:"item", rarity:"commun", weight:18 }
      ],
      star:[
        { kind:"coins", weight:40, min:50, max:120 },
        { kind:"gems", weight:25, min:2, max:5 },
        { kind:"item", rarity:"commun", weight:20 },
        { kind:"item", rarity:"rare", weight:15 }
      ],
      legendary:[
        { kind:"coins", weight:15, min:250, max:500 },
        { kind:"gems", weight:15, min:10, max:20 },
        { kind:"item", rarity:"rare", weight:10 },
        { kind:"item", rarity:"epique", weight:30 },
        { kind:"item", rarity:"ultra", weight:30 }
      ]
    }
  });

  const ITEM_PREVIEW = Object.freeze({
    commun:{ asset:"/frame-nature.png", label:"Commun" },
    rare:{ asset:"/frame-gaming.png", label:"Rare" },
    epique:{ asset:"/frame-purple-flame.png", label:"Épique" },
    ultra:{ asset:"/frame-gold-stars.png", label:"Ultra" }
  });

  const FALLBACK_COMPENSATION = Object.freeze({
    commun:50,
    rare:100,
    epique:250,
    ultra:500
  });

  let config = FALLBACK_CONFIG;
  let chestCatalog = [];
  let overlay = null;
  let activeType = "star";
  let starState = "blue";
  let busy = false;
  let resetTimer = null;
  let animationTimers = [];

  function clampRandom(value) {
    return Math.max(0, Math.min(.999999999999, Number(value) || 0));
  }

  function randomInt(min, max) {
    const lo = Math.floor(Math.min(Number(min) || 0, Number(max) || 0));
    const hi = Math.floor(Math.max(Number(min) || 0, Number(max) || 0));
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  function weightedPick(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const total = list.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
    let cursor = clampRandom(Math.random()) * total;
    for (const row of list) {
      const weight = Math.max(0, Number(row.weight) || 0);
      if (cursor < weight) return row;
      cursor -= weight;
    }
    return list[list.length - 1] || { kind:"coins", min:50, max:50 };
  }

  function rollPreviewReward(type, state = "blue") {
    const rows = type === "bag"
      ? config.dropTables?.bag
      : type === "legendary"
        ? config.dropTables?.legendary
        : config.dropTables?.star;
    const row = weightedPick(rows);
    if (row.kind === "item") {
      const rarity = String(row.rarity || "commun").toLowerCase();
      const candidates = chestCatalog.filter(item =>
        item && item.rarity === rarity && item.rarity !== "exclusif"
      );

      if (candidates.length) {
        const item = candidates[Math.floor(Math.random() * candidates.length)];
        return { kind:"item", rarity, item };
      }

      const amount = Number(config.duplicateCompensation?.[rarity])
        || FALLBACK_COMPENSATION[rarity]
        || 50;
      return { kind:"coins", amount, compensationFor:rarity };
    }
    return { kind:row.kind, amount:randomInt(row.min, row.max) };
  }

  function starTapPreview() {
    return { opened:true, upgraded:false, state:"blue" };
  }

  function requestConfig(attempt = 0) {
    try {
      if (typeof socket === "undefined" || !socket?.connected) {
        if (attempt < 12) setTimeout(() => requestConfig(attempt + 1), 350);
        return;
      }
      socket.timeout(5000).emit("rewards:config", {}, (err, res) => {
        if (err || !res?.ok || !res.config?.dropTables) return;
        config = res.config;
        chestCatalog = (Array.isArray(res.catalog) ? res.catalog : [])
          .filter(item => item && item.rarity !== "exclusif");
      });
    } catch {}
  }

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;

    overlay = document.createElement("section");
    overlay.className = "ptb-reward-open";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="ptb-reward-scene">
        <button class="ptb-reward-back" type="button" aria-label="Fermer">
          <img src="/back-arrow.png" alt="">
        </button>
        <div class="ptb-reward-flash" aria-hidden="true"></div>
        <div class="ptb-reward-rays" aria-hidden="true"></div>
        <button class="ptb-reward-object" type="button" aria-label="Ouvrir la récompense">
          <span class="ptb-reward-aura" aria-hidden="true"></span>
          <img class="ptb-reward-object-img" src="/reward-star.png" alt="">
          <span class="ptb-star-rig" aria-hidden="true">
            <img class="ptb-star-fx ptb-star-fx-glow" src="/reward-star-glow.png" alt="">
            <img class="ptb-star-fx ptb-star-fx-rays" src="/reward-star-rays.png" alt="">
            <span class="ptb-star-inner-light"><img src="/reward-star-inner.png" alt=""></span>
            <img class="ptb-star-base" src="/reward-star-base.png" alt="">
            <span class="ptb-star-lid-hinge"><img class="ptb-star-lid" src="/reward-star-lid.png" alt=""></span>
            <img class="ptb-star-fx ptb-star-fx-particles" src="/reward-star-particles.png" alt="">
            <img class="ptb-star-fx ptb-star-fx-flash" src="/reward-star-flash.png" alt="">
          </span>
        </button>
        <div class="ptb-reward-result" aria-live="polite"></div>
      </div>`;

    overlay.querySelector(".ptb-reward-back")?.addEventListener("click", close);
    overlay.querySelector(".ptb-reward-object")?.addEventListener("click", handleTap);
    overlay.querySelector(".ptb-reward-result")?.addEventListener("click", () => restart(activeType));
    document.body.appendChild(overlay);
    return overlay;
  }

  function clearAnimationTimers() {
    animationTimers.forEach(id => clearTimeout(id));
    animationTimers = [];
  }

  function later(fn, delay) {
    const id = setTimeout(fn, delay);
    animationTimers.push(id);
    return id;
  }

  function setStarPhase(phase = "idle") {
    const root = ensureOverlay();
    root.dataset.starPhase = phase;
  }

  function assetFor(type) {
    if (type === "bag") return "/reward-bag.png";
    if (type === "legendary") return "/reward-legendary.png";
    return "/reward-star-base.png";
  }

  function setSceneType(type) {
    const root = ensureOverlay();
    root.dataset.rewardType = type;
    root.dataset.starState = starState;
    if (type !== "star") setStarPhase("idle");
    const image = root.querySelector(".ptb-reward-object-img");
    if (image) image.src = assetFor(type);
  }

  function clearAnimationClasses() {
    if (!overlay) return;
    overlay.classList.remove(
      "is-tapping",
      "is-upgrading",
      "is-opening",
      "is-revealed",
      "is-star-flashing",
      "is-resetting"
    );
  }

  function reset(type = activeType) {
    clearTimeout(resetTimer);
    clearAnimationTimers();
    activeType = ["bag", "star", "legendary"].includes(type) ? type : "star";
    starState = "blue";
    busy = false;
    const root = ensureOverlay();
    clearAnimationClasses();
    root.dataset.starState = starState;
    root.dataset.starPhase = "idle";
    root.querySelector(".ptb-reward-result")?.replaceChildren();
    root.querySelector(".ptb-reward-object")?.removeAttribute("disabled");
    setSceneType(activeType);
  }


  function restart(type = activeType) {
    if (!overlay || overlay.classList.contains("is-resetting")) return;
    busy = true;
    clearAnimationTimers();
    overlay.classList.add("is-resetting");
    later(() => {
      reset(type);
      overlay.classList.remove("is-resetting");
    }, 180);
  }

  function open(type = "star") {
    const root = ensureOverlay();
    reset(type);
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("ptb-reward-lock");
    document.body.classList.add("ptb-reward-lock");
  }

  function close() {
    if (!overlay) return;
    clearTimeout(resetTimer);
    clearAnimationTimers();
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("ptb-reward-lock");
    document.body.classList.remove("ptb-reward-lock");
    busy = false;
    if (location.hash.startsWith("#rewards-preview")) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }

  function revealReward(reward) {
    const root = ensureOverlay();
    const result = root.querySelector(".ptb-reward-result");
    if (!result) return;

    let html = "";
    if (reward?.kind === "coins") {
      html = `
        <div class="ptb-reward-result-card is-coins">
          <img src="/coin.png" alt="">
          <strong>+${Math.max(0, Number(reward.amount) || 0)}</strong>
        </div>`;
    } else if (reward?.kind === "gems") {
      html = `
        <div class="ptb-reward-result-card is-gems">
          <img src="/gem.png" alt="">
          <strong>+${Math.max(0, Number(reward.amount) || 0)}</strong>
        </div>`;
    } else {
      const rarity = String(reward?.rarity || "commun");
      const preview = reward?.item || ITEM_PREVIEW[rarity] || ITEM_PREVIEW.commun;
      const directAvatar = preview.type === "avatar" && String(preview.id || "").startsWith("/")
        ? String(preview.id)
        : "";
      const asset = String(preview.asset || directAvatar || ITEM_PREVIEW[rarity]?.asset || "/reward-star.png");
      const label = String(preview.label || ITEM_PREVIEW[rarity]?.label || "Objet");
      html = `
        <div class="ptb-reward-result-card is-item rarity-${rarity}">
          <div class="ptb-reward-item-frame"><img src="${asset.replace(/"/g, "&quot;")}" alt=""></div>
          <strong>${label.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])}</strong>
        </div>`;
    }

    result.innerHTML = html;
    root.classList.add("is-revealed");
    busy = false;
  }

  function playStarChestAnimation(reward) {
    const root = ensureOverlay();
    const button = root.querySelector(".ptb-reward-object");
    button?.setAttribute("disabled", "disabled");
    clearAnimationTimers();
    clearAnimationClasses();
    setStarPhase("press");
    if (navigator.vibrate) navigator.vibrate(12);

    // Un seul couvercle est animé : aucune image n'est remplacée pendant l'ouverture.
    later(() => {
      setStarPhase("opening");
      if (navigator.vibrate) navigator.vibrate([12, 24, 14]);
    }, 150);

    // La lumière apparaît progressivement pendant que le couvercle pivote.
    later(() => {
      root.classList.add("is-star-flashing");
    }, 720);

    later(() => {
      setStarPhase("opened");
      if (navigator.vibrate) navigator.vibrate(28);
    }, 1030);

    later(() => {
      root.classList.remove("is-star-flashing");
      setStarPhase("reward");
      revealReward(reward);
    }, 1240);

    // Les particules restent brièvement après l'apparition du gain.
    later(() => {
      setStarPhase("settled");
    }, 1840);
  }

  function performOpen(reward) {
    const root = ensureOverlay();
    root.classList.remove("is-tapping", "is-upgrading");
    root.classList.add("is-opening");
    root.querySelector(".ptb-reward-object")?.setAttribute("disabled", "disabled");
    setTimeout(() => revealReward(reward), 620);
  }

  function handleTap() {
    if (busy) return;
    busy = true;
    const root = ensureOverlay();
    root.classList.remove("is-upgrading");
    root.classList.add("is-tapping");

    if (activeType !== "star") {
      const reward = rollPreviewReward(activeType, "blue");
      later(() => performOpen(reward), activeType === "legendary" ? 560 : 460);
      return;
    }

    const outcome = starTapPreview();
    starState = outcome.state;
    root.dataset.starState = starState;
    const reward = rollPreviewReward("star", starState);
    playStarChestAnimation(reward);
  }

  function previewTypeFromHash() {
    const raw = String(location.hash || "").toLowerCase();
    if (!raw.startsWith("#rewards-preview")) return "";
    const value = raw.split("=")[1] || "star";
    if (value === "sac" || value === "bag") return "bag";
    if (value === "legendary" || value === "legendaire" || value === "légendaire") return "legendary";
    return "star";
  }

  function handleHash() {
    const type = previewTypeFromHash();
    if (type) open(type);
    else if (overlay?.classList.contains("is-open")) close();
  }

  window.PtitBacRewards = {
    preview:open,
    close,
    reveal:revealReward,
    reset,
    restart,
    config:() => JSON.parse(JSON.stringify(config)),
    catalog:() => JSON.parse(JSON.stringify(chestCatalog))
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      requestConfig();
      handleHash();
    }, { once:true });
  } else {
    requestConfig();
    handleHash();
  }
  window.addEventListener("hashchange", handleHash);
})();
