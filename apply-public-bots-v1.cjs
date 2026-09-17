"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SERVER_FILE = path.join(__dirname, "server.js");
const ROOM_MODE_FILE = path.join(__dirname, "room-mode-rules.js");
const PROGRESSION_FILE = path.join(__dirname, "progression-service.js");
const BOT_VERSION = "public-bots-v1.0.0";

function fail(message) {
  throw new Error(`Bots publics v1: ${message}`);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) fail(`ancre introuvable (${label})`);
  if (source.indexOf(search, first + search.length) >= 0) {
    fail(`ancre non unique (${label})`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) fail(`${label}: ${matches.length} occurrence(s), 1 attendue`);
  return source.replace(regex, replacement);
}

function assertJavaScriptSyntax(source, filename) {
  try {
    new vm.Script(String(source || ""), { filename });
  } catch (err) {
    fail(`syntaxe invalide après patch (${filename}): ${err.message}`);
  }
}

function patchRoomModeSource(input) {
  let source = String(input || "");
  if (source.includes('player?.botKind !== "matchmaking"')) {
    return { source, changed:false };
  }

  source = replaceOnce(
    source,
    '  if (!Array.isArray(room.players) || room.players.length < 1 || room.players.length >= 6) return false;\n  if (room.players.some(player => player?.isBot)) return false;',
    '  if (!Array.isArray(room.players)) return false;\n  const humanCount = room.players.filter(player => !player?.isBot).length;\n  if (humanCount < 1 || humanCount >= 6) return false;\n  if (room.players.some(player => player?.isBot && player?.botKind !== "matchmaking")) return false;',
    "salons publics avec bot remplaçable"
  );

  return { source, changed:true };
}

function patchProgressionSource(input) {
  let source = String(input || "");
  if (
    source.includes("function rankingForAllParticipants(") &&
    source.includes('player?.botKind === "matchmaking"')
  ) {
    return { source, changed:false };
  }

  source = replaceOnce(
    source,
    "function calculateRoomXp(room) {",
    `function rankingForAllParticipants(players = []) {
  const ranked = [...players]
    .filter(player => player?.isBot || player?.walletToken)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  const rankByPlayerId = {};
  let rank = 1;

  ranked.forEach((player, index) => {
    if (
      index > 0 &&
      Number(player.score || 0) !== Number(ranked[index - 1].score || 0)
    ) {
      rank = index + 1;
    }
    rankByPlayerId[player.id] = rank;
  });

  return rankByPlayerId;
}

function calculateRoomXp(room) {`,
    "classement global humains/bots"
  );

  source = replaceOnce(
    source,
    '  if (!Array.isArray(room.players) || room.players.some(player => player?.isBot)) return results;\n\n  const humans = room.players.filter(player => !player?.isBot && player?.walletToken);\n  if (humans.length < 2) return results;',
    `  if (!Array.isArray(room.players)) return results;

  const humans = room.players.filter(
    player => !player?.isBot && player?.walletToken
  );
  const hasMatchmakingBot = room.players.some(
    player => player?.isBot && player?.botKind === "matchmaking"
  );

  if (humans.length < 1) return results;
  if (humans.length < 2 && !hasMatchmakingBot) return results;

  const competitiveHumanRewards = humans.length >= 2;`,
    "éligibilité progression avec bots publics"
  );

  source = replaceOnce(
    source,
    "  const ranks = rankingForPlayers(humans);",
    `  const ranks = competitiveHumanRewards
    ? rankingForAllParticipants(room.players)
    : {};`,
    "classement récompenses avec bots"
  );

  source = replaceOnce(
    source,
    '    const rank = ranks[player.id] || 0;\n    // E3: l’XP récompense les réponses réellement validées,',
    `    const rank = competitiveHumanRewards
      ? (ranks[player.id] || 0)
      : 0;
    // E3: l’XP récompense les réponses réellement validées,`,
    "rang anti-farm"
  );

  source = replaceOnce(
    source,
    '      validAnswers * VALID_ANSWER_XP +\n      (RANK_BONUS[rank] || 0);',
    `      validAnswers * VALID_ANSWER_XP +
      (competitiveHumanRewards ? (RANK_BONUS[rank] || 0) : 0);`,
    "bonus classement anti-farm"
  );

  source = replaceOnce(
    source,
    '      trophies: TROPHY_REWARDS[rank] ?? TROPHY_REWARDS.default,',
    `      trophies: competitiveHumanRewards
        ? (TROPHY_REWARDS[rank] ?? TROPHY_REWARDS.default)
        : 0,`,
    "trophées anti-farm"
  );

  return { source, changed:true };
}

