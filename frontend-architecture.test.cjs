"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), "utf8");

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
