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

      .ptb-level-entry-trigger{cursor:pointer;pointer-events:auto!important;touch-action:manipulation}

      .ptb-levels-overlay{
        position:fixed;inset:0;z-index:100030;display:flex;align-items:stretch;justify-content:center;
        background:#03092d;opacity:0;pointer-events:none;transition:opacity .2s ease;
      }
      .ptb-levels-overlay.is-open{opacity:1;pointer-events:auto}
      .ptb-levels-panel{
        width:min(100vw,430px);height:100%;overflow:hidden;position:relative;color:#fff;
        font-family:"DM Sans",system-ui,sans-serif;
        background:
          radial-gradient(circle at -6% 104%,rgba(52,92,255,.70) 0 11%,transparent 25%),
          radial-gradient(circle at 108% 103%,rgba(76,74,255,.48) 0 9%,transparent 23%),
          radial-gradient(circle at 82% 2%,rgba(123,48,255,.22),transparent 18%),
          linear-gradient(180deg,#06134c 0%,#061343 55%,#07123d 100%);
      }
      .ptb-levels-panel::before{
        content:"";position:absolute;inset:0;pointer-events:none;opacity:.78;
        background:
          radial-gradient(circle at 16% 9%,rgba(255,255,255,.22) 0 1px,transparent 1.5px),
          radial-gradient(circle at 71% 8%,rgba(255,255,255,.16) 0 1px,transparent 1.4px),
          radial-gradient(circle at 93% 23%,rgba(158,116,255,.27) 0 1.4px,transparent 2px),
          radial-gradient(circle at 31% 49%,rgba(255,255,255,.12) 0 .9px,transparent 1.4px),
          radial-gradient(circle at 79% 62%,rgba(255,255,255,.10) 0 .9px,transparent 1.3px);
      }
      .ptb-levels-scroll{
        position:relative;height:100%;overflow:auto;padding:14px 13px 22px;scroll-behavior:smooth;
        scrollbar-width:none;
      }
      .ptb-levels-scroll::-webkit-scrollbar{display:none}
      .ptb-levels-header{display:flex;align-items:center;justify-content:center;position:relative;height:56px;margin-bottom:8px}
      .ptb-levels-header::after{
        content:"";position:absolute;right:3px;top:2px;width:42px;height:42px;opacity:.22;pointer-events:none;
        background:#8249ff;clip-path:polygon(50% 0,61% 34%,98% 35%,68% 57%,79% 94%,50% 72%,21% 94%,32% 57%,2% 35%,39% 34%);
        filter:blur(.2px) drop-shadow(0 0 10px rgba(133,74,255,.58));transform:rotate(14deg)
      }
      .ptb-levels-back{
        position:absolute;left:1px;top:5px;width:40px;height:40px;padding:0;border:0;border-radius:0;
        background:transparent;display:grid;place-items:center;cursor:pointer;box-shadow:none
      }
      .ptb-levels-back img{width:24px;height:24px;object-fit:contain;display:block;filter:none}
      .ptb-levels-title{
        margin:0;font-size:2.05rem;line-height:1;font-weight:1000;letter-spacing:-.035em;color:#fff;
        text-shadow:0 0 10px rgba(90,221,255,.30),0 0 14px rgba(196,87,255,.42),0 4px 8px rgba(0,0,0,.26)
      }

      .ptb-levels-hero{
        position:relative;z-index:2;border:2px solid transparent;border-radius:26px;padding:13px 14px 12px;
        background:
          linear-gradient(180deg,rgba(8,31,112,.98),rgba(5,18,71,.99)) padding-box,
          linear-gradient(100deg,#40e8ff 0%,#328dff 38%,#7f69ff 67%,#f45bff 100%) border-box;
        box-shadow:0 0 16px rgba(43,182,255,.27),0 0 20px rgba(215,69,255,.15),inset 0 0 28px rgba(31,83,206,.10)
      }
      .ptb-levels-hero-top{display:grid;grid-template-columns:92px minmax(0,1fr);gap:12px;align-items:center}
      .ptb-levels-hero-badge{position:relative;width:92px;height:92px;display:grid;place-items:center}
      .ptb-levels-hero-badge img{width:92px;height:92px;display:block;object-fit:contain;filter:drop-shadow(0 7px 10px rgba(0,0,0,.24))}
      .ptb-levels-hero-badge b{position:absolute;left:50%;top:50%;width:100%;transform:translate(-50%,-53%);display:grid;place-items:center;font-size:2.7rem;line-height:1;font-weight:1000;letter-spacing:-.05em;text-align:center;text-shadow:0 3px 7px rgba(5,9,45,.98)}
      .ptb-levels-hero-copy{min-width:0;align-self:center}
      .ptb-levels-hero-copy h2{margin:0 0 7px;font-size:.92rem;line-height:1;font-weight:900;color:#e6c8ff}
      .ptb-levels-hero-track{
        width:100%;height:42px;padding:0 12%;box-sizing:border-box;display:flex;align-items:center;
        background:url('/level-bar-shell-v1.png') center/100% 100% no-repeat;
        filter:drop-shadow(0 6px 12px rgba(0,0,0,.18))
      }
      .ptb-levels-hero-fill{
        position:relative;display:block;height:15px;width:0;border-radius:999px;overflow:hidden;min-width:0;
        background:linear-gradient(90deg,#5fe6ff 0%,#3ed3ff 24%,#4d8fff 49%,#8c5bff 74%,#ef57ff 100%);
        box-shadow:inset 0 1px 1px rgba(255,255,255,.78),0 0 5px rgba(54,218,255,.88),0 0 8px rgba(107,92,255,.52);
        transition:width .45s cubic-bezier(.22,.8,.28,1)
      }
      .ptb-levels-hero-fill::after{
        content:"";position:absolute;left:6px;right:6px;top:2px;height:2px;border-radius:999px;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.76),transparent)
      }
      .ptb-levels-hero-meta{margin-top:4px;color:#f4f6ff;font-weight:1000;line-height:1}
      .ptb-levels-hero-meta strong{font-size:1rem;letter-spacing:-.02em}
      .ptb-levels-hero-reward{
        margin-top:10px;min-height:38px;border-radius:18px;padding:5px 12px;display:flex;align-items:center;justify-content:center;gap:9px;
        background:rgba(6,24,87,.88);border:1px solid rgba(67,92,211,.40);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)
      }
      .ptb-level-coin{
        width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:grid;place-items:center;font-style:normal;
        color:#fff4ad;font-size:.82rem;font-weight:1000;
        background:radial-gradient(circle at 35% 28%,#fff08d 0 8%,#ffc229 24%,#e9960b 63%,#c97800 100%);
        border:2px solid #ffcf4d;box-shadow:inset 0 0 0 2px rgba(255,240,143,.28),0 0 10px rgba(255,176,25,.42)
      }
      .ptb-levels-hero-reward span{font-size:.73rem;line-height:1;font-weight:800;color:#eef0ff;white-space:nowrap}
      .ptb-levels-hero-reward b{color:#ffdd64;font-size:.82rem}

      .ptb-levels-list{position:relative;z-index:1;margin-top:12px;padding-left:31px}
      .ptb-levels-line{
        position:absolute;left:11px;top:-18px;bottom:45px;width:2px;border-radius:999px;
        background:linear-gradient(180deg,#4be7ff 0%,#62d9ff 28%,#8a98ff 65%,#adb8ff 100%);
        box-shadow:0 0 7px rgba(88,213,255,.38)
      }
      .ptb-level-row{position:relative;margin:0 0 7px}
      .ptb-level-dot{
        position:absolute;left:-25.5px;top:50%;transform:translateY(-50%);width:13px;height:13px;border-radius:50%;box-sizing:border-box;
        border:2px solid rgba(155,177,246,.82);background:#07184f;box-shadow:0 0 0 2px rgba(91,112,208,.18)
      }
      .ptb-level-row.is-completed .ptb-level-dot{
        left:-31.5px;width:25px;height:25px;border:2px solid #4ce9ff;background:#0f83ca;color:#fff;
        box-shadow:0 0 11px rgba(77,222,255,.52)
      }
      .ptb-level-row.is-completed .ptb-level-dot::after{
        content:"✓";position:absolute;inset:0;display:grid;place-items:center;font-style:normal;font-size:.76rem;font-weight:1000;color:#dfffff
      }
      .ptb-level-row.is-current .ptb-level-dot{
        left:-33px;width:28px;height:28px;border:4px solid #d278ff;background:#fff;
        box-shadow:0 0 0 2px rgba(121,97,255,.30),0 0 14px rgba(220,103,255,.46)
      }
      .ptb-level-card{
        position:relative;min-height:58px;border:1px solid rgba(73,111,229,.34);border-radius:17px;padding:6px 8px;display:grid;align-items:center;
        grid-template-columns:52px minmax(0,1fr) 104px;gap:7px;
        background:linear-gradient(180deg,rgba(8,29,102,.98),rgba(5,21,78,.98));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 8px 16px rgba(0,0,0,.12)
      }
      .ptb-level-row.is-current .ptb-level-card{
        min-height:68px;border:2px solid transparent;border-radius:18px;padding:5px 7px;
        background:
          linear-gradient(90deg,rgba(10,52,158,.99),rgba(27,53,171,.99) 55%,rgba(102,34,157,.99)) padding-box,
          linear-gradient(100deg,#52e7ff 0%,#557cff 55%,#f05cff 100%) border-box;
        box-shadow:0 0 13px rgba(64,201,255,.28),0 0 15px rgba(219,74,255,.22),inset 0 1px 0 rgba(255,255,255,.08)
      }
      .ptb-level-row.is-locked .ptb-level-card{opacity:.87}
      .ptb-level-mini-badge{position:relative;width:50px;height:50px;display:grid;place-items:center;justify-self:start}
      .ptb-level-mini-badge img{width:50px;height:50px;display:block;object-fit:contain;filter:drop-shadow(0 5px 7px rgba(0,0,0,.20))}
      .ptb-level-mini-badge b{position:absolute;left:50%;top:50%;width:100%;transform:translate(-50%,-53%);display:grid;place-items:center;font-size:1.35rem;line-height:1;font-weight:1000;letter-spacing:-.04em;text-align:center;text-shadow:0 2px 5px rgba(5,8,38,.96)}
      .ptb-level-row.is-completed .ptb-level-mini-badge img{width:46px;height:46px}
      .ptb-level-row.is-completed .ptb-level-mini-badge b{font-size:1.18rem}
      .ptb-level-row.is-current .ptb-level-mini-badge{width:60px;height:60px;margin-left:-4px}
      .ptb-level-row.is-current .ptb-level-mini-badge img{width:60px;height:60px}
      .ptb-level-row.is-current .ptb-level-mini-badge b{font-size:1.65rem}
      .ptb-level-row.is-locked .ptb-level-mini-badge img{filter:saturate(.58) brightness(.76) contrast(.94) drop-shadow(0 5px 7px rgba(0,0,0,.18))}
      .ptb-level-copy{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
      .ptb-level-copy strong{display:block;font-size:.73rem;line-height:1;font-weight:900;color:#fff;white-space:nowrap}
      .ptb-level-copy small{display:block;font-size:.63rem;line-height:1;font-weight:700;color:#9faeea;white-space:nowrap}
      .ptb-level-row.is-completed .ptb-level-copy small{color:#4ff2ff;font-weight:800}
      .ptb-level-row.is-current .ptb-level-copy small{
        margin-top:1px;padding:4px 11px;border-radius:999px;font-size:.62rem;font-weight:900;color:#fff;
        background:linear-gradient(90deg,#39d9ff,#718cff 56%,#e458ff);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)
      }
      .ptb-level-reward{
        grid-column:3;justify-self:end;width:104px;height:34px;border-radius:12px;padding:0 9px;box-sizing:border-box;
        display:flex;align-items:center;justify-content:flex-start;gap:6px;
        background:rgba(4,15,59,.94);border:1px solid rgba(61,80,177,.42);box-shadow:inset 0 1px 0 rgba(255,255,255,.03)
      }
      .ptb-level-reward .ptb-level-coin{width:23px;height:23px;flex-basis:23px;font-size:.66rem;border-width:1.5px}
      .ptb-level-reward span{font-size:.63rem;font-weight:900;color:#ffe16b;white-space:nowrap}
      .ptb-level-status{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:32px;height:32px;display:grid;place-items:center}
      .ptb-level-row.is-current .ptb-level-status,
      .ptb-level-row.is-locked .ptb-level-status{display:none}
      .ptb-level-row.is-completed .ptb-level-reward{margin-right:38px}
      .ptb-level-status .ptb-check{
        width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-style:normal;
        border:3px solid #4ce9ff;background:rgba(6,26,92,.88);color:#6ff3ff;font-size:.92rem;font-weight:1000;
        box-shadow:0 0 10px rgba(76,233,255,.30)
      }
      .ptb-level-status .ptb-empty{display:block;width:30px;height:30px}

      .ptb-levels-footer{padding:5px 0 0;text-align:center}
      .ptb-levels-footer-dots{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;margin-bottom:7px}
      .ptb-levels-footer-dots i{width:4px;height:4px;border-radius:50%;background:#9eaaff;box-shadow:0 0 6px rgba(155,174,255,.34)}
      .ptb-levels-footer p{margin:0;color:#aaaee8;font-size:.7rem;font-weight:600}

      @media(max-width:370px){
        .ptb-levels-scroll{padding-inline:10px}
        .ptb-levels-title{font-size:1.9rem}
        .ptb-levels-header{height:52px}
        .ptb-levels-back{width:36px;height:36px;top:5px}
        .ptb-levels-hero{padding:11px 11px 10px}
        .ptb-levels-hero-top{grid-template-columns:82px minmax(0,1fr);gap:9px}
        .ptb-levels-hero-badge,.ptb-levels-hero-badge img{width:82px;height:82px}
        .ptb-levels-hero-badge b{font-size:2.4rem}
        .ptb-levels-hero-copy h2{font-size:.82rem}
        .ptb-levels-hero-track{height:38px}
        .ptb-levels-hero-meta strong{font-size:.9rem}
        .ptb-levels-hero-reward{padding-inline:8px;gap:6px}
        .ptb-levels-hero-reward span{font-size:.64rem}
        .ptb-levels-hero-reward b{font-size:.73rem}
        .ptb-level-card{grid-template-columns:46px minmax(0,1fr) 92px;gap:5px;padding:5px 6px}
        .ptb-level-row.is-current .ptb-level-card{padding:4px 5px}
        .ptb-level-mini-badge,.ptb-level-mini-badge img{width:45px;height:45px}
        .ptb-level-row.is-current .ptb-level-mini-badge{width:54px;height:54px}
        .ptb-level-row.is-current .ptb-level-mini-badge img{width:54px;height:54px}
        .ptb-level-copy strong{font-size:.67rem}
        .ptb-level-copy small{font-size:.57rem}
        .ptb-level-reward{width:92px;height:31px;padding:0 7px;gap:5px}
        .ptb-level-reward .ptb-level-coin{width:20px;height:20px;flex-basis:20px}
        .ptb-level-reward span{font-size:.56rem}
        .ptb-level-status,.ptb-level-status .ptb-empty{width:28px;height:28px}
        .ptb-level-status{right:6px}
        .ptb-level-row.is-completed .ptb-level-reward{margin-right:32px}
        .ptb-level-status .ptb-check{width:27px;height:27px;font-size:.8rem}
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
    if (level < currentLevel) return "Complété !";
    if (level === currentLevel) return "Actuel";
    return "À venir";
  }

  function lockIconMarkup() {
    return "";
  }

  function visibleLevelWindow() {
    return { start: 1, end: 50 };
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
                <div class="ptb-levels-hero-track" role="progressbar" aria-label="Progression du niveau actuel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                  <i class="ptb-levels-hero-fill"></i>
                </div>
                <div class="ptb-levels-hero-meta">
                  <strong data-level-xp>0 / 100 XP</strong>
                </div>
              </div>
            </div>
            <div class="ptb-levels-hero-reward">
              <i class="ptb-level-coin" aria-hidden="true">★</i>
              <span>Récompense à chaque niveau : <b data-level-reward>50 pièces</b></span>
            </div>
          </section>

          <section class="ptb-levels-list" aria-label="Progression des niveaux">
            <span class="ptb-levels-line" aria-hidden="true"></span>
            <div data-level-rows></div>
            <footer class="ptb-levels-footer">
              <div class="ptb-levels-footer-dots" aria-hidden="true"><i></i><i></i><i></i></div>
              <p>Jusqu’au niveau 50...</p>
            </footer>
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
    const xpNode = overlay.querySelector("[data-level-xp]");
    const rewardNode = overlay.querySelector("[data-level-reward]");
    const track = overlay.querySelector(".ptb-levels-hero-track");
    const fill = overlay.querySelector(".ptb-levels-hero-fill");
    const rowsHost = overlay.querySelector("[data-level-rows]");

    if (levelNode) levelNode.textContent = String(current.level);
    if (xpNode) {
      xpNode.textContent = current.maxLevel
        ? "Niveau maximum"
        : `${current.xpIntoLevel} / ${current.xpForNext} XP`;
    }
    if (rewardNode) rewardNode.textContent = `${levelRewardCoins()} pièces`;
    if (track) track.setAttribute("aria-valuenow", String(Math.round(current.progressPercent)));
    if (fill) fill.style.width = `${current.progressPercent}%`;

    const { start, end } = visibleLevelWindow(current.level);
    const parts = [];
    for (let level = start; level <= end; level += 1) {
      const status = levelStatus(level, current.level);
      const statusMarkup = status === "completed"
        ? '<i class="ptb-check">✓</i>'
        : '<i class="ptb-empty"></i>';

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
              <i class="ptb-level-coin" aria-hidden="true">★</i>
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
    const profileButton = copy?.closest?.(".hm-profile");
    if (!copy || !profileButton || profileButton.dataset.ptbLevelTriggerBound === "1") return;

    profileButton.dataset.ptbLevelTriggerBound = "1";

    const isInside = (event, node) => {
      if (!node || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
      const rect = node.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    };

    profileButton.addEventListener("click", event => {
      const levelNode = copy.querySelector("small");
      const barNode = copy.querySelector(".ptb-home-xp-bar");
      if (!isInside(event, levelNode) && !isInside(event, barNode)) return;

      // Le badge et la barre sont des éléments décoratifs en pointer-events:none :
      // le tap arrive donc sur le bouton Profil. On l'intercepte seulement dans
      // leur zone pour ouvrir Niveaux, sans casser le clic avatar/pseudo.
      event.preventDefault();
      event.stopImmediatePropagation();

      requestState({ force:false })
        .catch(() => readCache())
        .finally(() => openLevelsOverlay(profileButton));
    }, true);
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
