(() => {
  "use strict";

  const BASE = "/";
  const MAP = {
    settings: "settings.png",
    plus: "plus.png",
    shop: "shop.png",
    gift: "rewards.png",
    users: "friends.png",
    home: "home.png",
    trophy: "crown.png",
    chevron: "arrow-right.png"
  };

  const oldUiIcon = typeof uiIcon === "function" ? uiIcon : null;

  window.ptitBacPngIcon = function(name, extraClass = "") {
    const file = MAP[name];
    if (!file) return oldUiIcon ? oldUiIcon(name, extraClass) : "";
    return `<span class="ui-icon pb-global-icon ${extraClass}"><img src="${BASE}${file}" alt="" aria-hidden="true"></span>`;
  };

  if (oldUiIcon) {
    try { uiIcon = window.ptitBacPngIcon; } catch {}
  }

  if (typeof homeCoin === "function") {
    try {
      homeCoin = function(sizeClass = "") {
        return `<span class="home-coin ${sizeClass}" aria-hidden="true"><img class="pb-global-coin" src="${BASE}coin.png" alt=""></span>`;
      };
    } catch {}
  }

  // Une seule image pour les 3 niveaux de difficulté.
  const DIFFICULTY_ICON = `${BASE}difficulty.png`;

  function normalizeDifficultyIcons(root = document) {
    if (!root?.querySelectorAll) return;

    root.querySelectorAll(
      'img[src*="difficulty-easy.png"], img[src*="difficulty-normal.png"], img[src*="difficulty-hard.png"]'
    ).forEach(img => {
      if (img.getAttribute("src") !== DIFFICULTY_ICON) {
        img.setAttribute("src", DIFFICULTY_ICON);
      }
    });
  }

  normalizeDifficultyIcons();

  const difficultyObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;

        if (
          node.matches?.(
            'img[src*="difficulty-easy.png"], img[src*="difficulty-normal.png"], img[src*="difficulty-hard.png"]'
          )
        ) {
          node.setAttribute("src", DIFFICULTY_ICON);
        }

        normalizeDifficultyIcons(node);
      }
    }
  });

  difficultyObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.PtitBacDifficultyIcon = DIFFICULTY_ICON;
})();