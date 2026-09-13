(() => {
"use strict";

const INTRO_MS = 5000;
const introByRound = new Map();
const originalRenderRound = window.renderRound;

if (typeof originalRenderRound !== "function") {
  console.warn("P'tit Bac: renderRound introuvable, intro de manche désactivée.");
  return;
}

function roundKey(state) {
  return `${state?.code || "room"}:${state?.roundEndsAt || ""}:${Number(state?.roundIndex ?? -1)}`;
}

function getIntroState(state) {
  const key = roundKey(state);
  let entry = introByRound.get(key);
  if (!entry) {
    for (const old of introByRound.values()) clearTimeout(old.timeoutId);
    introByRound.clear();
    const endsAt = Number(state.roundStartsAt) || (Number(state.roundEndsAt) - Number(state.duration) * 1000);
    entry = { startedAt: Date.now(), endsAt: Number.isFinite(endsAt) ? endsAt : Date.now(), finished:false, timeoutId:null };
    entry.timeoutId = window.setTimeout(() => {
      if (entry.finished) return;
      entry.finished = true;
      const live = session?.state;
      if (!live || live.phase !== "round" || roundKey(live) !== key) return;
      originalRenderRound();
    }, Math.max(0, entry.endsAt - Date.now()));
    introByRound.set(key, entry);
  }
  return entry;
}

function categoryEmoji(category) {
  try {
    if (typeof window.categoryIcon === "function") return window.categoryIcon(category);
    if (typeof categoryIcon === "function") return categoryIcon(category);
  } catch {}
  return "✨";
}

function escape(value) {
  try {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(value);
    if (typeof escapeHtml === "function") return escapeHtml(value);
  } catch {}
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function leaveRound(state) { gameExitModal(state, me(), "pri-exit"); }

function renderRoundIntro(state, entry) {
  clearInterval(session.timerHandle);
  const letter = String(state.currentLetter || state.letters?.[state.roundIndex] || "?").slice(0,1).toUpperCase();
  const roundNumber = Math.max(1, Number(state.roundIndex || 0) + 1);
  const categories = Array.isArray(state.categories) ? state.categories : [];
  const duration = Math.max(0, Number(state.duration || 0));
  const categoryCards = categories.map(category => `
    <div class="recap-category">
      <span class="recap-category-icon" aria-hidden="true">${categoryEmoji(category)}</span>
      <strong>${escape(category)}</strong>
    </div>`).join("");

  setScreen(`
    <main class="pri-screen recap-screen">
      <header class="recap-top">
        <button class="recap-exit" id="priExit" type="button" aria-label="Quitter la partie"><img src="/lobby-exit.png" alt=""></button>
        <img class="recap-brand" src="/ptitbac.logo.png" alt="P’tit Bac" width="62" height="52">
        <span class="recap-round">Manche ${roundNumber}/${Math.max(roundNumber, Number(state.rounds) || 1)}</span>
      </header>

      <nav class="recap-steps" aria-label="Étapes de la manche">
        <span>Catégories</span><i>•</i><span>Lettre</span><i>•</i><strong aria-current="step">À vous de jouer</strong>
      </nav>

      <section class="recap-hero">
        <div class="recap-flag" aria-hidden="true"><img src="/round-flag.png" alt=""></div>
        <h1>Manche <span>${roundNumber}</span></h1>
        <p>Prépare-toi !</p>
      </section>

      <section class="recap-countdown-card">
        <p>La manche commence dans</p>
        <div class="pri-countdown-ring"><strong id="priCountdown">5</strong></div>
      </section>

      <section class="recap-stats" aria-label="Récapitulatif de la manche">
        <article class="recap-letter-card">
          <small>Lettre</small>
          <div class="recap-letter">${escape(letter)}</div>
        </article>
        <div class="recap-facts">
          <div><img src="/lobby-categories.png" alt=""><strong>${categories.length}</strong><span>catégories</span></div>
          <div><img src="/lobby-clock.png" alt=""><strong>${duration}</strong><span>secondes</span></div>
        </div>
      </section>

      <section class="recap-categories-panel" aria-labelledby="recapCategoriesTitle">
        <div class="recap-panel-title"><i></i><strong id="recapCategoriesTitle">Les catégories de cette manche</strong><i></i></div>
        <div class="recap-categories-grid">${categoryCards}</div>
      </section>
    </main>`);

  document.getElementById("priExit")?.addEventListener("click", () => leaveRound(state));
  const countdown = document.getElementById("priCountdown");
  countdown?.closest(".pri-countdown-ring")?.style.setProperty("--pri-progress","1");

  const finishIntro = () => {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.timeoutId) { clearTimeout(entry.timeoutId); entry.timeoutId = null; }
    const live = session?.state;
    if (!live || live.phase !== "round" || roundKey(live) !== roundKey(state)) return;
    originalRenderRound();
  };

  const tick = () => {
    if (!countdown || !countdown.isConnected || entry.finished) return;
    const remaining = entry.endsAt - Date.now();
    if (remaining <= 0) { finishIntro(); return; }
    countdown.textContent = String(Math.ceil(remaining / 1000));
    const ring = countdown.closest(".pri-countdown-ring");
    if (ring) ring.style.setProperty("--pri-progress", String(Math.max(0, Math.min(1, remaining / INTRO_MS))));
    window.requestAnimationFrame(tick);
  };
  tick();
}

function wrappedRenderRound() {
  const state = session?.state;
  if (!state || state.phase !== "round") return originalRenderRound();
  const entry = getIntroState(state);
  if (entry.finished || Date.now() >= entry.endsAt) { entry.finished = true; return originalRenderRound(); }
  renderRoundIntro(state, entry);
}

window.renderRound = wrappedRenderRound;
try { renderRound = wrappedRenderRound; } catch {}

if (typeof socket !== "undefined") {
  socket.on("room:state", state => {
    if (!state) return;
    const currentIndex = Number(state.roundIndex ?? -1);
    for (const key of introByRound.keys()) {
      const index = Number(key.split(":").pop());
      if (index < currentIndex - 1) {
        const old = introByRound.get(key);
        if (old?.timeoutId) clearTimeout(old.timeoutId);
        introByRound.delete(key);
      }
    }
  });
}
})();