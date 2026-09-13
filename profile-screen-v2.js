(() => {
  "use strict";

  // Avatars temporaires intégrés au jeu.
  // Aucun import de photo personnelle n'est autorisé.
  const PROFILE_AVATARS_V8 = [
    "🧠", "🐼", "🦊", "🐯", "🐸",
    "🦁", "🐨", "🐙", "🦄", "🤖",
    "😎", "⭐", "🎮", "⚽"
  ];

  function backButtonMarkup(id) {
    return `
      <button id="${id}" class="profile-v2-back" type="button" aria-label="Retour">
        <img src="/back-arrow.png" alt="">
      </button>
    `;
  }

  function safeAvatar(value) {
    const avatar = String(value || "").trim();

    // Anciennes photos personnalisées éventuellement présentes en local
    // sont volontairement ignorées depuis la suppression de l'import.
    if (!avatar || /^data:image\//i.test(avatar) || /^blob:/i.test(avatar)) {
      return "🧠";
    }

    return avatar;
  }

  function renderProfileEditV8() {
    try {
      if (window.session?.state) return render();
    } catch {}

    const current = getProfile();
    let selectedAvatar = safeAvatar(current.icon);

    setScreen(`
      <main class="screen profile-edit-v8">
        <div class="profile-edit-v8-glow glow-a"></div>
        <div class="profile-edit-v8-glow glow-b"></div>

        <header class="profile-edit-v8-top">
          ${backButtonMarkup("profileEditBack")}
          <div class="profile-edit-v8-heading">
            <h1>Modifier mon <span>profil</span></h1>
            <p>Modifie ton pseudo et choisis un avatar du jeu.</p>
          </div>
          <span class="profile-v2-top-spacer" aria-hidden="true"></span>
        </header>

        <section class="profile-edit-v8-card profile-edit-v8-name-card">
          <div class="profile-edit-v8-card-title">
            <div class="profile-edit-v8-section-icon">T</div>
            <strong>Ton pseudo</strong>
            <span id="profileEditCount">${String(current.name || "").length}/16</span>
          </div>

          <div class="profile-edit-v8-input-row">
            <input
              id="profileEditName"
              type="text"
              maxlength="16"
              autocomplete="nickname"
              value="${escapeHtml(current.name || "")}"
              placeholder="Ton pseudo"
              aria-label="Ton pseudo"
            >
            <button id="profileEditClear" type="button" aria-label="Effacer le pseudo">×</button>
          </div>

          <small>Ton pseudo sera visible par tous les joueurs.</small>
        </section>

        <section class="profile-edit-v8-card profile-edit-v8-avatar-card">
          <div class="profile-edit-v8-card-title avatars-title">
            <div class="profile-edit-v8-section-icon profile-edit-v8-section-icon-image">
              <img src="/profile-icon.png" alt="" aria-hidden="true">
            </div>
            <strong>Avatar</strong>
            <span>Avatars du jeu</span>
          </div>

          <div class="profile-edit-v8-grid" id="profileEditGrid">
            ${PROFILE_AVATARS_V8.map(icon => `
              <button
                type="button"
                class="profile-edit-v8-avatar ${icon === selectedAvatar ? "is-selected" : ""}"
                data-avatar="${escapeHtml(icon)}"
                aria-label="Choisir ${escapeHtml(icon)}"
              >
                <span>${escapeHtml(icon)}</span>
                <i>✓</i>
              </button>
            `).join("")}
          </div>
        </section>

        <div class="profile-edit-v8-actions">
          <button id="profileEditCancel" class="profile-edit-v8-cancel" type="button">Annuler</button>
          <button id="profileEditSave" class="profile-edit-v8-save" type="button">Enregistrer</button>
        </div>
      </main>
    `);

    const input = document.getElementById("profileEditName");
    const count = document.getElementById("profileEditCount");
    const grid = document.getElementById("profileEditGrid");

    const updateCounter = () => {
      const value = String(input?.value || "").slice(0, 16);
      if (input && input.value !== value) input.value = value;
      if (count) count.textContent = `${value.length}/16`;
    };

    const refreshSelection = () => {
      grid?.querySelectorAll("[data-avatar]").forEach(el => {
        el.classList.toggle("is-selected", el.dataset.avatar === selectedAvatar);
      });
    };

    input?.addEventListener("input", updateCounter);

    document.getElementById("profileEditClear")?.addEventListener("click", () => {
      if (!input) return;
      input.value = "";
      input.focus();
      updateCounter();
    });

    grid?.addEventListener("click", event => {
      const btn = event.target.closest("[data-avatar]");
      if (!btn) return;
      selectedAvatar = safeAvatar(btn.dataset.avatar);
      refreshSelection();
    });

    const returnToProfile = () => {
      if (typeof window.renderProfile === "function") window.renderProfile();
    };

    document.getElementById("profileEditBack")?.addEventListener("click", returnToProfile);
    document.getElementById("profileEditCancel")?.addEventListener("click", returnToProfile);

    document.getElementById("profileEditSave")?.addEventListener("click", () => {
      const name = String(input?.value || "").trim();

      if (!name) {
        toast("Choisis un pseudo.");
        input?.focus();
        return;
      }

      if (name.length > 16) {
        toast("Le pseudo doit faire 16 caractères maximum.");
        input?.focus();
        return;
      }

      saveProfile(name, safeAvatar(selectedAvatar));
      toast("Profil enregistré !");
      returnToProfile();
    });

    // Aucun focus automatique : le clavier mobile ne s'ouvre que sur action du joueur.
  }

  // La page principale du profil est fournie par profile-redesign-v1.js.
  // Ce fichier ne gère plus que l'éditeur afin d'éviter le double rendu historique.
  window.renderProfileEdit = renderProfileEditV8;
})();
