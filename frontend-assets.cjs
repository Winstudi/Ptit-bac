"use strict";

/**
 * Source de vérité de l'ordre des assets frontend regroupés en production.
 * L'ordre de chaque tableau doit rester identique à index.html : plusieurs
 * écrans modernes surchargent volontairement une base plus ancienne.
 */
const BUNDLES = Object.freeze([
  Object.freeze({
    type: "css",
    output: "ptb-category-avatar-patches.css",
    id: "",
    files: Object.freeze([
      "style.css",
      "design-v2.css",
      "friends.css",
      "chat.css",
      "economy.css",
      "home-mobile.css",
      "profile-screen-v2.css",
      "profile-redesign-v1.css",
      "shop-screen-v2.css",
      "lobby-screen-v4.css",
      "quick-lobby-v1.css"
    ])
  }),
  Object.freeze({
    type: "css",
    output: "ptb-ui-wheel-patches.css",
    id: "pbw1WheelFxStyles",
    files: Object.freeze([
      "category-selection-v2.css",
      "category-position-fix-v1.css",
      "category-chooser-card-v1.css",
      "shared-footer-v1.css",
      "avatar-fix-v2.css",
      "avatar-system-v1.css",
      "admin-v1.css",
      "inbox-v1.css",
      "ui-fixes-v3.css",
      "lobby-polish-v1.css",
      "letter-wheel-fx-v1.css",
      "letter-wheel-v1.css"
    ])
  }),
  Object.freeze({
    type: "css",
    output: "ptb-late-patches.css",
    id: "",
    files: Object.freeze([
      "round-intro-v1.css",
      "answer-screen-v1.css",
      "waiting-screen-v1.css",
      "validation-screen-v1.css",
      "scoreboard-screen-v1.css",
      "final-screen-v1.css",
      "wallet.css",
      "gameplay-flow.css",
      "category-prototype.css",
      "private-lobby.css",
      "avatar-pages-fix-v1.css"
    ])
  }),
  Object.freeze({
    type: "js",
    output: "ptb-core-client.js",
    files: Object.freeze([
      "avatar-system-v1.js",
      "inventory-client.js",
      "progression-client.js",
      "icon-theme-v1.js",
      "home-screen-v1.js",
      "profile-screen-v2.js",
      "profile-redesign-v1.js",
      "friends-client.js",
      "chat-client.js",
      "economy-client.js",
      "shop-screen-v2.js"
    ])
  }),
  Object.freeze({
    type: "js",
    output: "ptb-ui-patches.js",
    files: Object.freeze([
      "lobby-screen-v4.js",
      "quick-lobby-v1.js",
      "category-selection-v2.js",
      "category-chooser-card-v1.js",
      "admin-v1.js",
      "inbox-v1.js",
      "ui-fixes-v3.js",
      "lobby-polish-v1.js",
      "letter-wheel-v1.js"
    ])
  }),
  Object.freeze({
    type: "js",
    output: "ptb-late-client.js",
    files: Object.freeze([
      "answer-screen-v1.js",
      "round-intro-v1.js",
      "waiting-screen-v1.js",
      "validation-screen-v1.js",
      "scoreboard-screen-v1.js",
      "final-screen-v1.js",
      "wallet-client.js",
      "avatar-pages-fix-v1.js"
    ])
  })
]);

const REQUIRED_SOURCE_ASSETS = Object.freeze([
  "mobile-runtime.js",
  ...BUNDLES.flatMap(bundle => bundle.files)
]);

module.exports = { BUNDLES, REQUIRED_SOURCE_ASSETS };
