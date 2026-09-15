"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const exists = name => fs.existsSync(path.join(root, name));

test("le runtime mobile est chargé avant le noyau client", () => {
  const html = read("index.html");
  const runtime = html.indexOf('/mobile-runtime.js');
  const app = html.indexOf('/app.js');

  assert.ok(runtime >= 0, "mobile-runtime.js absent de index.html");
  assert.ok(app >= 0, "app.js absent de index.html");
  assert.ok(runtime < app, "mobile-runtime.js doit être chargé avant app.js");
});

test("le profil n'utilise plus deux scripts concurrents", () => {
  const html = read("index.html");

  assert.match(html, /\/profile-module-v1\.js/);
  assert.doesNotMatch(html, /\/profile-screen-v2\.js/);
  assert.doesNotMatch(html, /\/profile-redesign-v1\.js/);

  const publicFiles = JSON.parse(read("public-files.json"));
  assert.ok(publicFiles.includes("/profile-module-v1.js"));
  assert.ok(!publicFiles.includes("/profile-screen-v2.js"));
  assert.ok(!publicFiles.includes("/profile-redesign-v1.js"));

  assert.equal(exists("profile-screen-v2.js"), false);
  assert.equal(exists("profile-redesign-v1.js"), false);
});

test("le bundle cœur référence uniquement le profil canonique", () => {
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES
    .filter(bundle => bundle.type === "js")
    .flatMap(bundle => bundle.files);

  assert.equal(
    jsFiles.filter(file => file === "profile-module-v1.js").length,
    1
  );
  assert.ok(!jsFiles.includes("profile-screen-v2.js"));
  assert.ok(!jsFiles.includes("profile-redesign-v1.js"));
});

test("le module profil expose les points d'entrée attendus", () => {
  const source = read("profile-module-v1.js");

  assert.match(source, /window\.renderProfile\s*=\s*renderProfileModule/);
  assert.match(source, /window\.renderProfileEdit\s*=\s*openProfileAvatarPicker/);
  assert.match(source, /window\.openProfileAvatarPicker\s*=\s*openProfileAvatarPicker/);
  assert.doesNotMatch(source, /new MutationObserver\s*\(/);
});

test("les anciens patchs lobby, UI et avatar ont disparu du dépôt", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);

  for (const legacy of [
    "ui-fixes-v3.js",
    "ui-fixes-v3.css",
    "lobby-polish-v1.js",
    "lobby-polish-v1.css",
    "avatar-fix-v2.css",
    "avatar-system-v1.css"
  ]) {
    assert.doesNotMatch(html, new RegExp(legacy.replace(".", "\\.")));
    assert.ok(!publicFiles.includes(`/${legacy}`));
    assert.ok(!assets.includes(legacy));
    assert.equal(exists(legacy), false, `${legacy} doit être supprimé du dépôt`);
  }
});

test("les anciens scripts de transformation ont disparu du dépôt", () => {
  for (const legacy of [
    "apply-e1-source-cleanup.cjs",
    "e2-shared-db-build.cjs",
    "e3-functional-fixes-build.cjs",
    "e4-render-events-build.cjs",
    "e5-socket-security-build.cjs"
  ]) {
    assert.equal(exists(legacy), false, `${legacy} doit être supprimé du dépôt`);
  }
});


test("le correctif de position des catégories est absorbé dans le CSS canonique", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);
  const css = read("category-selection-v2.css");

  assert.equal(exists("category-position-fix-v1.css"), false);
  assert.doesNotMatch(html, /category-position-fix-v1\.css/);
  assert.ok(!publicFiles.includes("/category-position-fix-v1.css"));
  assert.ok(!assets.includes("category-position-fix-v1.css"));
  assert.match(css, /Sélection catégories V7/);
  assert.match(css, /Ancien correctif de position absorbé dans ce fichier canonique/);
});



test("les relances Quick ne dépendent plus de avatar-pages-fix-v1.js", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES.filter(bundle => bundle.type === "js").flatMap(bundle => bundle.files);
  const quick = read("quick-lobby-v1.js");

  assert.equal(exists("avatar-pages-fix-v1.js"), false);
  assert.doesNotMatch(html, /avatar-pages-fix-v1\.js/);
  assert.ok(!publicFiles.includes("/avatar-pages-fix-v1.js"));
  assert.ok(!jsFiles.includes("avatar-pages-fix-v1.js"));

  assert.match(quick, /QUICK_REROLL_FALLBACK_COST = 20/);
  assert.match(quick, /game:rerollLetter/);
  assert.match(quick, /game:rerollCategories/);
  assert.match(quick, /game:confirmCategories/);
});

test("les runtimes UI et lobby canoniques sont chargés une seule fois", () => {
  const html = read("index.html");
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);

  for (const canonical of [
    "ui-runtime-v1.js",
    "ui-runtime-v1.css",
    "lobby-runtime-v1.js",
    "lobby-runtime-v1.css",
    "avatar-system-v2.css"
  ]) {
    assert.equal(
      assets.filter(file => file === canonical).length,
      1,
      `${canonical} doit apparaître exactement une fois dans les bundles`
    );
    assert.match(html, new RegExp(`/${canonical.replace(".", "\\.")}`));
  }
});

test("le compte à rebours lobby utilise l'horloge serveur quand elle existe", () => {
  const source = read("lobby-runtime-v1.js");

  assert.match(source, /typeof serverNowMs === "function"/);
  assert.match(source, /const remaining = deadline - runtimeNow\(\)/);
  assert.match(source, /window\.PtitBacLobbyRuntime/);
});

test("le runtime UI tolère une socket absente ou déconnectée", () => {
  const source = read("ui-runtime-v1.js");

  assert.match(source, /typeof socket === "undefined"/);
  assert.match(source, /!socket\?\.connected/);
  assert.match(source, /window\.PtitBacUiRuntime/);
});
