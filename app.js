const CLIENT_BUILD = "1.46.0";
const socket = io();
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const session = {
  code: localStorage.getItem("petitbac_code") || "",
  playerId: localStorage.getItem("petitbac_playerId") || "",
  state: null,
  localAnswers: {},
  timerHandle: null,
  walletToken: localStorage.getItem("petitbac_walletToken") || "",
  walletBalance: Number(localStorage.getItem("petitbac_walletBalance") || "0"),
};

const GAME_COST = 0;
const PROFILE_ICONS = ["🐼","🦊","🐯","🐸","🦁","🐨","🐙","🦄","🤖","😎","🧠","⭐"];
const LETTER_WHEEL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function getProfile() {
  return {
    name: localStorage.getItem("petitbac_profile_name") || "",
    icon: localStorage.getItem("petitbac_profile_icon") || "🐼"
  };
}

function saveProfile(name, icon) {
  localStorage.setItem("petitbac_profile_name", String(name || "").trim().slice(0, 24));
  localStorage.setItem("petitbac_profile_icon", icon || "🐼");
}

function getCoins() {
  return Math.max(0, Math.floor(Number(session.walletBalance) || 0));
}

function setWalletState(token, balance) {
  if (token) {
    session.walletToken = token;
    localStorage.setItem("petitbac_walletToken", token);
  }
  if (Number.isFinite(Number(balance))) {
    session.walletBalance = Math.max(0, Math.floor(Number(balance)));
    localStorage.setItem("petitbac_walletBalance", String(session.walletBalance));
  }
}

function canAffordGame() {
  return true; // Participation contrôlée en vies par le serveur.
}

