"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = name =>
  fs.readFileSync(path.join(__dirname, name), "utf8");

test("la fin de partie ne crédite plus de pièces", () => {
  const server = source("server.js");
  assert.doesNotMatch(server, /GAME_REWARD/);
  assert.doesNotMatch(server, /distributeRewards\(/);
  assert.doesNotMatch(server, /calculateRewards/);
});

test("la reconnexion renvoie les réponses de la manche au joueur uniquement", () => {
  const server = source("server.js");
  assert.match(server, /myAnswers: viewerRoundAnswers/);
  assert.match(server, /viewerPlayer\.answers\?\.\[room\.roundIndex\]/);
  assert.match(source("app.js"), /syncLocalAnswersFromState/);
  assert.match(source("app.js"), /overwrite:true/);
});

test("le chrono client se synchronise sur l'heure serveur", () => {
  const server = source("server.js");
  const app = source("app.js");
  assert.match(server, /serverNow: Date\.now\(\)/);
  assert.match(app, /serverTimeOffsetMs/);
  assert.match(app, /function serverNowMs/);
  assert.match(source("answer-screen-v1.js"), /serverNowMs/);
  assert.match(source("waiting-screen-v1.js"), /serverNowMs/);
  assert.match(source("round-intro-v1.js"), /serverNowMs/);
});

test("la validation possède un délai maximal et un fallback", () => {
  const server = source("server.js");
  assert.match(server, /AUTO_VALIDATION_HARD_LIMIT_MS/);
  assert.match(server, /completeValidationFallback/);
  assert.match(server, /validation_timeout/);
  assert.match(server, /Validation IA trop lente ou indisponible/);
});

test("la fin de partie distribue XP et trophées via un événement idempotent", () => {
  const progression = source("progression-service.js");
  assert.match(
    progression,
    /game-xp:\$\{room\.code\}:\$\{room\.gameSessionId\}:\$\{player\.id\}/
  );
  assert.match(progression, /gainedTrophies/);
  assert.match(progression, /trophy_delta/);
});
