"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = __dirname;
const VERSION = "1.48.0";

function file(name) {
  return path.join(ROOT, name);
}

function read(name) {
  return fs.readFileSync(file(name), "utf8");
}

function write(name, value) {
  fs.writeFileSync(file(name), value, "utf8");
}

function fail(message) {
  throw new Error(`[stabilisation ${VERSION}] ${message}`);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) fail(`ancre introuvable: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    fail(`ancre non unique: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    fail(`${label}: ${matches.length} occurrence(s), 1 attendue`);
  }
  return source.replace(regex, replacement);
}

function runNode(name) {
  execFileSync(process.execPath, [file(name)], {
    cwd: ROOT,
    stdio: "inherit"
  });
}

function integrateExistingPatches() {
  // Produit d'abord exactement le code actuellement exécuté sur Render.
  runNode("apply-validation-v27.cjs");
  runNode("apply-admin-page-v2.cjs");
}

function stabilizeServer() {
  let source = read("server.js");

  if (!source.includes('const VALIDATION_ENGINE_VERSION = "v2.7.0";')) {
    fail("server.js n'est pas en validation v2.7 après intégration");
  }
  if (!source.includes("function scheduleMatchmakingBotFill(")) {
    fail("bots publics non intégrés dans server.js");
  }

  // Bots : même modèle faible latence que l'arbitre.
  source = replaceOnce(
    source,
    'const OPENAI_BOT_MODEL = process.env.OPENAI_BOT_MODEL || "gpt-5-mini";',
    `function configuredBotModel(value) {
  const configured = String(value || "").trim();
  if (!configured || configured === "gpt-5-mini") return "gpt-5.6-luna";
  return configured;
}
const OPENAI_BOT_MODEL = configuredBotModel(process.env.OPENAI_BOT_MODEL);`,
    "modèle IA bots"
  );

  source = replaceOnce(
    source,
    `        model: OPENAI_BOT_MODEL,
        store: false,
        input: prompt,`,
    `        model: OPENAI_BOT_MODEL,
        store: false,
        reasoning: { effort: "none" },
        input: prompt,`,
    "reasoning bots"
  );

  // Le diagnostic public ne doit plus exposer le stockage, les erreurs ou le modèle.
  const healthRoute = `app.get("/api/validation-health", async (req, res) => {
  const authorized =
    !!ADMIN_DIAGNOSTIC_CODE &&
    req.get("Authorization") === \`Bearer \${ADMIN_DIAGNOSTIC_CODE}\`;

  const validationStatus = !OPENAI_API_KEY
    ? "disabled"
    : validationServiceState.lastErrorAt &&
      (!validationServiceState.lastSuccessAt ||
       validationServiceState.lastErrorAt > validationServiceState.lastSuccessAt)
      ? "degraded"
      : validationServiceState.lastSuccessAt
        ? "operational"
        : "unknown";

  if (!authorized) {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok:true,
      buildVersion:BUILD_VERSION,
      engineVersion:VALIDATION_ENGINE_VERSION,
      validationStatus
    });
  }

  let liveCheck = null;
  if (String(req.query.live || "") === "1") {
    liveCheck = await testOpenAIConnection();
  }

  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok:true,
    buildVersion:BUILD_VERSION,
    engineVersion:VALIDATION_ENGINE_VERSION,
    learningEngineVersion:LEARNING_ENGINE_VERSION,
    validationStatus,
    aiConfigured:Boolean(OPENAI_API_KEY),
    model:OPENAI_VALIDATION_MODEL,
    reviewModel:OPENAI_VALIDATION_REVIEW_MODEL,
    botModel:OPENAI_BOT_MODEL,
    webSearchReview:OPENAI_VALIDATION_WEB_SEARCH,
    cacheEntries:validationCache.size,
    cacheStorage:validationCacheStorageMode,
    cacheMemoryLimit:VALIDATION_CACHE_MEMORY_LIMIT,
    learnedAnswers:learnedAnswers.size,
    answerReports:answerReports.size,
    learningStorage:pgPool ? "postgres" : "json",
    walletStorage:walletStorageMode,
    lastSuccessAt:validationServiceState.lastSuccessAt,
    lastErrorAt:validationServiceState.lastErrorAt,
    lastErrorStatus:validationServiceState.lastErrorStatus,
    lastErrorCode:validationServiceState.lastErrorCode,
    lastErrorMessage:validationServiceState.lastErrorMessage,
    liveCheck
  });
});`;

  source = replaceRegexOnce(
    source,
    /app\.get\("\/api\/validation-health", async \(req, res\) => \{[\s\S]*?\n\}\);\n\nconst CATEGORY_LEVELS =/,
    `${healthRoute}\n\nconst CATEGORY_LEVELS =`,
    "route validation-health"
  );

  // Marqueur explicite de la source stabilisée.
  if (!source.includes('const SOURCE_RELEASE = "1.48.0-stable";')) {
    source = replaceOnce(
      source,
      'const BUILD_VERSION = require("./package.json").version;',
      'const BUILD_VERSION = require("./package.json").version;\nconst SOURCE_RELEASE = "1.48.0-stable";',
      "marqueur release"
    );
  }

  write("server.js", source);
}