function initWallet(cb = () => {}) {
  socket.emit("wallet:init", { token: session.walletToken }, res => {
    if (!res?.ok) return cb(false);
    setWalletState(res.token, res.balance);
    cb(true);
  });
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

socket.on("toast", toast);
socket.on("wallet:update", ({ balance } = {}) => {
  setWalletState(session.walletToken, balance);
  if (!session.state) renderHome();
});
socket.on("room:kicked", () => {
  toast("Tu as été retiré du salon.");
  clearSession();
  renderHome();
});
socket.on("room:closed", payload => {
  if (payload?.reason !== "pre_game_cancelled") return;

  clearSession();

  const finish = () => {
    renderHome();
    toast(
      payload?.message ||
      "La partie a été annulée avant la première manche."
    );
  };

  if (typeof initWallet === "function") {
    initWallet(finish);
  } else {
    finish();
  }
});
socket.on("room:state", state => {
  const previous = session.state;
  session.state = state;
  // Keep the actual input nodes (and the mobile keyboard) during peer updates.
  if (state.phase === "round" && previous?.phase === "round" &&
      state.code === previous.code && state.roundEndsAt === previous.roundEndsAt &&
      !me()?.submitted && document.querySelector(".asv1-input")) return;
  render();
});

socket.on("connect", () => {
  initWallet(() => {
    if (session.code && session.playerId) {
      socket.emit("room:reconnect", { code: session.code, playerId: session.playerId, walletToken: session.walletToken }, res => {
        if (res?.ok) {
          setWalletState(session.walletToken, res.balance);
          session.state = res.state;
          render();
        } else {
          clearSession();
          renderHome();
        }
      });
    } else {
      renderHome();
    }
  });
});

function saveSession(code, playerId) {
  session.code = code;
  session.playerId = playerId;
  localStorage.setItem("petitbac_code", code);
  localStorage.setItem("petitbac_playerId", playerId);
}

function clearSession() {
  clearInterval(session.timerHandle);
  session.timerHandle = null;
  session.code = "";
  session.playerId = "";
  session.state = null;
  session.localAnswers = {};
  localStorage.removeItem("petitbac_code");
  localStorage.removeItem("petitbac_playerId");
}

function me() {
  return session.state?.players.find(p => p.id === session.playerId);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

const CATEGORY_ICONS = {
  "Prénom":"👤", "Animal":"🐾", "Lieu":"📍", "Métier":"💼", "Nourriture":"🍽️",
  "Marque":"🏷️", "Fruit / Légume":"🍏", "Objet":"🧊", "Sport":"🏆", "Mot":"🔤",
  "Vêtement":"👕", "Cadeau":"🎁", "Chose orange":"🟠", "Chose verte":"🟢",
  "Chose jaune":"🟡", "Cuisine":"🍳", "Maison":"🏠", "Salle de bain":"🚿",
  "Animal marin":"🐠", "Petit-déjeuner":"🥐", "Cinéma":"🎬", "Jeu vidéo":"🎮",
  "Personnage fictif":"🦸", "Dessert":"🍰", "Mobile":"📱",
  "Application / Réseau social":"📲", "Artiste / Chanteur":"🎤",
  "Chose dans une chambre":"🛏️", "Chose au supermarché":"🛒", "Vacances":"🧳",
  "Restaurant":"🍴", "Célébrité":"⭐", "Chose du frigo":"🧊",
  "Mot de 4 lettres":"🔡", "Chose qu’on achète sur Internet":"🛍️",
  "Chose qui fait peur":"😱", "Chose chère":"💰", "Chose à l’école":"🏫",
  "Plage":"🏖️", "Mode / Beauté":"💄", "Couleur":"🎨", "Ciel":"☁️", "Mythes":"🏛️"
};

function categoryIcon(category) {
  return CATEGORY_ICONS[category] || "✨";
}

function isImageAvatar(value) {
  return typeof value === "string" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

function avatarMarkup(player, index = 0, extra = "") {
    const raw = String(player?.avatar || "");
    const safeExtra = String(extra || "").replace(/[^a-zA-Z0-9 _-]/g, "");

    if (isImageAvatar(raw)) {
      return `
        <div class="avatar avatar-${index % 6} ptb-avatar-photo ${safeExtra}">
          <img src="${raw}" alt="" draggable="false">
        </div>`;
    }

    const fallback = raw || String(player?.name || "?").charAt(0).toUpperCase();
    return `
      <div class="avatar avatar-${index % 6} ${raw ? "avatar-emoji" : ""} ${safeExtra}">
        ${typeof escapeHtml === "function" ? escapeHtml(fallback) : fallback}
      </div>`;
  }

function updateGameViewport() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale !== 1) return; // Preserve pinch zoom.
  document.documentElement.style.setProperty("--game-height", (viewport?.height || window.innerHeight) + "px");
  document.documentElement.style.setProperty("--game-top", (viewport?.offsetTop || 0) + "px");
  window.requestAnimationFrame(() => {
    const input = document.activeElement;
    if (!input?.matches(".asv1-input")) return;
    const list = input.closest(".asv1-list");
    if (!list) return;
    const field = input.getBoundingClientRect(), area = list.getBoundingClientRect();
    if (field.bottom > area.bottom - 8) list.scrollTop += field.bottom - area.bottom + 8;
    else if (field.top < area.top + 8) list.scrollTop -= area.top - field.top + 8;
  });
}
window.visualViewport?.addEventListener("resize", updateGameViewport);
window.visualViewport?.addEventListener("scroll", updateGameViewport);
window.addEventListener("resize", updateGameViewport);

function setScreen(html) {
  const old = app.querySelector("main");
  const previousScreen = old?.className.replace(" flow-enter", "");
  const previousScroll = window.scrollY;
  const scrollers = [...app.querySelectorAll(".flow-content,.asv1-list,.cat-v2-grid,.wsv1-players,.pri-categories-panel")].map(el => [el.className, el.scrollTop]);
  app.innerHTML = html;
  const screen = app.querySelector("main");
  const gameplay = !!screen?.matches(".cat-v2,.pbw1-screen,.pri-screen,.asv1-screen,.wsv1-screen,.vsv1-screen,.ssv1-screen,.fsv1-screen");
  document.documentElement.classList.toggle("gameplay-flow", gameplay);
  updateGameViewport();
  if (gameplay) {
    screen.classList.add("flow-screen");
    screen.dataset.mode = session.state?.mode || "private";
    const footerImage = screen.querySelector("footer > img");
    if (footerImage) {
      footerImage.src = "/ptitbac.logo.png";
      footerImage.width = 44;
      footerImage.height = 36;
    }
    const scrollSelectors = screen.matches(".ssv1-screen")
      ? ".ssv1-board-shell,.ssv1-winner"
      : screen.matches(".fsv1-screen") ? ".fsv1-podium,.fsv1-ranking,.fsv1-stats,.fsv1-gain" : null;
    if (scrollSelectors) {
      const children = [...screen.querySelectorAll(scrollSelectors)];
      if (children.length) {
        const content = document.createElement("div");
        content.className = "flow-content";
        content.tabIndex = 0;
        content.setAttribute("aria-label", "Résultats de la partie");
        children[0].before(content);
        children.forEach(child => content.append(child));
      }
    }
    if (previousScreen !== screen.className) screen.classList.add("flow-enter");
  }
  window.scrollTo({ top: previousScreen === screen?.className.replace(" flow-enter", "") ? previousScroll : 0, behavior: "instant" });
  if (previousScreen === screen?.className.replace(" flow-enter", "")) {
    for (const [className, scrollTop] of scrollers) {
      const node = [...screen.querySelectorAll(".flow-content,.asv1-list,.cat-v2-grid,.wsv1-players,.pri-categories-panel")].find(el => el.className === className);
      if (node) node.scrollTop = scrollTop;
    }
  }

  // E4: signal unique après chaque rendu d'écran.
  queueMicrotask(() => {
    document.dispatchEvent(new CustomEvent("ptitbac:screen-rendered", {
      detail: {
        phase: session.state?.phase || "",
        mode: session.state?.mode || "",
        screenClass: screen?.className || ""
      }
    }));
  });
}

// E4: un seul MutationObserver partagé pour les composants qui ajoutent
// du DOM en dehors de setScreen() (amis, chat, dialogues, etc.).
let ptbDomUpdateScheduled = false;

function schedulePtbDomUpdated() {
  if (ptbDomUpdateScheduled) return;
  ptbDomUpdateScheduled = true;

  requestAnimationFrame(() => {
    ptbDomUpdateScheduled = false;
    document.dispatchEvent(new CustomEvent("ptitbac:dom-updated"));
  });
}

const ptbSharedDomObserver = new MutationObserver(records => {
  const hasAddedElement = records.some(record =>
    [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE)
  );

  if (hasAddedElement) schedulePtbDomUpdated();
});

ptbSharedDomObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});