function patchServerSource(input) {
  let source = String(input || "");

  const alreadyComplete =
    source.includes(`const PUBLIC_BOT_ENGINE_VERSION = "${BOT_VERSION}";`) &&
    source.includes('require("./public-bot-engine-v1.cjs")') &&
    source.includes('require("./quick-match-v2.js")') &&
    source.includes("function scheduleMatchmakingBotFill(") &&
    source.includes("function humanizeAiBotPlans(") &&
    source.includes("PUBLIC_MATCHMAKING_BOT_DELAY_MS") &&
    source.includes("botDifficulty:") &&
    source.includes("isBot: !!p.isBot && !publicBotEngine.isMatchmakingBot(p)");
  if (alreadyComplete) return { source, changed:false };

  if (!source.includes('require("./validation-cache-v25.cjs")')) {
    fail("la v2.5 du moteur de correction doit être appliquée avant les bots publics");
  }

  if (!source.includes('require("./public-bot-engine-v1.cjs")')) {
    source = replaceOnce(
      source,
      'const validationCacheStore = require("./validation-cache-v25.cjs");',
      'const validationCacheStore = require("./validation-cache-v25.cjs");\nconst publicBotEngine = require("./public-bot-engine-v1.cjs");',
      "import moteur bots"
    );
  }

  source = source.replace(
    `      !room.economyStartPending && room.players.length < 6 &&
      room.players.some(p => !p.isBot && p.walletToken === token && p.connected);`,
    `      !room.economyStartPending &&
      (room.players.length < 6 || room.players.some(publicBotEngine.isMatchmakingBot)) &&
      room.players.some(p => !p.isBot && p.walletToken === token && p.connected);`
  );

  if (!source.includes("const PUBLIC_BOT_ENGINE_VERSION =")) {
    source = replaceOnce(
      source,
      'const LEARNING_ENGINE_VERSION = "learn-v1.0.0";',
      `const LEARNING_ENGINE_VERSION = "learn-v1.0.0";\nconst PUBLIC_BOT_ENGINE_VERSION = "${BOT_VERSION}";`,
      "version bots"
    );
  }

  if (!source.includes("const PUBLIC_MATCHMAKING_BOT_DELAY_MS =")) {
    source = replaceOnce(
      source,
      'const BOT_AI_TIMEOUT_MS = Math.max(30000, Number(process.env.BOT_AI_TIMEOUT_MS) || 30000);',
      `const BOT_AI_TIMEOUT_MS = Math.max(
  4000,
  Math.min(12000, Number(process.env.BOT_AI_TIMEOUT_MS) || 7000)
);
const PUBLIC_MATCHMAKING_BOTS_ENABLED =
  String(process.env.PUBLIC_MATCHMAKING_BOTS_ENABLED || "true").toLowerCase() !== "false";
const PUBLIC_MATCHMAKING_BOT_DELAY_MS = publicBotEngine.clampInteger(
  process.env.PUBLIC_MATCHMAKING_BOT_DELAY_MS,
  3000,
  30000,
  8000
);`,
      "configuration bots publics"
    );
  } else if (
    source.includes(
      'const BOT_AI_TIMEOUT_MS = Math.max(30000, Number(process.env.BOT_AI_TIMEOUT_MS) || 30000);'
    )
  ) {
    source = source.replace(
      'const BOT_AI_TIMEOUT_MS = Math.max(30000, Number(process.env.BOT_AI_TIMEOUT_MS) || 30000);',
      `const BOT_AI_TIMEOUT_MS = Math.max(
  4000,
  Math.min(12000, Number(process.env.BOT_AI_TIMEOUT_MS) || 7000)
);`
    );
  }

  if (!source.includes("const publicBotFillTimers = new Map();")) {
    source = replaceOnce(
      source,
      "const validationPrewarmJobs = new Map();",
      "const validationPrewarmJobs = new Map();\nconst publicBotFillTimers = new Map();",
      "timers bots publics"
    );
  }

  source = source.replace(
    "    isBot: !!p.isBot,",
    "    isBot: !!p.isBot && !publicBotEngine.isMatchmakingBot(p),"
  );

  const botHelpers = `
function cancelMatchmakingBotFill(roomCode) {
  const code = String(roomCode || "").trim().toUpperCase();
  const timer = publicBotFillTimers.get(code);
  if (timer) clearTimeout(timer);
  publicBotFillTimers.delete(code);
}

function removeOneMatchmakingBot(room) {
  if (!room?.players) return false;
  const index = room.players.findIndex(publicBotEngine.isMatchmakingBot);
  if (index < 0) return false;
  room.players.splice(index, 1);
  cancelMatchmakingBotFill(room.code);
  return true;
}

function removeAllMatchmakingBots(room) {
  if (!room?.players) return 0;
  const before = room.players.length;
  room.players = room.players.filter(
    player => !publicBotEngine.isMatchmakingBot(player)
  );
  cancelMatchmakingBotFill(room.code);
  return before - room.players.length;
}

function addMatchmakingBot(room) {
  if (!PUBLIC_MATCHMAKING_BOTS_ENABLED || !publicBotEngine.shouldFillRoom(room)) {
    return null;
  }

  const identity = publicBotEngine.pickIdentity(room.players);
  const bot = {
    id: id(),
    name: identity.name,
    connected: true,
    socketId: null,
    score: 0,
    isHost: false,
    isBot: true,
    botKind: publicBotEngine.MATCHMAKING_BOT_KIND,
    botDifficulty: publicBotEngine.pickDifficulty(),
    botPersona: BOT_PERSONAS[Math.floor(Math.random() * BOT_PERSONAS.length)].id,
    walletToken: null,
    avatar: identity.avatar,
    frameId: "",
    tagId: "tag_debutant",
    friendCode: "",
    lobbyReady: true,
    submitted: false,
    answers: {}
  };

  room.players.push(bot);
  emitRoom(room);
  try { quickMatch.refreshByCode(room.code); } catch {}
  return bot;
}

function scheduleMatchmakingBotFill(room) {
  if (!room?.code) return;
  cancelMatchmakingBotFill(room.code);

  if (!PUBLIC_MATCHMAKING_BOTS_ENABLED || !publicBotEngine.shouldFillRoom(room)) {
    return;
  }

  const timer = setTimeout(() => {
    publicBotFillTimers.delete(room.code);
    const current = rooms.get(room.code);
    if (current !== room || !publicBotEngine.shouldFillRoom(current)) return;
    addMatchmakingBot(current);
  }, PUBLIC_MATCHMAKING_BOT_DELAY_MS);

  timer.unref?.();
  publicBotFillTimers.set(room.code, timer);
}

`;

  if (!source.includes("function scheduleMatchmakingBotFill(")) {
    source = replaceOnce(
      source,
      "function findPublicLobbyForQuick(walletToken) {",
      botHelpers + "function findPublicLobbyForQuick(walletToken) {",
      "helpers bots matchmaking"
    );
  }

  if (!source.includes('require("./quick-match-v2.js")')) {
    source = replaceOnce(
      source,
      'const quickMatch = require("./quick-match.js")({\n  io,',
      `const quickMatch = require("./quick-match-v2.js")({
  io,
  participantCount(entries) {
    const code = entries.find(entry => entry.code)?.code;
    const room = getRoom(code);
    return room
      ? room.players.filter(player => player.isBot || player.connected).length
      : entries.length;
  },
  hasReplaceableFiller(entries) {
    const code = entries.find(entry => entry.code)?.code;
    const room = getRoom(code);
    return !!room?.players?.some(publicBotEngine.isMatchmakingBot);
  },`,
      "quick-match v2"
    );
  }

  source = source.replace(
    `  player.socketId = socket.id;
  player.connected = true;
  socket.join(room.code);`,
    `  player.socketId = socket.id;
  player.connected = true;

  if (
    !player.isBot &&
    room.phase === "lobby" &&
    ["public", "quick"].includes(room.mode)
  ) {
    if (publicBotEngine.connectedHumanCount(room) >= 2) {
      removeOneMatchmakingBot(room);
    }
    scheduleMatchmakingBotFill(room);
  }

  socket.join(room.code);`
  );

  source = source.replace(
    `    rooms.set(code, room);
    setPlayerSocket(room, player, socket);`,
    `    rooms.set(code, room);
    scheduleMatchmakingBotFill(room);
    setPlayerSocket(room, player, socket);`
  );

  source = source.replace(
    `    if (!safeName) return cb({ ok: false, error: "Choisis un prénom." });
    if (room.players.length >= 6) return cb({ ok: false, error: "Cette partie est pleine (6 joueurs maximum)." });`,
    `    if (!safeName) return cb({ ok: false, error: "Choisis un prénom." });
    if (
      room.players.length >= 6 &&
      !room.players.some(publicBotEngine.isMatchmakingBot)
    ) {
      return cb({ ok: false, error: "Cette partie est pleine (6 joueurs maximum)." });
    }`
  );

  source = source.replace(
    `    const duplicateName = room.players.some(p => p.name.toLowerCase() === safeName.toLowerCase());
    if (duplicateName) return cb({ ok: false, error: "Ce prénom est déjà utilisé." });

    const player = {`,
    `    const duplicateName = room.players.some(
      p =>
        !publicBotEngine.isMatchmakingBot(p) &&
        p.name.toLowerCase() === safeName.toLowerCase()
    );
    if (duplicateName) return cb({ ok: false, error: "Ce prénom est déjà utilisé." });

    if (["public", "quick"].includes(room.mode)) {
      removeOneMatchmakingBot(room);
    }

    const player = {`
  );

  source = source.replace(
    `    room.players.push(player);
    setPlayerSocket(room, player, socket);`,
    `    room.players.push(player);
    scheduleMatchmakingBotFill(room);
    setPlayerSocket(room, player, socket);`
  );

  source = source.replace(
    `  // Départ classique depuis le salon ou après la fin.
  if (!isActiveGame) {
    if (room.players.length === 0) {`,
    `  // Départ classique depuis le salon ou après la fin.
  if (!isActiveGame) {
    if (!room.players.some(p => !p.isBot)) {
      removeAllMatchmakingBots(room);
    }

    if (room.players.length === 0) {`
  );

  source = source.replace(
    `    if (room.players.length < 2) {
      return socket.emit("toast", "Il faut au moins 2 joueurs.");
    }`,
    `    if (room.players.length < 2) {
      return socket.emit("toast", "Il faut au moins 2 joueurs.");
    }
    cancelMatchmakingBotFill(room.code);`
  );

  source = source.replace(
    `  if (!safeCode) return false;

  const timer = roomPersistTimers.get(safeCode);`,
    `  if (!safeCode) return false;

  cancelMatchmakingBotFill(safeCode);
  const timer = roomPersistTimers.get(safeCode);`
  );

  source = source.replace(
    `    if (nextMode === "public" && room.players.some(p => p.isBot)) {`,
    `    if (nextMode === "public" && room.players.some(
      p => p.isBot && !publicBotEngine.isMatchmakingBot(p)
    )) {`
  );

  source = source.replace(
    `    if (room.mode !== nextMode) {
      room.mode = nextMode;
      room.players.forEach(p => { p.lobbyReady = false; });`,
    `    if (room.mode !== nextMode) {
      room.mode = nextMode;
      if (nextMode === "private") removeAllMatchmakingBots(room);
      else scheduleMatchmakingBotFill(room);
      room.players.forEach(p => { p.lobbyReady = false; });`
  );

  if (!source.includes("function humanizeAiBotPlans(")) {
    source = replaceOnce(
      source,
      "function diversifyBotPlans(room, bots, plans, letter) {",
      `function humanizeAiBotPlans(room, bots, plans) {
  bots.forEach((bot, botIndex) => {
    const persona = botPersonaFor(bot, botIndex);
    const answers = plans.get(bot.id) || {};

    for (const category of room.categories) {
      if (!answers[category]) continue;
      // Même l'IA ne doit pas rendre chaque joueur artificiellement parfait.
      // Une partie des cases trouvées est donc laissée vide selon le niveau.
      if (Math.random() < Math.min(0.42, persona.missRate * 0.65)) {
        answers[category] = "";
      }
    }

    plans.set(bot.id, answers);
  });

  return plans;
}

function diversifyBotPlans(room, bots, plans, letter) {`,
      "humanisation plans IA"
    );
  }

  source = source.replace(
    `      if (answer && seen.has(key)) {
        const alternative = localBotAnswer(category, letter, seen);
        if (alternative) answer = alternative;
      }`,
    `      // Les humains peuvent aussi tomber sur le même mot : on conserve
      // volontairement une partie des vrais doublons.
      if (answer && seen.has(key) && Math.random() < 0.72) {
        const alternative = localBotAnswer(category, letter, seen);
        if (alternative) answer = alternative;
      }`
  );

  source = source.replace(
    `    const plans = diversifyBotPlans(current, bots, aiPlans || buildLocalBotPlans(current, bots, letter), letter);`,
    `    const sourcePlans = aiPlans
      ? humanizeAiBotPlans(current, bots, aiPlans)
      : buildLocalBotPlans(current, bots, letter);
    const plans = diversifyBotPlans(current, bots, sourcePlans, letter);`
  );

  source = source.replace(
    `function botPersonaFor(bot, botIndex = 0) {
  if (bot.botPersona) return BOT_PERSONAS.find(p => p.id === bot.botPersona) || BOT_PERSONAS[botIndex % BOT_PERSONAS.length];
  const persona = BOT_PERSONAS[Math.floor(Math.random() * BOT_PERSONAS.length)];
  bot.botPersona = persona.id;
  return persona;
}`,
    `function botPersonaFor(bot, botIndex = 0) {
  let persona = bot.botPersona
    ? (BOT_PERSONAS.find(p => p.id === bot.botPersona) || BOT_PERSONAS[botIndex % BOT_PERSONAS.length])
    : BOT_PERSONAS[Math.floor(Math.random() * BOT_PERSONAS.length)];

  if (!bot.botPersona) bot.botPersona = persona.id;
  if (!bot.botDifficulty) bot.botDifficulty = publicBotEngine.pickDifficulty();
  return publicBotEngine.applyDifficulty(persona, bot.botDifficulty);
}`
  );

  source = source.replace(
    `      return { id: bot.id, name: bot.name, persona: persona.label, instruction: persona.instruction };`,
    `      return {
        id: bot.id,
        name: bot.name,
        persona: persona.label,
        difficulty: persona.difficultyLabel,
        instruction: persona.instruction
      };`
  );

  source = source.replace(
    `      botPersona: BOT_PERSONAS[Math.floor(Math.random() * BOT_PERSONAS.length)].id,
      submitted: false,`,
    `      botPersona: BOT_PERSONAS[Math.floor(Math.random() * BOT_PERSONAS.length)].id,
      botDifficulty: publicBotEngine.pickDifficulty(),
      submitted: false,`
  );

  source = source.replace(
    `    emitRoom(room);

    // Nettoyage après 3 heures d'inactivité totale.`,
    `    emitRoom(room);
    scheduleMatchmakingBotFill(room);

    // Nettoyage après 3 heures d'inactivité totale.`
  );

  // Lorsqu'un vrai joueur quitte un lobby public, le remplissage peut reprendre.
  source = source.replace(
    `    emitRoom(room);
    return cb({ ok:true, outcome:"left_room" });`,
    `    emitRoom(room);
    scheduleMatchmakingBotFill(room);
    return cb({ ok:true, outcome:"left_room" });`
  );

  const requiredMarkers = [
    `const PUBLIC_BOT_ENGINE_VERSION = "${BOT_VERSION}";`,
    'require("./public-bot-engine-v1.cjs")',
    'require("./quick-match-v2.js")',
    "function scheduleMatchmakingBotFill(",
    "function humanizeAiBotPlans(",
    "PUBLIC_MATCHMAKING_BOT_DELAY_MS",
    "Math.min(12000, Number(process.env.BOT_AI_TIMEOUT_MS) || 7000)",
    "isBot: !!p.isBot && !publicBotEngine.isMatchmakingBot(p)",
    "p => p.isBot && !publicBotEngine.isMatchmakingBot(p)",
    "room.players.some(publicBotEngine.isMatchmakingBot)",
    "removeOneMatchmakingBot(room);",
    "removeAllMatchmakingBots(room);",
    "cancelMatchmakingBotFill(room.code);",
    "!publicBotEngine.isMatchmakingBot(p) &&",
    "difficulty: persona.difficultyLabel",
    "scheduleMatchmakingBotFill(room);"
  ];

  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) {
      fail(`patch serveur incomplet (${marker})`);
    }
  }

  return { source, changed:true };
}

