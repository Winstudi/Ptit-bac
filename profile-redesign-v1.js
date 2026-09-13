(() => {
  "use strict";

  function esc(value = "") {
    try {
      if (typeof escapeHtml === "function") return escapeHtml(value);
    } catch {}
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function publicId() {
    const code = String(localStorage.getItem("petitbac_friendCode") || "").trim();
    return /^\d{5}$/.test(code) ? code : "-----";
  }

  function isPhotoAvatar(value) {
    return !!window.PtitBacProfilePhoto?.isImageAvatar?.(value);
  }

  function avatarMarkup(value) {
    if (isPhotoAvatar(value)) {
      return `<img src="${value}" alt="" draggable="false">`;
    }
    return `<span>${esc(value || "🧠")}</span>`;
  }

  function readStat(keys, fallback = 0) {
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
    }
    return fallback;
  }

  function getProfileStats() {
    let objectStats = {};
    try {
      objectStats = JSON.parse(localStorage.getItem("petitbac_stats") || "{}") || {};
    } catch {}

    const games =
      Number(objectStats.gamesPlayed ?? objectStats.partiesPlayed) ||
      readStat(["petitbac_stats_gamesPlayed", "petitbac_gamesPlayed"], 0);

    const wins =
      Number(objectStats.wins ?? objectStats.victories) ||
      readStat(["petitbac_stats_wins", "petitbac_wins"], 0);

    const correct =
      Number(objectStats.correctAnswers ?? objectStats.answersCorrect) ||
      readStat(["petitbac_stats_correctAnswers", "petitbac_correctAnswers"], 0);

    const friends =
      Number(objectStats.friendsAdded ?? objectStats.friends) ||
      readStat(["petitbac_stats_friendsAdded"], 0);

    const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;

    let memberSince = localStorage.getItem("petitbac_memberSince") || "";
    if (memberSince) {
      const date = new Date(memberSince);
      if (!Number.isNaN(date.getTime())) {
        memberSince = date.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
      }
    }
    if (!memberSince) memberSince = "Bêta";

    return { games, wins, correct, friends, winRate, memberSince };
  }

  function renderProfileV9() {
    if (window.session?.state) {
      try { return render(); } catch { return; }
    }

    const profile = typeof getProfile === "function"
      ? getProfile()
      : {
          name: localStorage.getItem("petitbac_profile_name") || "Joueur",
          icon: localStorage.getItem("petitbac_profile_icon") || "🧠"
        };

    const stats = getProfileStats();

    setScreen(`
      <main class="screen profile-v9">
        <header class="profile-v9-top">
          <button id="profileV9Back" class="profile-v9-back" type="button" aria-label="Retour">
            <img src="/back-arrow.png" alt="">
          </button>
          <h1>Mon profil</h1>
          <span class="profile-v9-admin-space" aria-hidden="true"></span>
        </header>

        <section class="profile-v9-card profile-v9-identity-card">
          <button id="profileV9Avatar" class="profile-v9-avatar" type="button" aria-label="Changer mon avatar">
            <span class="profile-v9-avatar-visual">
              ${avatarMarkup(profile.icon || "🧠")}
            </span>
            <span class="profile-v9-avatar-edit" aria-hidden="true">✎</span>
          </button>

          <div class="profile-v9-identity-copy">
            <label for="profileV9Name">Pseudo</label>
            <div class="profile-v9-name-row">
              <input
                id="profileV9Name"
                type="text"
                maxlength="16"
                autocomplete="nickname"
                value="${esc(profile.name || "Joueur")}"
                aria-label="Modifier mon pseudo"
              >
              <button id="profileV9SaveName" type="button" aria-label="Enregistrer le pseudo">✎</button>
            </div>

            <label>Code ami</label>
            <button id="profileV9CopyCode" class="profile-v9-code-row" type="button" aria-label="Copier mon code ami">
              <strong># ${esc(publicId())}</strong>
              <span aria-hidden="true">▣</span>
            </button>
          </div>
        </section>

        <nav class="profile-v9-menu">
          <button data-nav="friends" type="button">
            <span class="profile-v9-menu-icon"><img src="/friends.png" alt=""></span>
            <span><strong>Mes amis</strong><small>Voir et gérer mes amis</small></span>
            <b>›</b>
          </button>

          <button id="profileV9Settings" type="button">
            <span class="profile-v9-menu-icon"><img src="/settings.png" alt=""></span>
            <span><strong>Paramètres</strong><small>Son, notifications, confidentialité...</small></span>
            <b>›</b>
          </button>

          <button id="profileV9Shop" type="button">
            <span class="profile-v9-menu-icon"><img src="/shop.png" alt=""></span>
            <span><strong>Ma boutique</strong><small>Pièces, packs et bonus</small></span>
            <b>›</b>
          </button>
        </nav>

        <section class="profile-v9-card profile-v9-stats">
          <h2><span class="profile-v9-bars" aria-hidden="true"><i></i><i></i><i></i></span>Mes statistiques</h2>

          <div class="profile-v9-stats-grid">
            <article>
              <span>🏆</span>
              <div><strong>${stats.games}</strong><small>Parties jouées</small></div>
            </article>
            <article>
              <span>♛</span>
              <div><strong>${stats.wins}</strong><small>Victoires</small></div>
            </article>
            <article>
              <span>🎯</span>
              <div><strong>${stats.winRate}%</strong><small>Taux de victoire</small></div>
            </article>
            <article>
              <span>⚡</span>
              <div><strong>${stats.correct}</strong><small>Réponses correctes</small></div>
            </article>
            <article>
              <span>👥</span>
              <div><strong>${stats.friends}</strong><small>Amis ajoutés</small></div>
            </article>
            <article>
              <span>📅</span>
              <div><small>Membre depuis</small><strong class="profile-v9-date">${esc(stats.memberSince)}</strong></div>
            </article>
          </div>
        </section>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>
      </main>
    `);

    document.getElementById("profileV9Back")?.addEventListener("click", () => {
      if (typeof window.renderHome === "function") window.renderHome();
    });

    document.getElementById("profileV9Avatar")?.addEventListener("click", () => {
      if (typeof window.renderProfileEdit === "function") {
        window.renderProfileEdit();
      }
    });

    const nameInput = document.getElementById("profileV9Name");
    const saveName = () => {
      const next = String(nameInput?.value || "").trim().slice(0, 16);
      if (!next) {
        toast("Choisis un pseudo.");
        nameInput?.focus();
        return;
      }

      const current = typeof getProfile === "function" ? getProfile() : profile;
      try {
        if (typeof saveProfile === "function") saveProfile(next, current.icon || "🧠");
        else localStorage.setItem("petitbac_profile_name", next);
        if (nameInput) nameInput.value = next;
        toast("Pseudo enregistré !");
      } catch {
        toast("Impossible d’enregistrer le pseudo.");
      }
    };

    document.getElementById("profileV9SaveName")?.addEventListener("click", saveName);
    nameInput?.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      nameInput.blur();
      saveName();
    });

    document.getElementById("profileV9CopyCode")?.addEventListener("click", async () => {
      const code = publicId();
      try {
        await navigator.clipboard.writeText(code);
        toast("Code ami copié !");
      } catch {
        toast(`# ${code}`);
      }
    });

    document.getElementById("profileV9Settings")?.addEventListener("click", () => {
      toast("Paramètres bientôt disponibles.");
    });

    document.getElementById("profileV9Shop")?.addEventListener("click", () => {
      if (typeof window.renderShop === "function") return window.renderShop();
      if (typeof window.renderShopV2 === "function") return window.renderShopV2();
      toast("Boutique bientôt disponible.");
    });
  }

  // On conserve toute la page d'édition déjà présente dans profile-screen-v2.js.
  // Cette couche remplace uniquement la page principale du profil.
  window.renderProfile = renderProfileV9;
  try { renderProfile = renderProfileV9; } catch {}
})();