function stabilizePackage() {
  const pkg = JSON.parse(read("package.json"));
  pkg.version = VERSION;

  delete pkg.scripts.prestart;
  delete pkg.scripts.predev;
  delete pkg.scripts.pretest;

  pkg.scripts.start = "node server.js";
  pkg.scripts.dev = "node --watch server.js";
  pkg.scripts.test = "node --test *.test.cjs";
  pkg.scripts.check = "node ci-check.cjs";
  pkg.scripts["check:production"] = "node ci-check.cjs --production";
  pkg.scripts.ci = "npm test && npm run check";

  write("package.json", JSON.stringify(pkg, null, 2) + "\n");

  const lock = JSON.parse(read("package-lock.json"));
  lock.version = VERSION;
  if (lock.packages?.[""]) lock.packages[""].version = VERSION;
  write("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
}

function stabilizeFrontendVersion() {
  let app = read("app.js");
  app = app.replace(
    /const CLIENT_BUILD = "\d+\.\d+\.\d+";/,
    `const CLIENT_BUILD = "${VERSION}";`
  );
  write("app.js", app);

  let index = read("index.html");
  index = index.replace(/([?&]v=)1\.47\.0/g, `$1${VERSION}`);
  write("index.html", index);
}

function hardenCi() {
  let ci = read("ci-check.cjs");

  const oldPackageTail = `  for (const script of ["test", "check", "check:production"]) {
    if (!pkg?.scripts?.[script]) fail(\`script npm manquant: \${script}\`);
  }
}`;

  const newPackageTail = `  for (const script of ["test", "check", "check:production"]) {
    if (!pkg?.scripts?.[script]) fail(\`script npm manquant: \${script}\`);
  }

  if (pkg?.scripts?.prestart || pkg?.scripts?.predev || pkg?.scripts?.pretest) {
    fail("les patchers runtime ne doivent plus être exécutés en 1.48.0.");
  }
  if (pkg?.scripts?.start !== "node server.js") {
    fail("npm start doit lancer directement server.js.");
  }
}`;

  if (ci.includes(oldPackageTail)) {
    ci = ci.replace(oldPackageTail, newPackageTail);
  } else if (!ci.includes("les patchers runtime ne doivent plus être exécutés")) {
    fail("ancre checkPackage ci-check introuvable");
  }

  if (!ci.includes('VALIDATION_ENGINE_VERSION = "v2.7.0"')) {
    const marker = `    "startApplication()"\n  ]) {`;
    const replacement = `    "startApplication()",\n    'VALIDATION_ENGINE_VERSION = "v2.7.0"',\n    'SOURCE_RELEASE = "1.48.0-stable"'\n  ]) {`;
    ci = replaceOnce(ci, marker, replacement, "markers déploiement stable");
  }

  write("ci-check.cjs", ci);
}

function verifyFinalSource() {
  const server = read("server.js");
  const roomMode = read("room-mode-rules.js");
  const progression = read("progression-service.js");
  const pkg = JSON.parse(read("package.json"));

  const requirements = [
    [server.includes('VALIDATION_ENGINE_VERSION = "v2.7.0"'), "validation v2.7"],
    [server.includes('DEFAULT_VALIDATION_MODEL = "gpt-5.6-luna"'), "Luna correction"],
    [server.includes('return "gpt-5.6-luna"'), "Luna bots"],
    [server.includes("function scheduleMatchmakingBotFill("), "bots publics"],
    [server.includes('SOURCE_RELEASE = "1.48.0-stable"'), "release stable"],
    [server.includes('validationStatus'), "monitoring validation"],
    [roomMode.includes('player?.botKind !== "matchmaking"'), "room mode bots"],
    [progression.includes("rankingForAllParticipants"), "progression bots"],
    [pkg.version === VERSION, "version package"],
    [pkg.scripts.start === "node server.js", "start direct"],
    [!pkg.scripts.prestart && !pkg.scripts.predev && !pkg.scripts.pretest, "aucun pre-patcher"]
  ];

  const failed = requirements.filter(([ok]) => !ok).map(([, label]) => label);
  if (failed.length) fail(`vérification finale échouée: ${failed.join(", ")}`);

  for (const name of [
    "server.js",
    "room-mode-rules.js",
    "progression-service.js",
    "admin-hook.js",
    "admin-v1.js",
    "db-migrations.js",
    "ci-check.cjs"
  ]) {
    execFileSync(process.execPath, ["--check", file(name)], {
      cwd: ROOT,
      stdio: "pipe"
    });
  }
}

function main() {
  integrateExistingPatches();
  stabilizeServer();
  stabilizePackage();
  stabilizeFrontendVersion();
  hardenCi();
  verifyFinalSource();

  console.log(`✅ P'tit Bac ${VERSION} stabilisé.`);
  console.log("✅ server.js contient directement validation v2.7 + bots publics.");
  console.log("✅ admin intégré définitivement.");
  console.log("✅ npm start lance directement server.js.");
  console.log("✅ bots IA alignés sur GPT-5.6 Luna.");
  console.log("✅ diagnostic IA public réduit et détail réservé à l'admin.");
}

main();
