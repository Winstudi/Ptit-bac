(() => {
  "use strict";

  function esc(value = "") {
    try {
      if (typeof escapeHtml === "function") return escapeHtml(value);
    } catch {}

    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function publicId() {
    const code = String(localStorage.getItem("petitbac_friendCode") || "").trim();
    return /^\d{5}$/.test(code) ? code : "-----";
  }

  function safeAvatar(value) {
    const avatar = String(value || "").trim();
    if (!avatar || /^data:image\//i.test(avatar) || /^blob:/i.test(avatar)) return "🧠";
    return avatar;
  }

  function avatarMarkup(value) {
    return `<span>${esc(safeAvatar(value))}</span>`;
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

    const games = Math.max(0, Math.floor(
      Number(objectStats.gamesPlayed ?? objectStats.partiesPlayed) ||
      readStat(["petitbac_stats_gamesPlayed", "petitbac_gamesPlayed"], 0)
    ));

    const wins = Math.max(0, Math.floor(
      Number(objectStats.wins ?? objectStats.victories) ||
      readStat(["petitbac_stats_wins", "petitbac_wins"], 0)
    ));

    const correct = Math.max(0, Math.floor(
      Number(objectStats.correctAnswers ?? objectStats.answersCorrect) ||
      readStat(["petitbac_stats_correctAnswers", "petitbac_correctAnswers"], 0)
    ));

    const friends = Math.max(0, Math.floor(
      Number(objectStats.friendsAdded ?? objectStats.friends) ||
      readStat(["petitbac_stats_friendsAdded", "petitbac_friendsAdded"], 0)
    ));

    const winRate = games > 0 ? Math.min(100, Math.round((wins / games) * 100)) : 0;

    let memberSince = localStorage.getItem("petitbac_memberSince") || "";
    if (memberSince) {
      const date = new Date(memberSince);
      if (!Number.isNaN(date.getTime())) {
        memberSince = date.toLocaleDateString("fr-FR", {
          month: "short",
          year: "numeric"
        });
        memberSince = memberSince.charAt(0).toUpperCase() + memberSince.slice(1);
      }
    }
    if (!memberSince) memberSince = "Bêta";

    return { games, wins, correct, friends, winRate, memberSince };
  }

  function editIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z"></path>
        <path d="m13.7 6.1 4.2 4.2"></path>
      </svg>
    `;
  }

  function copyIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="7" width="10" height="12" rx="2"></rect>
        <path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
  }

  function statIcon(type) {
    const icons = {
      games: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4h8v3.5c0 3.3-1.7 5.5-4 5.5s-4-2.2-4-5.5V4Z"></path>
          <path d="M8 6H5v1.5c0 2.1 1.3 3.5 3.4 3.8M16 6h3v1.5c0 2.1-1.3 3.5-3.4 3.8M12 13v4M8.5 20h7M10 17h4"></path>
        </svg>`,
      wins: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m3 17 2-9 5 4 2-7 2 7 5-4 2 9H3Z"></path>
          <path d="M5 20h14"></path>
        </svg>`,
      rate: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7"></circle>
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M15 9 21 3M17 3h4v4"></path>
        </svg>`,
      correct: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m13 2-8 12h6l-1 8 9-13h-6V2Z"></path>
        </svg>`,
      friends: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 18a5.5 5.5 0 0 1 11 0"></path>
          <circle cx="17" cy="9" r="2.3"></circle>
          <path d="M15.5 14.5c2.7.1 4.7 1.4 5 3.7"></path>
        </svg>`,
      member: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="3"></rect>
          <path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h1M8 17h2M12 17h2"></path>
        </svg>`
    };
    return icons[type] || icons.games;
  }

  function renderProfileV13() {
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
      <main class="screen profile-v10 profile-v13">
        <header class="profile-v10-top">
          <button id="profileV10Back" class="profile-v10-back" type="button" aria-label="Retour">
            <img src="/back-arrow.png" alt="">
          </button>
          <h1>Mon profil</h1>
          <span class="profile-v10-admin-space" aria-hidden="true"></span>
        </header>

        <section class="profile-v10-card profile-v10-identity-card">
          <button id="profileV10Avatar" class="profile-v10-avatar" type="button" aria-label="Choisir mon avatar">
            <span class="profile-v10-avatar-visual">
              ${avatarMarkup(profile.icon)}
            </span>
            <span class="profile-v10-avatar-edit" aria-hidden="true">${editIcon()}</span>
          </button>

          <div class="profile-v10-identity-copy">
            <div class="profile-v13-field">
              <label for="profileV10Name">Pseudo</label>
              <div class="profile-v10-name-row">
                <input
                  id="profileV10Name"
                  type="text"
                  maxlength="16"
                  autocomplete="nickname"
                  value="${esc(profile.name || "Joueur")}"
                  aria-label="Pseudo"
                >
                <button id="profileV10EditName" type="button" aria-label="Modifier le pseudo">${editIcon()}</button>
              </div>
            </div>

            <div class="profile-v13-field">
              <label>Code ami</label>
              <button id="profileV10CopyCode" class="profile-v10-code-row" type="button" aria-label="Copier mon code ami">
                <strong># ${esc(publicId())}</strong>
                <span aria-hidden="true">${copyIcon()}</span>
              </button>
            </div>
          </div>
        </section>

        <section class="profile-v10-card profile-v10-stats">
          <h2>
            <span class="profile-v10-bars" aria-hidden="true"><i></i><i></i><i></i></span>
            Mes statistiques
          </h2>

          <div class="profile-v10-stats-grid">
            <article>
              <span class="profile-v10-stat-icon stat-games">${statIcon("games")}</span>
              <div><strong>${stats.games}</strong><small>Parties jouées</small></div>
            </article>
            <article>
              <span class="profile-v10-stat-icon stat-wins">${statIcon("wins")}</span>
              <div><strong>${stats.wins}</strong><small>Victoires</small></div>
            </article>
            <article>
              <span class="profile-v10-stat-icon stat-rate">${statIcon("rate")}</span>
              <div><strong>${stats.winRate}%</strong><small>Taux de victoire</small></div>
            </article>
            <article>
              <span class="profile-v10-stat-icon stat-correct">${statIcon("correct")}</span>
              <div><strong>${stats.correct}</strong><small>Réponses correctes</small></div>
            </article>
            <article>
              <span class="profile-v10-stat-icon stat-friends">${statIcon("friends")}</span>
              <div><strong>${stats.friends}</strong><small>Amis ajoutés</small></div>
            </article>
            <article>
              <span class="profile-v10-stat-icon stat-member">${statIcon("member")}</span>
              <div><small>Membre depuis</small><strong class="profile-v10-date">${esc(stats.memberSince)}</strong></div>
            </article>
          </div>
        </section>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>
      </main>
    `);

    document.getElementById("profileV10Back")?.addEventListener("click", () => {
      if (typeof window.renderHome === "function") window.renderHome();
    });

    document.getElementById("profileV10Avatar")?.addEventListener("click", () => {
      if (typeof window.openProfileAvatarPicker === "function") {
        window.openProfileAvatarPicker();
        return;
      }
      toast("Le choix d’avatar est indisponible.");
    });

    const nameInput = document.getElementById("profileV10Name");
    const editNameButton = document.getElementById("profileV10EditName");
    let lastSavedName = String(profile.name || "Joueur").trim().slice(0,16);
    let savingName = false;

    const saveName = async () => {
      if (!nameInput || savingName) return false;

      const next =
        String(nameInput.value || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0,16);

      if (!next) {
        toast("Choisis un pseudo.");
        nameInput.value = lastSavedName;
        return false;
      }

      if (next === lastSavedName) {
        editNameButton?.classList.remove("is-editing");
        return true;
      }

      const walletToken =
        String(
          window.session?.walletToken ||
          localStorage.getItem("petitbac_walletToken") ||
          ""
        );

      savingName = true;
      editNameButton?.classList.add("is-editing");

      const response =
        await new Promise(resolve => {
          if (!window.socket || !walletToken) {
            resolve({
              ok:false,
              error:"Profil indisponible."
            });
            return;
          }

          socket.emit(
            "profile:update",
            {
              walletToken,
              name:next
            },
            result => resolve(result || {})
          );
        });

      savingName = false;
      editNameButton?.classList.remove("is-editing");

      if (!response.ok) {
        nameInput.value = lastSavedName;
        toast(
          response.error ||
          "Impossible d’enregistrer le pseudo."
        );
        return false;
      }

      const saved =
        String(response.name || next)
          .trim()
          .slice(0,16);

      const current =
        typeof getProfile === "function"
          ? getProfile()
          : profile;

      try {
        if (typeof saveProfile === "function") {
          saveProfile(
            saved,
            safeAvatar(current.icon)
          );
        } else {
          localStorage.setItem(
            "petitbac_profile_name",
            saved
          );
        }

        nameInput.value = saved;
        lastSavedName = saved;

        toast("Pseudo enregistré !");
        return true;
      } catch {
        toast("Impossible d’enregistrer le pseudo.");
        return false;
      }
    };

    nameInput?.addEventListener("focus", () => {
      editNameButton?.classList.add("is-editing");
    });

    nameInput?.addEventListener("input", () => {
      editNameButton?.classList.add("is-editing");
    });

    editNameButton?.addEventListener("click", async () => {
      if (!nameInput) return;

      if (document.activeElement !== nameInput) {
        nameInput.focus();

        try {
          nameInput.setSelectionRange(
            nameInput.value.length,
            nameInput.value.length
          );
        } catch {}

        return;
      }

      await saveName();
      nameInput.blur();
    });

    nameInput?.addEventListener("keydown", async event => {
      if (event.key !== "Enter") return;

      event.preventDefault();
      await saveName();
      nameInput.blur();
    });

    nameInput?.addEventListener("blur", () => {
      saveName();
    });

    document.getElementById("profileV10CopyCode")?.addEventListener("click", async () => {
      const code = publicId();

      try {
        await navigator.clipboard.writeText(code);
        toast("Code ami copié !");
      } catch {
        toast(`# ${code}`);
      }
    });
  }

  window.renderProfile = renderProfileV13;
  try { renderProfile = renderProfileV13; } catch {}
})();
