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
  let levelsOverlay = null;
  let lastFocusedTrigger = null;
  const LEVEL_REWARD_COINS = 50;

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

      .ptb-level-entry-trigger{cursor:pointer}
      .ptb-level-entry-trigger:focus-visible{
        outline:2px solid rgba(118,224,255,.95);
        outline-offset:2px;
        border-radius:999px;
      }

      .ptb-levels-overlay{
        position:fixed;inset:0;z-index:100030;display:flex;align-items:stretch;justify-content:center;
        background:rgba(1,4,20,.76);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
        opacity:0;pointer-events:none;transition:opacity .24s ease;
      }
      .ptb-levels-overlay.is-open{opacity:1;pointer-events:auto}
      .ptb-levels-panel{
        width:min(100vw,520px);height:100%;overflow:hidden;position:relative;
        background:
          radial-gradient(circle at top right,rgba(110,69,255,.20),transparent 32%),
          radial-gradient(circle at left center,rgba(27,190,255,.14),transparent 28%),
          linear-gradient(180deg,#07164b 0%,#08194d 38%,#071543 100%);
        color:#fff;
        font-family:"DM Sans",system-ui,sans-serif;
      }
      .ptb-levels-panel::before{
        content:"";position:absolute;inset:0;pointer-events:none;opacity:.4;
        background:linear-gradient(135deg,transparent 0 72%,rgba(255,255,255,.05) 82%,transparent 100%);
      }
      .ptb-levels-scroll{position:relative;height:100%;overflow:auto;padding:18px 16px 34px;scroll-behavior:smooth}
      .ptb-levels-header{display:flex;align-items:center;justify-content:center;position:relative;padding:6px 0 18px}
      .ptb-levels-back{
        position:absolute;left:0;top:0;width:54px;height:54px;border:1px solid rgba(114,160,255,.22);border-radius:50%;
        background:linear-gradient(180deg,rgba(36,82,210,.92),rgba(20,44,123,.9));box-shadow:inset 0 1px 1px rgba(255,255,255,.15),0 12px 32px rgba(0,0,0,.22);
        display:grid;place-items:center;cursor:pointer;
      }
      .ptb-levels-back img{width:24px;height:24px;object-fit:contain;display:block}
      .ptb-levels-title{margin:0;font-size:2rem;font-weight:900;letter-spacing:-.02em}

      .ptb-levels-hero{
        border:1px solid rgba(107,153,255,.26);border-radius:30px;padding:18px 16px 16px;position:relative;overflow:hidden;
        background:linear-gradient(180deg,rgba(16,41,130,.96),rgba(11,24,89,.95));
        box-shadow:inset 0 0 0 1px rgba(88,117,255,.20),0 24px 44px rgba(0,0,0,.24),0 0 0 1px rgba(93,54,255,.20);
      }
      .ptb-levels-hero::after{
        content:"";position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(circle at 85% 6%,rgba(134,74,255,.18),transparent 18%),linear-gradient(180deg,rgba(255,255,255,.05),transparent 38%);
      }
      .ptb-levels-hero-top{display:grid;grid-template-columns:132px minmax(0,1fr);gap:12px;align-items:center}
      .ptb-levels-hero-badge{position:relative;width:132px;height:132px;display:grid;place-items:center;flex:none}
      .ptb-levels-hero-badge img{width:132px;height:132px;display:block;object-fit:contain;filter:drop-shadow(0 12px 18px rgba(0,0,0,.28))}
      .ptb-levels-hero-badge b{position:absolute;inset:0;display:grid;place-items:center;font-size:3.3rem;font-weight:1000;letter-spacing:-.05em;text-shadow:0 3px 8px rgba(8,10,43,.95)}
      .ptb-levels-hero-copy h2{margin:0;font-size:1.18rem;font-weight:900}
      .ptb-levels-hero-copy p{margin:4px 0 14px;color:#c6d4ff;font-size:.95rem;line-height:1.25}
      .ptb-levels-hero-track{
        width:100%;height:58px;padding:0 13%;box-sizing:border-box;display:flex;align-items:center;
        background:url('/level-bar-shell-v1.png') center/100% 100% no-repeat;
        filter:drop-shadow(0 10px 18px rgba(0,0,0,.20));
      }
      .ptb-levels-hero-fill{
        position:relative;display:block;height:15px;width:0;border-radius:999px;overflow:hidden;min-width:0;
        background:linear-gradient(90deg,#29e1ff 0%,#2ec5ff 20%,#5379ff 52%,#9551ff 76%,#e250ff 100%);
        box-shadow:inset 0 1px 1px rgba(255,255,255,.72),0 0 6px rgba(47,214,255,.95),0 0 9px rgba(88,96,255,.6),0 0 12px rgba(211,75,255,.35);
        transition:width .48s cubic-bezier(.22,.8,.28,1);
      }
      .ptb-levels-hero-fill::after{
        content:"";position:absolute;left:8px;right:8px;top:2px;height:3px;border-radius:999px;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent);opacity:.7;
      }
      .ptb-levels-hero-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;font-size:.94rem;color:#f1f3ff}
      .ptb-levels-hero-reward{
        margin-top:14px;border:1px solid rgba(82,112,255,.16);border-radius:19px;padding:12px 14px;
        display:flex;align-items:center;gap:12px;background:rgba(4,14,60,.55);
      }
      .ptb-levels-hero-reward img{width:36px;height:36px;object-fit:contain;display:block;filter:drop-shadow(0 8px 14px rgba(0,0,0,.24))}
      .ptb-levels-hero-reward b{color:#ffd75e}

      .ptb-levels-list{
        position:relative;margin-top:18px;padding-left:34px;
      }
      .ptb-levels-line{
        position:absolute;left:11px;top:14px;bottom:22px;width:2px;border-radius:999px;
        background:linear-gradient(180deg,rgba(71,205,255,.82),rgba(75,127,255,.55));
        box-shadow:0 0 10px rgba(71,205,255,.35);
      }
      .ptb-level-row{position:relative;margin-bottom:14px}
      .ptb-level-dot{
        position:absolute;left:-34px;top:36px;width:18px;height:18px;border-radius:50%;
        border:2px solid rgba(96,167,255,.8);background:linear-gradient(180deg,#84ebff,#59a4ff);
        box-shadow:0 0 12px rgba(87,190,255,.45);
      }
      .ptb-level-row.is-current .ptb-level-dot{
        width:28px;height:28px;left:-39px;top:31px;border:4px solid rgba(90,223,255,.45);background:#8fedff;
        box-shadow:0 0 0 4px rgba(49,93,255,.20),0 0 16px rgba(84,217,255,.6);
      }
      .ptb-level-row.is-locked .ptb-level-dot{
        background:transparent;border-color:rgba(129,151,218,.7);box-shadow:none;
      }
      .ptb-level-card{
        display:grid;grid-template-columns:78px minmax(0,1fr) auto auto;align-items:center;gap:12px;
        border:1px solid rgba(90,110,255,.14);border-radius:24px;padding:12px 12px 12px 10px;
        background:linear-gradient(180deg,rgba(11,32,105,.95),rgba(8,24,80,.95));
        box-shadow:0 14px 28px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.04);
      }
      .ptb-level-row.is-current .ptb-level-card{
        border-color:rgba(132,100,255,.55);
        box-shadow:0 0 0 1px rgba(34,209,255,.34),0 16px 30px rgba(0,0,0,.20),0 0 24px rgba(172,61,255,.18);
        background:linear-gradient(90deg,rgba(10,46,132,.98),rgba(34,32,136,.98) 62%,rgba(68,24,125,.98));
      }
      .ptb-level-row.is-locked .ptb-level-card{opacity:.82}
      .ptb-level-mini-badge{position:relative;width:74px;height:74px;display:grid;place-items:center;flex:none}
      .ptb-level-mini-badge img{width:74px;height:74px;object-fit:contain;display:block;filter:drop-shadow(0 8px 12px rgba(0,0,0,.22))}
      .ptb-level-row.is-locked .ptb-level-mini-badge img{filter:grayscale(.35) saturate(.45) brightness(.86) drop-shadow(0 8px 12px rgba(0,0,0,.20))}
      .ptb-level-mini-badge b{position:absolute;inset:0;display:grid;place-items:center;font-size:2rem;font-weight:1000;letter-spacing:-.04em;text-shadow:0 2px 4px rgba(6,10,40,.95)}
      .ptb-level-copy strong{display:block;font-size:1.08rem;line-height:1.1}
      .ptb-level-copy small{display:block;margin-top:4px;font-size:.86rem;color:#b8c4f5}
      .ptb-level-reward{
        min-width:116px;border-radius:999px;padding:10px 14px;display:flex;align-items:center;justify-content:center;gap:8px;
        background:linear-gradient(180deg,rgba(32,53,139,.95),rgba(25,40,112,.95));border:1px solid rgba(96,118,223,.22);
        color:#fff;font-weight:900;white-space:nowrap
      }
      .ptb-level-reward img{width:22px;height:22px;object-fit:contain;display:block}
      .ptb-level-status{width:36px;height:36px;display:grid;place-items:center;flex:none}
      .ptb-level-status i,
      .ptb-level-status img{display:block}
      .ptb-level-status .ptb-check{
        width:36px;height:36px;border-radius:50%;background:linear-gradient(180deg,#5cd7ff,#5e9fff);
        color:#05225a;font-weight:1000;font-style:normal;font-size:1.2rem;box-shadow:0 0 14px rgba(95,178,255,.34);
      }
      .ptb-level-status .ptb-lock{
        width:26px;height:26px;opacity:.9;filter:brightness(1.16)
      }
      .ptb-level-status .ptb-current{
        width:12px;height:12px;border-radius:50%;background:#dff8ff;box-shadow:0 0 16px rgba(115,233,255,.8);
      }
      .ptb-levels-help{
        margin-top:18px;border:1px solid rgba(82,112,255,.14);border-radius:28px;padding:18px 16px;display:flex;align-items:center;gap:14px;
        background:linear-gradient(180deg,rgba(9,26,92,.94),rgba(7,20,72,.96));box-shadow:0 18px 30px rgba(0,0,0,.16)
      }
      .ptb-levels-help-icon{
        width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:rgba(8,18,73,.78);border:1px solid rgba(90,121,246,.22)
      }
      .ptb-levels-help-icon span{display:flex;align-items:flex-end;gap:5px;height:28px}
      .ptb-levels-help-icon i{display:block;width:8px;border-radius:999px;background:linear-gradient(180deg,#8ae3ff,#4d8fff);box-shadow:0 0 10px rgba(97,190,255,.45)}
      .ptb-levels-help-icon i:nth-child(1){height:14px}
      .ptb-levels-help-icon i:nth-child(2){height:22px}
      .ptb-levels-help-icon i:nth-child(3){height:30px}
      .ptb-levels-help-copy strong{display:block;font-size:1.15rem;line-height:1.15}
      .ptb-levels-help-copy small{display:block;margin-top:6px;font-size:.96rem;color:#b8c4f5;line-height:1.3}

      @media (max-width:420px){
        .ptb-levels-scroll{padding:16px 12px 28px}
        .ptb-levels-title{font-size:1.84rem}
        .ptb-levels-hero{padding:16px 14px 14px}
        .ptb-levels-hero-top{grid-template-columns:114px minmax(0,1fr);gap:10px}
        .ptb-levels-hero-badge,
        .ptb-levels-hero-badge img{width:114px;height:114px}
        .ptb-levels-hero-badge b{font-size:2.85rem}
        .ptb-levels-hero-track{height:52px}
        .ptb-levels-hero-fill{height:13px}
        .ptb-level-card{grid-template-columns:70px minmax(0,1fr);grid-template-areas:'badge copy' 'reward status';gap:10px;padding:11px 11px 11px 9px}
        .ptb-level-mini-badge{grid-area:badge;width:66px;height:66px}
        .ptb-level-mini-badge img{width:66px;height:66px}
        .ptb-level-mini-badge b{font-size:1.76rem}
        .ptb-level-copy{grid-area:copy}
        .ptb-level-reward{grid-area:reward;justify-self:start;min-width:0}
        .ptb-level-status{grid-area:status;justify-self:end}
      }
    `;
    document.head.appendChild(style);
  }

  function levelRewardCoins() {
    return LEVEL_REWARD_COINS;
  }

  function levelStatus(level, currentLevel) {
    if (level < currentLevel) return "completed";
    if (level === currentLevel) return "current";
    return "locked";
  }

  function levelSubtitle(level, currentLevel) {
    if (level < currentLevel) {
      const lines = ["Bien joué !", "Toujours plus loin !", "Tu assures !", "Bravo !", "Excellent rythme !"];
      return lines[(level - 1) % lines.length];
    }
    if (level === currentLevel) return "C'est parti !";
    const delta = level - currentLevel;
    if (delta === 1) return "Encore un peu...";
    if (delta <= 3) return "Bientôt !";
    return "Continue à jouer !";
  }

  function lockIconMarkup() {
    return `
      <svg class="ptb-lock" viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7.5 10V7.8a4.5 4.5 0 119 0V10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <rect x="5.2" y="10" width="13.6" height="10.6" rx="3.2" fill="currentColor" opacity=".92"/>
        <circle cx="12" cy="15.2" r="1.5" fill="#07184d"/>
      </svg>`;
  }

  function ensureLevelsOverlay() {
    if (levelsOverlay?.isConnected) return levelsOverlay;

    levelsOverlay = document.createElement("section");
    levelsOverlay.className = "ptb-levels-overlay";
    levelsOverlay.setAttribute("aria-hidden", "true");
    levelsOverlay.innerHTML = `
      <div class="ptb-levels-panel" role="dialog" aria-modal="true" aria-label="Page des niveaux">
        <div class="ptb-levels-scroll">
          <header class="ptb-levels-header">
            <button type="button" class="ptb-levels-back" aria-label="Retour">
              <img src="/back-arrow.png" alt="">
            </button>
            <h1 class="ptb-levels-title">Niveaux</h1>
          </header>

          <section class="ptb-levels-hero">
            <div class="ptb-levels-hero-top">
              <div class="ptb-levels-hero-badge">
                <img src="/level-badge-v1.png" alt="">
                <b data-level-current>1</b>
              </div>

              <div class="ptb-levels-hero-copy">
                <h2>Niveau actuel</h2>
                <p data-level-next-message>Continue de jouer pour atteindre le niveau 2 !</p>
                <div class="ptb-levels-hero-track" role="progressbar" aria-label="Progression du niveau actuel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                  <i class="ptb-levels-hero-fill"></i>
                </div>
                <div class="ptb-levels-hero-meta">
                  <strong data-level-xp>0 / 100 XP</strong>
                </div>
              </div>
            </div>
            <div class="ptb-levels-hero-reward">
              <img src="/coin.png" alt="">
              <span>Récompense du niveau : <b data-level-reward>50 pièces</b></span>
            </div>
          </section>

          <section class="ptb-levels-list" aria-label="Progression des niveaux">
            <span class="ptb-levels-line" aria-hidden="true"></span>
            <div data-level-rows></div>
          </section>

          <section class="ptb-levels-help">
            <div class="ptb-levels-help-icon" aria-hidden="true"><span><i></i><i></i><i></i></span></div>
            <div class="ptb-levels-help-copy">
              <strong>Joue des parties et gagne de l’XP</strong>
              <small>Plus tu joues, plus tu montes de niveau !</small>
            </div>
          </section>
        </div>
      </div>`;

    levelsOverlay.addEventListener("click", event => {
      if (event.target === levelsOverlay) closeLevelsOverlay();
    });
    levelsOverlay.querySelector(".ptb-levels-back")?.addEventListener("click", closeLevelsOverlay);
    levelsOverlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLevelsOverlay();
      }
    });

    document.body.appendChild(levelsOverlay);
    return levelsOverlay;
  }

  function renderLevelsOverlay() {
    const overlay = ensureLevelsOverlay();
    const current = readCache() || normalizeState({ level:1, totalXp:0, xpIntoLevel:0, xpForNext:100, progress:0, progressPercent:0, maxLevel:false, trophies:0, completedGames:0, wins:0 });

    const levelNode = overlay.querySelector("[data-level-current]");
    const nextNode = overlay.querySelector("[data-level-next-message]");
    const xpNode = overlay.querySelector("[data-level-xp]");
    const rewardNode = overlay.querySelector("[data-level-reward]");
    const track = overlay.querySelector(".ptb-levels-hero-track");
    const fill = overlay.querySelector(".ptb-levels-hero-fill");
    const rowsHost = overlay.querySelector("[data-level-rows]");

    if (levelNode) levelNode.textContent = String(current.level);
    if (nextNode) {
      nextNode.textContent = current.maxLevel
        ? "Niveau maximum atteint !"
        : `Continue de jouer pour atteindre le niveau ${Math.min(50, current.level + 1)} !`;
    }
    if (xpNode) {
      xpNode.textContent = current.maxLevel
        ? "Niveau maximum"
        : `${current.xpIntoLevel} / ${current.xpForNext} XP`;
    }
    if (rewardNode) rewardNode.textContent = `${levelRewardCoins()} pièces`;
    if (track) track.setAttribute("aria-valuenow", String(Math.round(current.progressPercent)));
    if (fill) fill.style.width = `${current.progressPercent}%`;

    const parts = [];
    for (let level = 1; level <= 50; level += 1) {
      const status = levelStatus(level, current.level);
      const statusMarkup = status === "completed"
        ? '<i class="ptb-check">✓</i>'
        : status === "current"
          ? '<i class="ptb-current"></i>'
          : lockIconMarkup();

      parts.push(`
        <article class="ptb-level-row is-${status}" data-level-row="${level}">
          <i class="ptb-level-dot" aria-hidden="true"></i>
          <div class="ptb-level-card">
            <div class="ptb-level-mini-badge">
              <img src="/level-badge-v1.png" alt="">
              <b>${level}</b>
            </div>
            <div class="ptb-level-copy">
              <strong>Niveau ${level}</strong>
              <small>${escapeHtml(levelSubtitle(level, current.level))}</small>
            </div>
            <div class="ptb-level-reward">
              <img src="/coin.png" alt="">
              <span>${levelRewardCoins()} pièces</span>
            </div>
            <div class="ptb-level-status">${statusMarkup}</div>
          </div>
        </article>`);
    }
    if (rowsHost) rowsHost.innerHTML = parts.join("");
  }

  function openLevelsOverlay(trigger) {
    if (trigger?.focus) lastFocusedTrigger = trigger;
    renderLevelsOverlay();

    const overlay = ensureLevelsOverlay();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      overlay.querySelector(".ptb-levels-back")?.focus();
      const currentLevel = readCache()?.level || 1;
      const row = overlay.querySelector(`[data-level-row="${currentLevel}"]`);
      row?.scrollIntoView({ block:"center", behavior:"smooth" });
    });
  }

  function closeLevelsOverlay() {
    if (!levelsOverlay) return;
    levelsOverlay.classList.remove("is-open");
    levelsOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocusedTrigger?.focus) {
      const target = lastFocusedTrigger;
      lastFocusedTrigger = null;
      setTimeout(() => target.focus(), 20);
    }
  }

  function bindLevelEntry(copy, target) {
    if (!copy || !target || target.dataset.ptbLevelTriggerBound === "1") return;
    target.dataset.ptbLevelTriggerBound = "1";
    target.classList.add("ptb-level-entry-trigger");
    target.setAttribute("role", "button");
    target.setAttribute("tabindex", "0");
    target.setAttribute("aria-label", "Ouvrir la page des niveaux");

    const open = event => {
      event.preventDefault();
      event.stopPropagation();
      requestState({ force:false }).catch(() => readCache()).finally(() => openLevelsOverlay(target));
    };

    target.addEventListener("click", open);
    target.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event);
      }
    });
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

    bindLevelEntry(copy, level);
    bindLevelEntry(copy, bar);
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
    refresh: () => requestState({ force:true }),
    openLevels: trigger => openLevelsOverlay(trigger || document.activeElement || null)
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
  } else {
    start();
  }
})();