function uiIcon(name, extraClass = "") {
  const icons = {
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.1 13.2c.05-.4.05-.8 0-1.2l2-1.55-2-3.45-2.45.98a7.4 7.4 0 0 0-1.05-.6L15.25 4h-4.5l-.35 3.38c-.37.17-.72.37-1.05.6L6.9 7l-2 3.45L6.9 12a6.7 6.7 0 0 0 0 1.2l-2 1.55 2 3.45 2.45-.98c.33.23.68.43 1.05.6l.35 3.38h4.5l.35-3.38c.37-.17.72-.37 1.05-.6l2.45.98 2-3.45-2-1.55Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    shop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14l-1 11H6l-1-11Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 9V7a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    gift: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4V10Zm-1-4h18v4H3V6Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v14M12 6c-1.3 0-4.2-.4-4.2-2.2C7.8 2.6 9 2 10 2c1.4 0 2 1.1 2 4Zm0 0c1.3 0 4.2-.4 4.2-2.2C16.2 2.6 15 2 14 2c-1.4 0-2 1.1-2 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.7 14.7a4.7 4.7 0 0 1 4.8 4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    bulb: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 15.5c-1.7-1.2-2.7-3-2.7-5a6.2 6.2 0 1 1 12.4 0c0 2-1 3.8-2.7 5-.7.5-1 1-1 1.7h-5c0-.7-.3-1.2-1-1.7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 20h5M10 17.3h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7v9h-5v-6H9v6H4v-9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    game: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 8h9a5.5 5.5 0 0 1 5.1 7.55l-.9 2.2a2.8 2.8 0 0 1-4.45 1.03L14.5 17h-5l-1.75 1.78a2.8 2.8 0 0 1-4.45-1.03l-.9-2.2A5.5 5.5 0 0 1 7.5 8Z" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M7 11v4M5 13h4M16.5 12.2h.01M18.6 14.1h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    trophy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v3.5c0 3.7-1.7 6.2-4 6.2s-4-2.5-4-6.2V4Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 6H4v1.5c0 3 1.7 4.6 4.5 4.6M16 6h4v1.5c0 3-1.7 4.6-4.5 4.6M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    info: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v6M12 7.2h.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V11M12 19V5M19 19v-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5V3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 3v6h8V4M9 21v-7h6v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };
  return `<span class="ui-icon ${extraClass}">${icons[name] || icons.chevron}</span>`;
}

function homeCoin(sizeClass = "") {
  return `<span class="home-coin ${sizeClass}" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".18"/><path d="M8.1 13.7h7.8M8.7 10.6l1.8 1.4 1.5-3 1.5 3 1.8-1.4-.8 5H9.5l-.8-5Z" fill="currentColor" stroke="currentColor" stroke-width=".7" stroke-linejoin="round"/></svg></span>`;
}

function renderHome() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement…</p></main>');
}

