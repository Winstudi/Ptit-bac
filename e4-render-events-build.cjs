"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;

function filePath(name) {
  return path.join(root, name);
}

function read(name) {
  return fs.readFileSync(filePath(name), "utf8");
}

function write(name, source) {
  fs.writeFileSync(filePath(name), source, "utf8");
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) {
    return { source, changed:false };
  }

  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(`E4: motif introuvable pour ${label}.`);
  }

  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`E4: motif ambigu pour ${label}.`);
  }

  return {
    source:
      source.slice(0, first) +
      after +
      source.slice(first + before.length),
    changed:true
  };
}

function replaceRegexOnce(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) {
    return { source, changed:false };
  }

  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `E4: ${label} doit correspondre exactement une fois (${matches.length}).`
    );
  }

  return {
    source: source.replace(pattern, replacement),
    changed:true
  };
}

function parseJs(name) {
  new Function(read(name));
}

/* ---------------------------------------------------------
   app.js : un événement après chaque rendu + un seul observer
   DOM partagé pour les ajouts dynamiques hors setScreen().
   --------------------------------------------------------- */
function patchApp() {
  const name = "app.js";
  let source = read(name);

  if (source.includes("ptbSharedDomObserver")) {
    return false;
  }

  const delimiter = "\n}\n\n\nfunction uiIcon(name, extraClass = \"\") {";

  const injected = `
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


function uiIcon(name, extraClass = "") {`;

  const result = replaceOnce(
    source,
    delimiter,
    "\n" + injected,
    "app.js / bus de rendu"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

/* ---------------------------------------------------------
   Avatar : plus d'observer propre. Il écoute le bus partagé.
   --------------------------------------------------------- */
function patchAvatarSystem() {
  const name = "avatar-system-v1.js";
  let source = read(name);

  const pattern =
    /  function start\(\) \{\n    upgradeAll\(document\);\n\n    const observer = new MutationObserver\([\s\S]*?\n    } catch \{\}\n  \}\n\n  \/\/ Alias temporaire/g;

  const replacement = `  let avatarUpgradeScheduled = false;

  function scheduleAvatarUpgrade() {
    if (avatarUpgradeScheduled) return;
    avatarUpgradeScheduled = true;

    requestAnimationFrame(() => {
      avatarUpgradeScheduled = false;
      upgradeAll(document);
    });
  }

  function start() {
    upgradeAll(document);

    document.addEventListener(
      "ptitbac:screen-rendered",
      scheduleAvatarUpgrade
    );

    document.addEventListener(
      "ptitbac:dom-updated",
      scheduleAvatarUpgrade
    );

    try {
      socket?.on?.("room:state", scheduleAvatarUpgrade);
    } catch {}
  }

  // Alias temporaire`;

  const result = replaceRegexOnce(
    source,
    pattern,
    replacement,
    "avatarUpgradeScheduled",
    "avatar-system-v1.js / observer"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

/* ---------------------------------------------------------
   Quick reroll : uniquement rendu + événements serveur/wallet.
   --------------------------------------------------------- */
function patchQuickReroll() {
  const name = "avatar-pages-fix-v1.js";
  let source = read(name);

  const before = `  function start() {
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    try {
      socket?.on?.("room:state", schedule);
      socket?.on?.("wallet:update", schedule);
    } catch {}

    schedule();
  }`;

  const after = `  function start() {
    document.addEventListener("ptitbac:screen-rendered", schedule);

    try {
      socket?.on?.("room:state", schedule);
      socket?.on?.("wallet:update", schedule);
    } catch {}

    schedule();
  }`;

  const result = replaceOnce(
    source,
    before,
    after,
    "avatar-pages-fix-v1.js / observer"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

/* ---------------------------------------------------------
   Progression : patch uniquement lorsqu'un écran ou état change.
   --------------------------------------------------------- */
function patchProgression() {
  const name = "progression-client.js";
  let source = read(name);

  const before = `    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.documentElement, { childList:true, subtree:true });

    try {`;

  const after = `    document.addEventListener(
      "ptitbac:screen-rendered",
      schedulePatch
    );

    try {`;

  const result = replaceOnce(
    source,
    before,
    after,
    "progression-client.js / observer"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

/* ---------------------------------------------------------
   Lobby : setScreen émet désormais l'événement nécessaire.
   --------------------------------------------------------- */
function patchLobby() {
  const name = "lobby-polish-v1.js";
  let source = read(name);

  const pattern =
    /  const appRoot = document\.getElementById\("app"\);\n  if \(appRoot\) \{\n    const lobbyModeObserver = new MutationObserver\([\s\S]*?\n  \}\n\n  \/\*/g;

  const replacement = `  document.addEventListener(
    "ptitbac:screen-rendered",
    () => queueMicrotask(ensureRoomModeControl)
  );

  /*`;

  const result = replaceRegexOnce(
    source,
    pattern,
    replacement,
    '"ptitbac:screen-rendered",\n    () => queueMicrotask(ensureRoomModeControl)',
    "lobby-polish-v1.js / observer"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

/* ---------------------------------------------------------
   UI fixes : nettoyages déclenchés par le bus partagé.
   --------------------------------------------------------- */
function patchUiFixes() {
  const name = "ui-fixes-v3.js";
  let source = read(name);

  const before = `  const observer = new MutationObserver(cleanupCurrentScreen);
  observer.observe(document.getElementById("app"), {
    childList: true,
    subtree: true
  });`;

  const after = `  document.addEventListener(
    "ptitbac:screen-rendered",
    cleanupCurrentScreen
  );
  document.addEventListener(
    "ptitbac:dom-updated",
    cleanupCurrentScreen
  );`;

  const result = replaceOnce(
    source,
    before,
    after,
    "ui-fixes-v3.js / observer"
  );

  if (result.changed) write(name, result.source);
  return result.changed;
}

function validate() {
  const names = [
    "app.js",
    "avatar-system-v1.js",
    "avatar-pages-fix-v1.js",
    "progression-client.js",
    "lobby-polish-v1.js",
    "ui-fixes-v3.js"
  ];

  for (const name of names) parseJs(name);

  const app = read("app.js");
  const avatar = read("avatar-system-v1.js");
  const quick = read("avatar-pages-fix-v1.js");
  const progression = read("progression-client.js");
  const lobby = read("lobby-polish-v1.js");
  const ui = read("ui-fixes-v3.js");

  const ownObservers = [
    avatar,
    quick,
    progression,
    lobby,
    ui
  ].reduce(
    (sum, source) =>
      sum + (source.match(/\bnew MutationObserver\(/g) || []).length,
    0
  );

  if (ownObservers !== 0) {
    throw new Error(
      `E4: ${ownObservers} MutationObserver individuel(s) restant(s).`
    );
  }

  const appObservers =
    (app.match(/\bnew MutationObserver\(/g) || []).length;

  if (appObservers < 1) {
    throw new Error("E4: observer partagé absent de app.js.");
  }

  if (!app.includes("ptitbac:screen-rendered")) {
    throw new Error("E4: événement screen-rendered absent.");
  }

  if (!app.includes("ptitbac:dom-updated")) {
    throw new Error("E4: événement dom-updated absent.");
  }

  for (const [name, source] of [
    ["avatar-system-v1.js", avatar],
    ["avatar-pages-fix-v1.js", quick],
    ["progression-client.js", progression],
    ["lobby-polish-v1.js", lobby],
    ["ui-fixes-v3.js", ui]
  ]) {
    if (!source.includes("ptitbac:screen-rendered")) {
      throw new Error(`E4: ${name} n'écoute pas le bus de rendu.`);
    }
  }
}

function main() {
  const required = [
    "app.js",
    "avatar-system-v1.js",
    "avatar-pages-fix-v1.js",
    "progression-client.js",
    "lobby-polish-v1.js",
    "ui-fixes-v3.js"
  ];

  for (const name of required) {
    if (!fs.existsSync(filePath(name))) {
      throw new Error(`E4: fichier manquant: ${name}`);
    }
  }

  const changed = [];
  if (patchApp()) changed.push("app.js");
  if (patchAvatarSystem()) changed.push("avatar-system-v1.js");
  if (patchQuickReroll()) changed.push("avatar-pages-fix-v1.js");
  if (patchProgression()) changed.push("progression-client.js");
  if (patchLobby()) changed.push("lobby-polish-v1.js");
  if (patchUiFixes()) changed.push("ui-fixes-v3.js");

  validate();

  console.log(
    `[E4] Bus de rendu installé. ${changed.length} fichier(s) modifié(s).`
  );
  console.log("[E4] 5 observers individuels -> 0");
  console.log("[E4] 1 observer DOM partagé dans app.js");
  console.log("[E4] screen-rendered + dom-updated : OK");
}

try {
  main();
} catch (error) {
  console.error("[E4] ERREUR:", error?.stack || error?.message || error);
  process.exitCode = 1;
}
