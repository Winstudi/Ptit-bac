/* =========================================================
   P'tit Bac — Progression XP / niveaux V2
   Accueil : niveau + barre.
   Fin de partie : refonte classement + récompenses premium.
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
    return String(localStorage.getItem("petitbac_walletToken") || "").trim();
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      })[char]
    );
  }

  function winnerHeadingMarkup(value) {
    const text = String(value || "").trim();
    const winner = text.match(/^(.+?)\s+remporte la partie\s*!$/i);
    if (winner) {
      return `<span>${escapeHtml(winner[1])}</span> remporte la partie !`;
    }

    const shared = text.match(/^Victoire partagée\s*:\s*(.+)$/i);
    if (shared) {
      return `Victoire partagée : <span>${escapeHtml(shared[1])}</span>`;
    }

    return escapeHtml(text || "Partie terminée !");
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
      trophies: Math.max(0, Math.floor(Number(value.trophies) || 0)),
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
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(clean));
    } catch {}
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

  function livePlayers() {
    const room = liveRoomState();
    return Array.isArray(room?.players) ? room.players : [];
  }

  function localPlayerId() {
    try {
      return String(session?.playerId || "");
    } catch {
      return "";
    }
  }

  function tagLabel(player) {
    let id = String(player?.tagId || "").trim();

    if (!id && String(player?.id || "") === localPlayerId()) {
      try {
        id = String(window.PtitBacInventory?.state?.()?.equipped?.tag || "").trim();
      } catch {}
    }

    if (!id || id === "tag_debutant") return "Débutant";

    return id
      .replace(/^tag[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim() || "Débutant";
  }

  function playerForResultNode(node) {
    const players = livePlayers();
    if (!players.length || !node) return null;

    const nameNode = node.matches(".fin-row")
      ? node.querySelector(".fin-player > strong")
      : node.querySelector(":scope > strong");

    const name = String(nameNode?.textContent || "").trim();
    if (!name) return null;

    const sameName = players.filter(player => String(player?.name || "").trim() === name);
    if (sameName.length === 1) return sameName[0];

    if (node.querySelector(".fin-you")) {
      const self = sameName.find(player => String(player?.id || "") === localPlayerId());
      if (self) return self;
    }

    return sameName[0] || null;
  }

  function decorateResultPlayers(root) {
    root.querySelectorAll(".fin-podium-card").forEach(card => {
      const player = playerForResultNode(card);
      if (player) {
        card.dataset.playerId = String(player.id || "");
        const avatar = card.querySelector(".fin-avatar");
        if (avatar) avatar.dataset.playerId = String(player.id || "");
      }

      if (!card.querySelector(".fin-title-tag")) {
        const name = card.querySelector(":scope > strong");
        if (name) {
          const tag = document.createElement("span");
          tag.className = "fin-title-tag";
          tag.textContent = tagLabel(player);
          name.insertAdjacentElement("afterend", tag);
        }
      }

      const medal = card.querySelector(".fin-medal");
      const isWinner = card.classList.contains("place-1");

      if (!isWinner) {
        card.querySelectorAll(".fin-rank-crown").forEach(crown => crown.remove());
      } else if (medal && !card.querySelector(".fin-rank-crown")) {
        const crown = document.createElement("img");
        crown.className = "fin-rank-crown";
        crown.src = "/admin-crown.png";
        crown.alt = "";
        crown.setAttribute("aria-hidden", "true");
        medal.insertAdjacentElement("beforebegin", crown);
      }
    });

    root.querySelectorAll(".fin-row").forEach(row => {
      const player = playerForResultNode(row);
      if (player) {
        row.dataset.playerId = String(player.id || "");
        const avatar = row.querySelector(".fin-avatar");
        if (avatar) avatar.dataset.playerId = String(player.id || "");
      }

      const playerBox = row.querySelector(".fin-player");
      if (playerBox && !playerBox.querySelector(".fin-title-tag")) {
        const name = playerBox.querySelector("strong");
        if (name) {
          const tag = document.createElement("span");
          tag.className = "fin-title-tag";
          tag.textContent = tagLabel(player);
          name.insertAdjacentElement("afterend", tag);
        }
      }
    });
  }

  function patchFinalVisual(root) {
    if (!root) return;

    root.querySelector(".fin-top")?.remove();

    const heading = root.querySelector(".fin-heading");
    if (heading && heading.dataset.redesigned !== "1") {
      const winnerText = String(heading.querySelector("p")?.textContent || "").trim();
      heading.dataset.redesigned = "1";
      heading.innerHTML = `
        <button class="fin-back" id="finBack" type="button" aria-label="Retour à l’accueil">
          <img src="/back-arrow.png" alt="">
        </button>
        <div class="fin-heading-copy">
          <small>PARTIE TERMINÉE</small>
          <h1>${winnerHeadingMarkup(winnerText)}</h1>
        </div>`;
    }

    const back = root.querySelector("#finBack");
    if (back && back.dataset.bound !== "1") {
      back.dataset.bound = "1";
      back.addEventListener("click", () => {
        root.querySelector("#finHome")?.click();
      });
    }

    decorateResultPlayers(root);

    const actions = root.querySelector(".fin-actions");
    const home = root.querySelector("#finHome");
    const replay = root.querySelector("#finReplay, #finQuick");

    if (replay) {
      replay.textContent = "Retour au salon";
      replay.classList.remove("fin-replay-secondary");
      replay.classList.add("fin-return-lobby");

      if (actions && actions.firstElementChild !== replay) {
        actions.insertBefore(replay, actions.firstElementChild);
      }
    }

    if (home) {
      home.textContent = "Retour à l’accueil";
      home.classList.remove("fin-continue");
      home.classList.add("fin-home-secondary");

      if (actions) {
        if (replay && replay.nextElementSibling !== home) {
          replay.insertAdjacentElement("afterend", home);
        } else if (!replay && actions.lastElementChild !== home) {
          actions.appendChild(home);
        }
      }
    }
  }

  function burstLevelUp(level, eventKey) {
    if (!eventKey || shownLevelUps.has(eventKey)) return;
    shownLevelUps.add(eventKey);

    document.querySelector(".ptb-level-up-burst")?.remove();

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

  function rewardSubtitle(roomState, progressionEnabled) {
    if (roomState?.mode === "private" || !progressionEnabled) {
      return "Salon privé : aucun gain de progression pour cette partie.";
    }
    return "Voici les gains ajoutés à ta progression.";
  }

  function patchFinal() {
    const root = document.querySelector(".final-mobile");
    if (!root) return;

    patchFinalVisual(root);

    const roomState = liveRoomState();
    const progressionEnabled = roomState?.progressionEnabled === true;

    let card = root.querySelector(".ptb-final-xp-card");

    // Aucun bloc de gains si la progression est désactivée (ex. salon privé).
    if (!progressionEnabled) {
      card?.remove();
      return;
    }

    const current = readCache();

    if (!card) {
      card = document.createElement("section");
      card.className = "ptb-final-xp-card";
      const actions = root.querySelector(".fin-actions");
      if (actions) actions.before(card);
      else root.appendChild(card);
    }

    if (!current) {
      if (card.dataset.progressionSignature !== "loading") {
        card.dataset.progressionSignature = "loading";
        card.innerHTML = `
          <div class="ptb-final-reward-heading">
            <small>TES GAINS</small>
            <p>Chargement de ta progression…</p>
          </div>`;
      }
      return;
    }

    const roomAward = roomState?.myProgression || null;
    const award = progressionEnabled ? (roomAward || lastAward) : null;

    const gainedXp = progressionEnabled
      ? Math.max(0, Number(award?.gainedXp) || 0)
      : 0;

    const gainedTrophies = progressionEnabled
      ? Math.max(0, Number(award?.gainedTrophies) || 0)
      : 0;

    const before = normalizeState(award?.before) || current;
    const fromLevel = Math.max(1, Number(before.level) || current.level);
    const toLevel = current.level;
    const levelLabel = toLevel > fromLevel
      ? `Niveau ${fromLevel} → ${toLevel}`
      : `Niveau ${toLevel}`;

    const xpText = current.maxLevel
      ? "Niveau maximum"
      : `${current.xpIntoLevel} / ${current.xpForNext} XP`;

    const remaining = current.maxLevel
      ? 0
      : Math.max(0, current.xpForNext - current.xpIntoLevel);

    const remainingText = current.maxLevel
      ? "Niveau maximum atteint."
      : remaining === 0
        ? "Prochain niveau atteint !"
        : `Encore ${remaining} XP pour atteindre le niveau ${Math.min(50, current.level + 1)}.`;

    const signature = [
      current.level,
      Math.round(current.progressPercent * 100) / 100,
      current.xpIntoLevel,
      current.xpForNext,
      current.trophies,
      gainedXp,
      gainedTrophies,
      award?.eventKey || "private"
    ].join(":");

    if (card.dataset.progressionSignature !== signature) {
      card.dataset.progressionSignature = signature;
      card.dataset.animated = "0";
      card.classList.remove("is-level-up");
      card.innerHTML = `
        <div class="ptb-final-reward-heading">
          <small>TES GAINS</small>
          <p>${rewardSubtitle(roomState, progressionEnabled)}</p>
        </div>

        <div class="ptb-final-reward-grid">
          <article class="ptb-final-reward-card is-xp">
            <div class="ptb-final-reward-icon"><b>XP</b></div>
            <div>
              <strong>+${gainedXp} XP</strong>
              <small>Expérience gagnée</small>
            </div>
          </article>

          <article class="ptb-final-reward-card is-trophy">
            <div class="ptb-final-reward-icon">
              <img src="/scoreboard-trophy.png" alt="">
            </div>
            <div>
              <strong>+${gainedTrophies} trophées</strong>
              <small>Trophées gagnés</small>
            </div>
          </article>
        </div>

        <div class="ptb-final-level-box">
          <div class="ptb-final-level-head">
            <strong>${levelLabel}</strong>
            <span>Progression <b>+${gainedXp} XP</b></span>
          </div>

          <div class="ptb-final-xp-track" role="progressbar"
               aria-label="Progression du niveau ${current.level}"
               aria-valuemin="0" aria-valuemax="100"
               aria-valuenow="${Math.round(current.progressPercent)}">
            <i class="ptb-final-xp-fill"></i>
          </div>

          <div class="ptb-final-level-foot">
            <small>${remainingText}</small>
            <strong>${xpText}</strong>
          </div>
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

    document.addEventListener("ptitbac:screen-rendered", schedulePatch);
    document.addEventListener("ptitbac:dom-updated", schedulePatch);

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