function renderProfile() {
  return renderHome();
}

function renderShop() {
  return renderHome();
}

function renderCoins() { renderShop(); }

function renderCategoriesInfo() {
  return renderHome();
}

function renderHowTo() {
  return renderHome();
}

function gameCoin(sizeClass = "") {
  return `<span class="game-coin ${sizeClass}" aria-hidden="true"><span class="game-coin-crown">♛</span></span>`;
}

function walletBadge(extraClass = "") {
  return `<div class="wallet-badge ${extraClass}">${gameCoin("game-coin-sm")}<strong>${getCoins()}</strong></div>`;
}

function renderNameForm() {
  return renderHome();
}

function renderJoinForm() {
  return renderHome();
}

function render() {
  if (!session.state) return renderHome();
  clearInterval(session.timerHandle);
  session.timerHandle = null;

  switch (session.state.phase) {
    case "lobby": return renderLobby();
    case "category_selection": return renderCategorySelection();
    case "letter_selection": return renderLetterSelection();
    case "round": return me()?.submitted ? renderRoundWaiting() : renderRound();
    case "validation": return renderValidation();
    case "scoreboard": return renderScoreboard();
    case "finished": return renderFinished();
    default: return renderHome();
  }
}

function statIcon(type) {
  const icons = {
    player: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0H4.5Z" fill="currentColor"/></svg>`,
    round: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7 4h10l-2.3 4L17 12H7V4Z" fill="currentColor"/></svg>`,
    timer: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 13V8.5M9 3h6M16.8 6.2l1.5-1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`
  };
  return icons[type] || "";
}

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  if (value === 90) return "1m30";
  if (value === 60) return "60s";
  return `${value}s`;
}

function renderLobby() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function openLobbySettingPopover() {
  // Compatibilité : le lobby moderne gère ses réglages.
}

function difficultyLabel(value) {
  return value === "hard" ? "Difficile" : value === "medium" ? "Moyen" : "Facile";
}

function renderCategorySelection() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}


function renderLetterSelection() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function answerKey(category) {
  return `${session.state.roundIndex}:${category}`;
}

function renderRound() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderRoundWaiting() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderValidation() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function rankedPlayers() {
  return [...session.state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function renderScoreboard() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderFinished() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

window.addEventListener("beforeunload", () => {
  clearInterval(session.timerHandle);
});

// Shared by all six in-game exit buttons. Prefix keeps each screen’s CSS.
function gameExitModal(state, user, prefix) {
  document.querySelector(`.${prefix}-modal-backdrop`)?.remove();
  const overlay = document.createElement("div");
  overlay.className = `${prefix}-modal-backdrop`;
  overlay.innerHTML = `
    <section class="${prefix}-modal" role="dialog" aria-modal="true">
      <h2>Quitter la partie ?</h2>
      <div class="${prefix}-modal-actions">
        <button type="button" data-action="cancel">Non</button>
        ${user?.isHost ? '<button type="button" data-action="lobby">Revenir au salon</button>' : ""}
        <button type="button" class="danger" data-action="home">Revenir à l’accueil</button>
      </div>
    </section>
  `;

  overlay.addEventListener("click", e => {
    const action = e.target?.dataset?.action;
    if (e.target === overlay || action === "cancel") {
      overlay.remove();
      return;
    }
    if (action === "lobby") {
      socket.emit("game:returnLobby", { code: state.code, playerId: session.playerId });
      overlay.remove();
      return;
    }
    if (action === "home") {
      const buttons = overlay.querySelectorAll("button");
      buttons.forEach(button => { button.disabled = true; });

      socket.timeout(8000).emit(
        "game:leave",
        { code:state.code, playerId:session.playerId },
        (err, res) => {
          if (err || !res?.ok) {
            buttons.forEach(button => { button.disabled = false; });
            return toast(
              res?.error ||
              "Impossible de quitter la partie pour le moment."
            );
          }

          clearSession();
          overlay.remove();

          if (typeof initWallet === "function") {
            initWallet(() => renderHome());
          } else {
            renderHome();
          }

          if (res?.message) toast(res.message);
        }
      );
    }
  });
  document.body.appendChild(overlay);
}
