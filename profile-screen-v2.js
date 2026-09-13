(() => {
  "use strict";

  const PROFILE_AVATARS = [
    "🧠", "🐼", "🦊", "🐯", "🐸",
    "🦁", "🐨", "🐙", "🦄", "🤖",
    "😎", "⭐", "🎮", "⚽"
  ];

  function safeAvatar(value) {
    const avatar = String(value || "").trim();
    if (!avatar || /^data:image\//i.test(avatar) || /^blob:/i.test(avatar)) return "🧠";
    return avatar;
  }

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

  function closeAvatarPicker() {
    const overlay = document.getElementById("profileAvatarPicker");
    if (!overlay) return;

    document.documentElement.classList.remove("profile-avatar-picker-open");
    overlay.remove();
  }

  function openProfileAvatarPicker() {
    closeAvatarPicker();

    const current = typeof getProfile === "function"
      ? getProfile()
      : {
          name: localStorage.getItem("petitbac_profile_name") || "Joueur",
          icon: localStorage.getItem("petitbac_profile_icon") || "🧠"
        };

    const selectedAvatar = safeAvatar(current.icon);

    const overlay = document.createElement("div");
    overlay.id = "profileAvatarPicker";
    overlay.className = "profile-avatar-picker-backdrop";
    overlay.innerHTML = `
      <section class="profile-avatar-picker" role="dialog" aria-modal="true" aria-labelledby="profileAvatarPickerTitle">
        <header class="profile-avatar-picker-head">
          <div>
            <small>MON PROFIL</small>
            <h2 id="profileAvatarPickerTitle">Choisir un avatar</h2>
          </div>

          <button id="profileAvatarPickerClose" class="profile-avatar-picker-close" type="button" aria-label="Fermer">×</button>
        </header>

        <p class="profile-avatar-picker-subtitle">Appuie sur un avatar pour le sélectionner.</p>

        <div class="profile-avatar-picker-grid">
          ${PROFILE_AVATARS.map(icon => `
            <button
              type="button"
              class="profile-avatar-choice ${icon === selectedAvatar ? "is-selected" : ""}"
              data-avatar="${esc(icon)}"
              aria-label="Choisir ${esc(icon)}"
            >
              <span>${esc(icon)}</span>
              <i aria-hidden="true">✓</i>
            </button>
          `).join("")}
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
    document.documentElement.classList.add("profile-avatar-picker-open");

    const close = () => closeAvatarPicker();

    document.getElementById("profileAvatarPickerClose")?.addEventListener("click", close);

    overlay.addEventListener("click", event => {
      if (event.target === overlay) close();
    });

    overlay.querySelectorAll("[data-avatar]").forEach(button => {
      button.addEventListener("click", () => {
        const nextAvatar = safeAvatar(button.dataset.avatar);
        const latest = typeof getProfile === "function" ? getProfile() : current;

        if (typeof saveProfile === "function") {
          saveProfile(latest.name || "Joueur", nextAvatar);
        } else {
          localStorage.setItem("petitbac_profile_icon", nextAvatar);
        }

        close();
        toast("Avatar modifié !");

        if (typeof window.renderProfile === "function") {
          window.renderProfile();
        }
      });
    });

    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      overlay.querySelector(".profile-avatar-choice.is-selected")?.focus({ preventScroll: true });
    });
  }

  window.openProfileAvatarPicker = openProfileAvatarPicker;

  // Compatibilité temporaire avec d'anciens appels éventuels :
  // l'ancienne page "pseudo + avatar" n'existe plus.
  window.renderProfileEdit = openProfileAvatarPicker;
})();