function applyPatch() {
  if (!fs.existsSync(SERVER_FILE)) fail("server.js introuvable");

  // Le patch v2.5 appelle lui-même v2.4. Une fois v2.5 déjà appliquée,
  // le relancer au prestart après un pretest serait inutile et fragile.
  const initialServer = fs.readFileSync(SERVER_FILE, "utf8");
  const validationV25Ready =
    initialServer.includes('const VALIDATION_ENGINE_VERSION = "v2.5.0";') &&
    initialServer.includes('require("./validation-cache-v25.cjs")');

  if (!validationV25Ready) {
    require("./apply-validation-v25.cjs").applyPatch();
  }

  for (const file of [SERVER_FILE, ROOM_MODE_FILE, PROGRESSION_FILE]) {
    if (!fs.existsSync(file)) fail(`${path.basename(file)} introuvable`);
  }

  const serverBefore = fs.readFileSync(SERVER_FILE, "utf8");
  const serverResult = patchServerSource(serverBefore);
  assertJavaScriptSyntax(serverResult.source, "server.js");
  if (serverResult.changed) {
    const tmp = `${SERVER_FILE}.public-bots-v1.tmp`;
    fs.writeFileSync(tmp, serverResult.source, "utf8");
    fs.renameSync(tmp, SERVER_FILE);
  }

  const roomModeBefore = fs.readFileSync(ROOM_MODE_FILE, "utf8");
  const roomModeResult = patchRoomModeSource(roomModeBefore);
  assertJavaScriptSyntax(roomModeResult.source, "room-mode-rules.js");
  if (roomModeResult.changed) {
    const tmp = `${ROOM_MODE_FILE}.public-bots-v1.tmp`;
    fs.writeFileSync(tmp, roomModeResult.source, "utf8");
    fs.renameSync(tmp, ROOM_MODE_FILE);
  }

  const progressionBefore = fs.readFileSync(PROGRESSION_FILE, "utf8");
  const progressionResult = patchProgressionSource(progressionBefore);
  assertJavaScriptSyntax(progressionResult.source, "progression-service.js");
  if (progressionResult.changed) {
    const tmp = `${PROGRESSION_FILE}.public-bots-v1.tmp`;
    fs.writeFileSync(tmp, progressionResult.source, "utf8");
    fs.renameSync(tmp, PROGRESSION_FILE);
  }

  console.log(
    `Bots publics ${BOT_VERSION}: matchmaking automatique actif ` +
    "(remplissage 8s, remplacement par humains, profils réalistes)."
  );
}

if (require.main === module) applyPatch();

module.exports = {
  BOT_VERSION,
  patchServerSource,
  patchRoomModeSource,
  patchProgressionSource,
  applyPatch
};
