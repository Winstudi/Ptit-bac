(() => {
  "use strict";

  let scheduled = false;

  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      })[char]
    );
  }

  function stateNow() {
    try {
      return session?.state || null;
    } catch {
      return null;
    }
  }

  function avatarFor(player) {
    const raw = player?.avatar || "";
    const seed =
      player?.id ||
      player?.name ||
      "category-chooser";

    if (window.PtitBacAvatars?.normalize) {
      return window.PtitBacAvatars.normalize(raw, seed);
    }

    return "/a1.webp";
  }

  function patchCategoryChooser() {
    scheduled = false;

    const screen =
      document.querySelector(".category-pick-screen.cat-v2");

    if (!screen) return;

    const state = stateNow();
    if (!state || state.phase !== "category_selection") return;

    const copy =
      screen.querySelector(".category-pick-copy.cat-v2-copy");

    if (!copy) return;

    copy.querySelector("h1")?.remove();
    copy.querySelector(".cat-chooser")?.remove();

    const chooser =
      (state.players || []).find(
        player =>
          String(player.id) ===
          String(state.categoryChooserPlayerId)
      ) || null;

    const chooserId = String(chooser?.id || "");
    const existing = screen.querySelector(".cat-existing-chooser");

    if (
      existing &&
      existing.dataset.chooserId === chooserId
    ) {
      return;
    }

    existing?.remove();

    const card = document.createElement("section");
    card.className = "cat-existing-chooser";
    card.dataset.chooserId = chooserId;

    card.innerHTML = `
      <div class="cat-existing-chooser-avatar">
        <img
          src="${esc(avatarFor(chooser))}"
          alt=""
          draggable="false"
        >
      </div>

      <div class="cat-existing-chooser-copy">
        <small>C’est à</small>
        <strong>${esc(chooser?.name || "Un joueur")}</strong>
        <span>de choisir les catégories</span>
      </div>
    `;

    copy.insertAdjacentElement("afterend", card);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(patchCategoryChooser);
  }

  function start() {
    schedule();

    const app = document.getElementById("app");
    if (app) {
      new MutationObserver(schedule).observe(app, {
        childList:true,
        subtree:true
      });
    }

    try {
      socket?.on?.("room:state", schedule);
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
  } else {
    start();
  }
})();
