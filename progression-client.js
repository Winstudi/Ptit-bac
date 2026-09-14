/* =========================================================
   P'tit Bac — Progression XP / niveaux V1
   Accueil : niveau + barre uniquement.
   Fin de partie : niveau + barre + XP gagné + animation level-up.
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
    return String(
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
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
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch {}
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
      .ptb-final-xp-card{
        width:min(100%,420px);margin:14px auto 12px;padding:13px 15px 14px;
        border:1px solid rgba(137,87,235,.52);border-radius:16px;
        background:linear-gradient(145deg,rgba(21,34,82,.94),rgba(19,19,63,.96));
        box-shadow:inset 0 0 18px rgba(126,69,231,.08),0 8px 22px rgba(0,0,0,.17)
      }
      .ptb-final-xp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
      .ptb-final-xp-head strong{color:#fff;font-size:.9rem;font-weight:900}
      .ptb-final-xp-gain{color:#c995ff;font-size:.76rem;font-weight:900}
      .ptb-final-xp-track{
        height:9px;overflow:hidden;border:1px solid rgba(155,107,255,.45);
        border-radius:999px;background:#09133b;box-shadow:inset 0 2px 5px rgba(0,0,0,.34)
      }
      .ptb-final-xp-fill{
        display:block;width:0;height:100%;border-radius:inherit;
        background:linear-gradient(90deg,#6938ea,#b348ff,#e66dff);
        box-shadow:0 0 12px rgba(176,67,255,.58);
        transition:width .8s cubic-bezier(.22,.8,.25,1)
      }
      .ptb-final-xp-card.is-level-up{
        animation:ptbXpCardPulse .8s ease both
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
      @keyframes ptbXpCardPulse{0%,100%{transform:scale(1)}45%{transform:scale(1.025);box-shadow:0 0 24px rgba(175,76,255,.34)}}
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

  function burstLevelUp(level, eventKey) {
    if (!eventKey || shownLevelUps.has(eventKey)) return;
    shownLevelUps.add(eventKey);

    const old = document.querySelector(".ptb-level-up-burst");
    old?.remove();

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

  function patchFinal() {
    const root = document.querySelector(".final-mobile");
    const current = readCache();
    if (!root || !current) return;

    const roomState = liveRoomState();
    const progressionEnabled = roomState?.progressionEnabled === true;
    const roomAward = roomState?.myProgression || null;
    const award = progressionEnabled
      ? roomAward
      : null;

    let card = root.querySelector(".ptb-final-xp-card");
    if (!card) {
      card = document.createElement("section");
      card.className = "ptb-final-xp-card";
      const actions = root.querySelector(".fin-actions");
      if (actions) actions.before(card);
      else root.appendChild(card);
    }

    const gainedXp = progressionEnabled
      ? Math.max(0, Number(award?.gainedXp) || 0)
      : 0;

    const signature = [
      current.level,
      Math.round(current.progressPercent * 100) / 100,
      gainedXp,
      award?.eventKey || "private"
    ].join(":");

    if (card.dataset.progressionSignature !== signature) {
      card.dataset.progressionSignature = signature;
      card.dataset.animated = "0";
      card.classList.remove("is-level-up");
      card.innerHTML = `
        <div class="ptb-final-xp-head">
          <strong>Niv. ${current.level}</strong>
          <span class="ptb-final-xp-gain">+${gainedXp} XP</span>
        </div>
        <div class="ptb-final-xp-track" role="progressbar"
             aria-label="Progression du niveau ${current.level}"
             aria-valuemin="0" aria-valuemax="100"
             aria-valuenow="${Math.round(current.progressPercent)}">
          <i class="ptb-final-xp-fill"></i>
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

    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.documentElement, { childList:true, subtree:true });

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
