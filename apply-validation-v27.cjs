"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SERVER_FILE = path.join(__dirname, "server.js");
const TARGET_VERSION = "v2.7.0";

function fail(message) {
  throw new Error(`Validation v2.7: ${message}`);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) fail(`ancre introuvable (${label}).`);
  if (source.indexOf(search, first + search.length) >= 0) {
    fail(`ancre non unique (${label}).`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    fail(`${label}: ${matches.length} occurrence(s), 1 attendue.`);
  }
  return source.replace(regex, replacement);
}

function assertJavaScriptSyntax(source, filename) {
  try {
    new vm.Script(String(source || ""), { filename });
  } catch (err) {
    fail(`syntaxe invalide après patch (${filename}): ${err.message}`);
  }
}

function patchServerSource(input) {
  let source = String(input || "");

  const alreadyComplete =
    source.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    source.includes('const DEFAULT_VALIDATION_MODEL = "gpt-5.6-luna";') &&
    source.includes('effort: review ? "low" : "none"') &&
    source.includes("AUTO_VALIDATION_TIMEOUT_MS) || 11000");

  if (alreadyComplete) return { source, changed:false };

  if (!source.includes('require("./validation-engine-v26.cjs")')) {
    fail("la v2.6 doit être appliquée avant la v2.7");
  }

  source = replaceOnce(
    source,
    'const VALIDATION_ENGINE_VERSION = "v2.6.0";',
    `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
    "version moteur"
  );

  source = replaceOnce(
    source,
    'const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";\n' +
    'const OPENAI_VALIDATION_MODEL = process.env.OPENAI_VALIDATION_MODEL || "gpt-5-mini";\n' +
    'const OPENAI_VALIDATION_REVIEW_MODEL = process.env.OPENAI_VALIDATION_REVIEW_MODEL || OPENAI_VALIDATION_MODEL;',
    `const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const DEFAULT_VALIDATION_MODEL = "gpt-5.6-luna";

function configuredValidationModel(value, fallback = DEFAULT_VALIDATION_MODEL) {
  const configured = String(value || "").trim();
  // Migration transparente de l'ancien réglage : même si Render contient
  // encore OPENAI_VALIDATION_MODEL=gpt-5-mini, on évite le modèle qui a
  // provoqué les timeouts observés sur le service.
  if (!configured || configured === "gpt-5-mini") return fallback;
  return configured;
}

const OPENAI_VALIDATION_MODEL = configuredValidationModel(
  process.env.OPENAI_VALIDATION_MODEL
);
const OPENAI_VALIDATION_REVIEW_MODEL = configuredValidationModel(
  process.env.OPENAI_VALIDATION_REVIEW_MODEL,
  OPENAI_VALIDATION_MODEL
);`,
    "modèle de validation rapide"
  );

  source = replaceRegexOnce(
    source,
    /const AUTO_VALIDATION_TIMEOUT_MS = Math\.max\([\s\S]*?\n\);\nconst AUTO_VALIDATION_HARD_LIMIT_MS = Math\.min\([\s\S]*?\n\);/,
    `const AUTO_VALIDATION_TIMEOUT_MS = Math.max(
  6000,
  Math.min(
    15000,
    Number(process.env.AUTO_VALIDATION_TIMEOUT_MS) || 11000
  )
);
const AUTO_VALIDATION_HARD_LIMIT_MS = Math.min(
  36000,
  Math.max(
    24000,
    Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 30000,
    AUTO_VALIDATION_TIMEOUT_MS * 2 + 5000
  )
);`,
    "timeouts v2.7"
  );

  source = replaceOnce(
    source,
    'reasoning: { effort: review ? "medium" : "low" },',
    'reasoning: { effort: review ? "low" : "none" },',
    "raisonnement faible latence"
  );

  source = replaceRegexOnce(
    source,
    /(model: OPENAI_VALIDATION_MODEL,\n\s*store: false,\n)(\s*)input: "Réponds uniquement: OK",/,
    '$1$2reasoning: { effort: "none" },\n$2input: "Réponds uniquement: OK",',
    "diagnostic OpenAI faible latence"
  );

  const requiredMarkers = [
    `const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`,
    'const DEFAULT_VALIDATION_MODEL = "gpt-5.6-luna";',
    'configured === "gpt-5-mini"',
    'effort: review ? "low" : "none"',
    'reasoning: { effort: "none" }',
    'Number(process.env.AUTO_VALIDATION_TIMEOUT_MS) || 11000',
    'Number(process.env.AUTO_VALIDATION_HARD_LIMIT_MS) || 30000'
  ];

  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) fail(`patch incomplet (${marker})`);
  }

  assertJavaScriptSyntax(source, "server.js");
  return { source, changed:true };
}

function applyPatch() {
  if (!fs.existsSync(SERVER_FILE)) fail("server.js introuvable.");

  const initial = fs.readFileSync(SERVER_FILE, "utf8");
  const v27Ready =
    initial.includes(`const VALIDATION_ENGINE_VERSION = "${TARGET_VERSION}";`) &&
    initial.includes('const DEFAULT_VALIDATION_MODEL = "gpt-5.6-luna";');

  if (!v27Ready) {
    const v26Ready =
      initial.includes('const VALIDATION_ENGINE_VERSION = "v2.6.0";') &&
      initial.includes('require("./validation-engine-v26.cjs")');

    if (!v26Ready) {
      require("./apply-validation-v26.cjs").applyPatch();
    }
  }

  const before = fs.readFileSync(SERVER_FILE, "utf8");
  const result = patchServerSource(before);

  if (result.changed) {
    const tmp = `${SERVER_FILE}.validation-v27.tmp`;
    fs.writeFileSync(tmp, result.source, "utf8");
    fs.renameSync(tmp, SERVER_FILE);
  }

  console.log(
    `Validation ${TARGET_VERSION}: mode faible latence actif ` +
    "(GPT-5.6 Luna, primary sans reasoning, review low)."
  );
}

if (require.main === module) applyPatch();

module.exports = {
  TARGET_VERSION,
  patchServerSource,
  applyPatch
};
