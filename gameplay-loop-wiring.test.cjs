"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = name =>
  fs.readFileSync(path.join(__dirname, name), "utf8");

test("quitter pendant catégories ou lettre ne rembourse pas la vie", () => {
  const server = source("server.js");

  const block = server.match(
    /room\.phase === "category_selection" \|\|([\s\S]*?)\n  \}\n\n  const phaseBeforeLeave/
  )?.[1] || "";

  assert.match(block, /room\.phase === "letter_selection"/);
  assert.doesNotMatch(block, /refundPreGameEntry\(room\)/);
  assert.match(block, /La vie consommée n’est pas remboursée/);
});

test("le duel interrompu rembourse uniquement le joueur restant", () => {
  const server = source("server.js");
  assert.match(server, /ptitBacRefundSelectedLives\(room, \[winner\]\)/);
  assert.match(server, /lifeRefunded:true/);
});

test("un hôte déconnecté possède un délai de reconnexion avant transfert", () => {
  const server = source("server.js");
  assert.match(server, /HOST_RECONNECT_GRACE_MS = 15 \* 1000/);
  assert.match(server, /ptitBacScheduleHostTransfer\(room, player\)/);
  assert.match(server, /nextHostCandidate/);
});

test("le Quick ne dépend plus de l'hôte pour quitter le scoreboard", () => {
  const server = source("server.js");
  const screen = source("scoreboard-screen-v1.js");

  assert.match(server, /canAdvanceScoreboard\(room, player\)/);
  assert.match(screen, /user\?\.isHost\|\|state\.mode==="quick"/);
});

test("les sorties joueur attendent la confirmation serveur", () => {
  assert.match(source("lobby-screen-v4.js"), /socket\.timeout\(8000\)\.emit\(/);
  assert.match(source("app.js"), /"game:leave"/);
  assert.match(source("final-screen-v1.js"), /socket\.timeout\(8000\)\.emit\(/);
});

test("les transitions critiques confirment leur réussite par l’état serveur", () => {
  const answers = source("answer-screen-v1.js");
  const validation = source("validation-screen-v1.js");
  const scoreboard = source("scoreboard-screen-v1.js");

  assert.match(answers, /socket\.emit\(\s*"round:submit"/);
  assert.doesNotMatch(answers, /socket\.timeout\([^)]*\)\.emit\(\s*"round:submit"/);
  assert.match(answers, /setTimeout\(\(\) => \{/);
  assert.match(answers, /La validation n’a pas été confirmée\. Réessaie\./);

  assert.match(validation, /socket\.emit\(\s*"validation:retry"/);
  assert.doesNotMatch(validation, /socket\.timeout\([^)]*\)\.emit\(\s*"validation:retry"/);
  assert.match(validation, /setTimeout\(\(\) => \{/);
  assert.match(validation, /La relance n’a pas été confirmée\. Réessaie\./);

  assert.match(scoreboard, /socket\.emit\(\s*"game:nextRound"/);
  assert.doesNotMatch(scoreboard, /socket\.timeout\([^)]*\)\.emit\(\s*"game:nextRound"/);
  assert.match(scoreboard, /setTimeout\(\(\)=>\{/);
  assert.match(scoreboard, /Le passage à la suite n’a pas été confirmé\. Réessaie\./);
});

test("la préparation catégories puis lettre utilise un watchdog d’état serveur", () => {
  const categories = source("category-selection-v2.js");
  const wheel = source("letter-wheel-v1.js");
  const quick = source("quick-lobby-v1.js");

  assert.match(categories, /state\.categoryRerollCost \|\| 20/);
  assert.match(categories, /socket\.emit\(\s*"game:rerollCategories"/);
  assert.match(categories, /socket\.emit\(\s*"game:confirmCategories"/);
  assert.match(categories, /socket\.emit\(\s*"game:returnLobby"/);
  assert.doesNotMatch(categories, /socket\.timeout\([^)]*\)\.emit\(\s*"game:(?:rerollCategories|confirmCategories|returnLobby)"/);
  assert.match(categories, /Le passage à la lettre n’a pas été confirmé\. Réessaie\./);

  assert.match(wheel, /state\.letterRerollCost \|\| 20/);
  assert.match(wheel, /socket\.emit\(\s*"game:spinLetter"/);
  assert.match(wheel, /socket\.emit\(\s*"game:rerollLetter"/);
  assert.match(wheel, /socket\.emit\(\s*"game:confirmLetter"/);
  assert.doesNotMatch(wheel, /socket\.timeout\([^)]*\)\.emit\(\s*"game:(?:spinLetter|rerollLetter|confirmLetter)"/);
  assert.match(wheel, /Le lancement de la manche n’a pas été confirmé\. Réessaie\./);

  assert.match(quick, /socket\.emit\(\s*"game:rerollLetter"/);
  assert.match(quick, /socket\.emit\(\s*"game:rerollCategories"/);
  assert.match(quick, /socket\.emit\(\s*"game:confirmCategories"/);
  assert.doesNotMatch(quick, /socket\.timeout\([^)]*\)\.emit\(\s*"game:(?:rerollLetter|rerollCategories|confirmCategories)"/);
  assert.match(quick, /La relance de la lettre n’a pas été confirmée\. Réessaie\./);
});

