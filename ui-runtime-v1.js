(() => {
  "use strict";

  const adminState = {
    admin: false,
    infiniteCoins: false,
    infiniteLives: false
  };

  function walletToken() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function applyAdminClasses() {
    const root = document.documentElement;

    root.classList.toggle(
      "ptb-admin-infinite-coins",
      !!adminState.admin && !!adminState.infiniteCoins
    );

    root.classList.toggle(
      "ptb-admin-infinite-lives",
      !!adminState.admin && !!adminState.infiniteLives
    );
  }

  function refreshAdminState() {
    if (
      document.hidden ||
      typeof socket === "undefined" ||
      !socket?.connected
    ) {
      return;
    }

    const token = walletToken();

    if (!token) {
      adminState.admin = false;
      adminState.infiniteCoins = false;
      adminState.infiniteLives = false;
      window.PtitBacAdminDisplayState = { ...adminState };
      applyAdminClasses();
      return;
    }

    socket.emit("admin:status", { walletToken: token }, res => {
      if (!res?.ok || !res.admin) {
        adminState.admin = false;
        adminState.infiniteCoins = false;
        adminState.infiniteLives = false;
      } else {
        adminState.admin = true;
        adminState.infiniteCoins = !!res.infiniteCoins;
        adminState.infiniteLives = !!res.infiniteLives;
      }

      window.PtitBacAdminDisplayState = { ...adminState };
      applyAdminClasses();
    });
  }

  document.addEventListener("click", event => {
    const legacyTrigger = event.target.closest?.(
      "#homePlaqueCrown, #betaAdminTrigger"
    );

    if (!legacyTrigger) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("change", event => {
    if (!event.target.closest?.("#admCoins, #admLives")) return;
    setTimeout(refreshAdminState, 180);
  }, true);

  document.addEventListener("click", event => {
    if (!event.target.closest?.(
      "#adminActivationValidate, .admin-v1-crown-btn, #admValidate"
    )) return;

    setTimeout(refreshAdminState, 250);
  }, true);

  function cleanupCurrentScreen() {
    const hud = document.getElementById("economyHud");
    const reports = document.querySelector(".admin-v1-page");

    if (hud) {
      if (reports) {
        hud.setAttribute("aria-hidden", "true");
      } else {
        hud.removeAttribute("aria-hidden");
      }
    }
  }

  document.addEventListener(
    "ptitbac:screen-rendered",
    cleanupCurrentScreen
  );
  document.addEventListener(
    "ptitbac:dom-updated",
    cleanupCurrentScreen
  );

  if (typeof socket !== "undefined") {
    socket.on("connect", () => setTimeout(refreshAdminState, 120));
  }

  window.addEventListener("online", () => setTimeout(refreshAdminState, 120));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(refreshAdminState, 120);
  });

  setTimeout(refreshAdminState, 250);
  setInterval(refreshAdminState, 30000);

  cleanupCurrentScreen();

  window.PtitBacUiRuntime = Object.freeze({
    refreshAdminState,
    cleanupCurrentScreen
  });
})();
