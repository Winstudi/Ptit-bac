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
      .ptb-level-entry-trigger:focus-visible{
        outline:2px solid rgba(118,224,255,.95);
        outline-offset:2px;
        border-radius:999px;
      }

      .ptb-levels-overlay{
        position:fixed;inset:0;z-index:100030;display:flex;align-items:stretch;justify-content:center;
        background:rgba(0,0,0,.32);
        opacity:0;pointer-events:none;transition:opacity .24s ease;
      }
      .ptb-levels-overlay.is-open{opacity:1;pointer-events:auto}
      .ptb-levels-panel{
        width:min(100vw,430px);height:100%;overflow:hidden;position:relative;
        background:
          radial-gradient(circle at 85% 3%,rgba(172,80,255,.20),transparent 15%),
          radial-gradient(circle at 14% 95%,rgba(76,107,255,.34),transparent 18%),
          radial-gradient(circle at 8% 100%,rgba(93,54,255,.26),transparent 24%),
          linear-gradient(180deg,#07134b 0%,#061446 100%);
        color:#fff;
        font-family:"DM Sans",system-ui,sans-serif;
      }
      .ptb-levels-panel::before{
        content:"";position:absolute;inset:0;pointer-events:none;opacity:.9;
        background:
          radial-gradient(circle at 15% 8%,rgba(255,255,255,.18) 0 1.2px,transparent 1.4px),
          radial-gradient(circle at 72% 10%,rgba(255,255,255,.15) 0 1.2px,transparent 1.4px),
          radial-gradient(circle at 40% 36%,rgba(255,255,255,.12) 0 1px,transparent 1.2px),
          radial-gradient(circle at 90% 42%,rgba(255,255,255,.10) 0 1.1px,transparent 1.3px),
          radial-gradient(circle at 62% 68%,rgba(255,255,255,.08) 0 .9px,transparent 1.1px);
      }
      .ptb-levels-scroll{position:relative;height:100%;overflow:auto;padding:18px 16px 28px;scroll-behavior:smooth}
      .ptb-levels-scroll::-webkit-scrollbar{width:0;height:0}
      .ptb-levels-header{display:flex;align-items:center;justify-content:center;position:relative;padding:0 0 14px}
      .ptb-levels-back{
        position:absolute;left:0;top:0;width:52px;height:52px;border:1px solid rgba(82,158,255,.68);border-radius:16px;
        background:linear-gradient(180deg,#164ac9,#0b2f8b);box-shadow:inset 0 1px 2px rgba(255,255,255,.16),0 0 0 2px rgba(25,108,255,.12),0 10px 22px rgba(0,0,0,.22),0 0 24px rgba(63,154,255,.32);
        display:grid;place-items:center;cursor:pointer;
      }
      .ptb-levels-back img{width:22px;height:22px;object-fit:contain;display:block;filter:brightness(1.18)}
      .ptb-levels-title{
        margin:0;font-size:3.05rem;font-weight:1000;letter-spacing:-.03em;color:#fff;
        text-shadow:0 0 12px rgba(125,229,255,.35),0 0 18px rgba(185,96,255,.40),0 4px 10px rgba(0,0,0,.28)
      }

      .ptb-levels-hero{
        position:relative;overflow:hidden;border-radius:32px;padding:20px 18px 18px;
        background:linear-gradient(180deg,rgba(11,33,119,.97),rgba(6,19,78,.98));
        border:1px solid rgba(78,194,255,.62);
        box-shadow:inset 0 0 0 1px rgba(115,105,255,.22),0 0 0 2px rgba(65,75,255,.10),0 0 18px rgba(53,173,255,.28),0 0 28px rgba(200,75,255,.20);
      }
      .ptb-levels-hero::after{
        content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
        box-shadow:inset -4px -3px 18px rgba(217,77,255,.18),inset 4px 3px 18px rgba(80,221,255,.12);
      }
      .ptb-levels-hero-top{display:grid;grid-template-columns:124px minmax(0,1fr);gap:18px;align-items:center}
      .ptb-levels-hero-badge{position:relative;width:124px;height:124px;display:grid;place-items:center}
      .ptb-levels-hero-badge img{width:124px;height:124px;display:block;object-fit:contain;filter:drop-shadow(0 8px 12px rgba(0,0,0,.28))}
      .ptb-levels-hero-badge b{position:absolute;inset:0;display:grid;place-items:center;font-size:4rem;font-weight:1000;letter-spacing:-.06em;text-shadow:0 4px 8px rgba(8,10,43,.96)}
      .ptb-levels-hero-copy h2{margin:0 0 14px;font-size:1.12rem;font-weight:900;color:#f5dbff}
      .ptb-levels-hero-track{
        width:100%;height:50px;padding:0 12%;box-sizing:border-box;display:flex;align-items:center;
        background:url('/level-bar-shell-v1.png') center/100% 100% no-repeat;
        filter:drop-shadow(0 8px 14px rgba(0,0,0,.22));
      }
      .ptb-levels-hero-fill{
        position:relative;display:block;height:15px;width:0;border-radius:999px;overflow:hidden;min-width:0;
        background:linear-gradient(90deg,#69e6ff 0%,#45d6ff 20%,#4d8fff 48%,#8c5bff 74%,#f257ff 100%);
        box-shadow:inset 0 1px 1px rgba(255,255,255,.72),0 0 6px rgba(47,214,255,.95),0 0 10px rgba(88,96,255,.64),0 0 12px rgba(211,75,255,.35);
        transition:width .48s cubic-bezier(.22,.8,.28,1);
      }
      .ptb-levels-hero-fill::after{
        content:"";position:absolute;left:8px;right:8px;top:2px;height:3px;border-radius:999px;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.82),transparent);opacity:.72;
      }
      .ptb-levels-hero-meta{margin-top:8px;display:block;font-size:1.04rem;font-weight:1000;color:#eef5ff}
      .ptb-levels-hero-meta strong{font-size:1.34rem;letter-spacing:-.02em}
      .ptb-levels-hero-reward{
        margin-top:16px;border-radius:22px;padding:14px 18px;display:flex;align-items:center;gap:14px;
        background:linear-gradient(180deg,rgba(7,25,95,.95),rgba(8,20,78,.95));
        border:1px solid rgba(84,113,255,.28);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
      }
      .ptb-levels-hero-reward img{width:42px;height:42px;object-fit:contain;display:block;filter:drop-shadow(0 6px 10px rgba(0,0,0,.22))}
      .ptb-levels-hero-reward span{font-size:1rem;font-weight:800;color:#edf0ff}
      .ptb-levels-hero-reward b{color:#ffd85f;font-size:1.12rem}

      .ptb-levels-list{position:relative;margin-top:16px;padding-left:28px}
      .ptb-levels-line{
        position:absolute;left:7px;top:8px;bottom:70px;width:3px;border-radius:999px;
        background:linear-gradient(180deg,#49e1ff 0%,#66dbff 30%,#8a93ff 64%,#afb8ff 100%);
        box-shadow:0 0 10px rgba(87,209,255,.45);
      }
      .ptb-level-row{position:relative;margin:0 0 12px}
      .ptb-level-dot{
        position:absolute;left:-32px;top:34px;width:18px;height:18px;border-radius:50%;
        border:3px solid rgba(169,192,255,.88);background:transparent;box-shadow:0 0 0 2px rgba(0,0,0,.06);
      }
      .ptb-level-row.is-completed .ptb-level-dot{
        width:32px;height:32px;left:-39px;top:27px;border:none;
        background:radial-gradient(circle at 35% 35%,#abf4ff 0 32%,#62d7ff 33%,#53bfff 62%,#1c85d6 100%);
        box-shadow:0 0 18px rgba(84,214,255,.55);
      }
      .ptb-level-row.is-current .ptb-level-dot{
        width:34px;height:34px;left:-40px;top:26px;border:5px solid rgba(228,145,255,.55);background:#ffffff;
        box-shadow:0 0 0 2px rgba(112,112,255,.12),0 0 22px rgba(221,108,255,.45);
      }
      .ptb-level-card{
        min-height:104px;border-radius:24px;padding:14px 16px;display:grid;align-items:center;
        grid-template-columns:104px minmax(0,1fr) 170px 54px;gap:14px;
        background:linear-gradient(180deg,rgba(10,32,111,.98),rgba(6,24,91,.98));
        border:1px solid rgba(77,121,255,.28);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 12px 24px rgba(0,0,0,.16);
      }
      .ptb-level-row.is-current .ptb-level-card{
        background:linear-gradient(90deg,rgba(10,43,141,.98) 0%,rgba(28,49,166,.98) 52%,rgba(89,31,154,.98) 100%);
        border-color:rgba(105,216,255,.58);
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 0 16px rgba(61,194,255,.32),0 0 18px rgba(213,86,255,.26);
      }
      .ptb-level-row.is-locked .ptb-level-card{opacity:.98}
      .ptb-level-mini-badge{position:relative;width:104px;height:104px;display:grid;place-items:center;justify-self:start}
      .ptb-level-mini-badge img{width:104px;height:104px;object-fit:contain;display:block;filter:drop-shadow(0 7px 10px rgba(0,0,0,.22))}
      .ptb-level-row.is-completed .ptb-level-mini-badge img{width:88px;height:88px}
      .ptb-level-row.is-locked .ptb-level-mini-badge img{filter:grayscale(.35) saturate(.58) brightness(.88) drop-shadow(0 7px 10px rgba(0,0,0,.20))}
      .ptb-level-mini-badge b{position:absolute;inset:0;display:grid;place-items:center;font-size:3.28rem;font-weight:1000;letter-spacing:-.05em;text-shadow:0 3px 6px rgba(7,10,41,.98)}
      .ptb-level-row.is-completed .ptb-level-mini-badge b,
      .ptb-level-row.is-locked .ptb-level-mini-badge b{font-size:2.35rem}
      .ptb-level-copy{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
      .ptb-level-copy strong{display:block;font-size:1.18rem;line-height:1.06;color:#fff}
      .ptb-level-copy small{display:block;font-size:1rem;line-height:1.06;color:#9fb0ef;font-weight:700}
      .ptb-level-row.is-completed .ptb-level-copy small{color:#50f4ff}
      .ptb-level-row.is-current .ptb-level-copy small{
        color:#fff;border-radius:999px;padding:8px 18px;font-weight:900;
        background:linear-gradient(90deg,#36d7ff,#7a8aff 56%,#e55bff);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 0 12px rgba(94,207,255,.30)
      }
      .ptb-level-reward{
        justify-self:end;width:100%;height:58px;border-radius:20px;padding:0 18px;box-sizing:border-box;
        display:flex;align-items:center;justify-content:flex-start;gap:12px;
        background:linear-gradient(180deg,rgba(8,22,76,.95),rgba(7,18,62,.95));
        border:1px solid rgba(71,90,194,.36);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)
      }
      .ptb-level-reward img{width:36px;height:36px;object-fit:contain;display:block;filter:drop-shadow(0 6px 8px rgba(0,0,0,.18))}
      .ptb-level-reward span{font-size:1rem;font-weight:900;color:#ffe26f;white-space:nowrap}
      .ptb-level-status{display:grid;place-items:center;justify-self:end;width:54px;height:54px}
      .ptb-level-status i,.ptb-level-status img{display:block}
      .ptb-level-status .ptb-check{
        width:50px;height:50px;border-radius:50%;display:grid;place-items:center;
        border:4px solid rgba(72,225,255,.95);background:rgba(10,31,104,.84);color:#7af0ff;font-weight:1000;font-style:normal;font-size:1.8rem;
        box-shadow:0 0 18px rgba(72,225,255,.30);
      }
      .ptb-level-status .ptb-empty{width:50px;height:50px}

      .ptb-levels-footer{padding:10px 0 0;text-align:center}
      .ptb-levels-footer-dots{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px}
      .ptb-levels-footer-dots i{width:7px;height:7px;border-radius:50%;background:#9baeff;box-shadow:0 0 10px rgba(155,174,255,.35)}
      .ptb-levels-footer p{margin:0;color:#b9bffc;font-size:1rem;font-weight:600}

      @media (max-width:420px){
        .ptb-levels-scroll{padding:16px 14px 24px}
        .ptb-levels-title{font-size:2.75rem}
        .ptb-levels-hero{padding:18px 16px 16px}
        .ptb-levels-hero-top{grid-template-columns:112px minmax(0,1fr);gap:14px}
        .ptb-levels-hero-badge,.ptb-levels-hero-badge img{width:112px;height:112px}
        .ptb-levels-hero-badge b{font-size:3.65rem}
        .ptb-levels-hero-track{height:46px}
        .ptb-levels-hero-fill{height:13px}
        .ptb-levels-hero-meta strong{font-size:1.22rem}
        .ptb-levels-hero-reward{padding:12px 14px;gap:12px}
        .ptb-levels-hero-reward img{width:38px;height:38px}
        .ptb-levels-line{left:8px}
        .ptb-level-card{min-height:98px;grid-template-columns:86px minmax(0,1fr) 136px 42px;gap:10px;padding:12px 12px 12px 12px}
        .ptb-level-mini-badge{width:86px;height:86px}
        .ptb-level-mini-badge img{width:86px;height:86px}
        .ptb-level-row.is-completed .ptb-level-mini-badge img{width:74px;height:74px}
        .ptb-level-mini-badge b{font-size:2.8rem}
        .ptb-level-row.is-completed .ptb-level-mini-badge b,.ptb-level-row.is-locked .ptb-level-mini-badge b{font-size:2rem}
        .ptb-level-copy strong{font-size:1rem}
        .ptb-level-copy small{font-size:.92rem}
        .ptb-level-row.is-current .ptb-level-copy small{padding:7px 14px}
        .ptb-level-reward{height:54px;padding:0 14px;gap:10px;border-radius:18px}
        .ptb-level-reward img{width:32px;height:32px}
        .ptb-level-reward span{font-size:.92rem}
        .ptb-level-status,.ptb-level-status .ptb-empty{width:42px;height:42px}
        .ptb-level-status .ptb-check{width:42px;height:42px;font-size:1.55rem;border-width:3px}
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

  function visibleLevelWindow(currentLevel) {
    const safeLevel = Math.max(1, Math.min(50, Math.floor(Number(currentLevel) || 1)));
    const start = Math.max(1, Math.min(safeLevel - 3, 44));
    const end = Math.min(50, start + 6);
    return { start, end };
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
              <img src="/coin.png" alt="">
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
