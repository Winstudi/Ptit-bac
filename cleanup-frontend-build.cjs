"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const indexPath = path.join(root, "index.html");
const publicFilesPath = path.join(root, "public-files.json");
const CHECK_ONLY = process.argv.includes("--check");

function log(message) {
  console.log(`[Frontend build] ${message}`);
}

const BUNDLES = Object.freeze([
  {
    type:"css",
    output:"ptb-category-avatar-patches.css",
    id:"",
    files:[
      "category-position-fix-v1.css",
      "category-chooser-card-v1.css",
      "shared-footer-v1.css",
      "avatar-fix-v2.css",
      "avatar-system-v1.css"
    ]
  },
  {
    type:"css",
    output:"ptb-ui-wheel-patches.css",
    id:"pbw1WheelFxStyles",
    files:[
      "ui-fixes-v3.css",
      "lobby-polish-v1.css",
      "letter-wheel-fx-v1.css"
    ]
  },
  {
    type:"css",
    output:"ptb-late-patches.css",
    id:"",
    files:[
      "category-prototype.css",
      "private-lobby.css",
      "avatar-pages-fix-v1.css"
    ]
  },
  {
    type:"js",
    output:"ptb-core-client.js",
    files:[
      "avatar-system-v1.js",
      "inventory-client.js",
      "progression-client.js",
      "icon-theme-v1.js"
    ]
  },
  {
    type:"js",
    output:"ptb-ui-patches.js",
    files:[
      "ui-fixes-v3.js",
      "lobby-polish-v1.js"
    ]
  },
  {
    type:"js",
    output:"ptb-late-client.js",
    files:[
      "wallet-client.js",
      "avatar-pages-fix-v1.js"
    ]
  }
]);

function buildVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    return String(pkg?.version || "1.45.0");
  } catch {
    return "1.45.0";
  }
}

function htmlAssetPath(tag, type) {
  const attribute = type === "css" ? "href" : "src";
  const match = tag.match(
    new RegExp(`${attribute}=["']([^"']+)["']`, "i")
  );
  if (!match) return "";
  return String(match[1]).split("?")[0].replace(/^\/+/, "");
}

function findAssetTags(html, type) {
  const pattern = type === "css"
    ? /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi
    : /<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi;

  const tags = [];
  let match;
  while ((match = pattern.exec(html))) {
    const assetPath = htmlAssetPath(match[0], type);
    if (!assetPath) continue;
    tags.push({
      start: match.index,
      end: match.index + match[0].length,
      tag: match[0],
      path: assetPath
    });
  }
  return tags;
}

function concatenate(config) {
  const chunks = [];

  for (const file of config.files) {
    const filePath = path.join(root, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`${config.output}: ${file} absent.`);
    }

    const content = fs.readFileSync(filePath, "utf8");
    chunks.push(
      config.type === "css"
        ? `/* ===== ${file} ===== */\n${content.trim()}\n`
        : `/* ===== ${file} ===== */\n${content.trim()}\n;\n`
    );
  }

  const content = chunks.join("\n");

  if (config.type === "js") {
    // Validation syntaxique uniquement.
    new Function(content);
  }

  return content;
}

function bundleTag(config, version) {
  const url = `/${config.output}?v=${encodeURIComponent(version)}`;

  if (config.type === "css") {
    const id = config.id ? ` id="${config.id}"` : "";
    return `<link${id} rel="stylesheet" href="${url}" />`;
  }

  return `<script defer src="${url}"></script>`;
}

function replaceGroup(html, config, version) {
  const tags = findAssetTags(html, config.type);
  const selected = [];

  for (const file of config.files) {
    const matches = tags.filter(entry => entry.path === file);
    if (matches.length !== 1) {
      throw new Error(
        `${config.output}: ${file} doit apparaître exactement une fois dans index.html.`
      );
    }
    selected.push(matches[0]);
  }

  for (let i = 1; i < selected.length; i += 1) {
    if (selected[i].start <= selected[i - 1].start) {
      throw new Error(`${config.output}: ordre inattendu dans index.html.`);
    }
  }

  const selectedPaths = new Set(selected.map(entry => entry.path));
  const interleaved = tags.filter(entry =>
    entry.start >= selected[0].start &&
    entry.end <= selected[selected.length - 1].end &&
    !selectedPaths.has(entry.path)
  );

  if (interleaved.length) {
    throw new Error(
      `${config.output}: fichiers intercalés: ` +
      interleaved.map(entry => entry.path).join(", ")
    );
  }

  const replacement = bundleTag(config, version);
  let next = html;

  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const item = selected[i];
    next =
      next.slice(0, item.start) +
      (i === 0 ? replacement : "") +
      next.slice(item.end);
  }

  return next;
}

function loadPublicFiles() {
  if (!fs.existsSync(publicFilesPath)) {
    throw new Error("public-files.json absent.");
  }

  const list = JSON.parse(fs.readFileSync(publicFilesPath, "utf8"));
  if (!Array.isArray(list)) {
    throw new Error("public-files.json doit contenir un tableau.");
  }

  return list;
}

function buildFrontend() {
  if (!fs.existsSync(indexPath)) {
    throw new Error("index.html absent.");
  }

  const originalHtml = fs.readFileSync(indexPath, "utf8");
  const originalPublicFiles = loadPublicFiles();
  const version = buildVersion();

  let html = originalHtml;
  const publicFiles = [...originalPublicFiles];
  const generated = [];

  for (const config of BUNDLES) {
    const content = concatenate(config);
    html = replaceGroup(html, config, version);

    const route = `/${config.output}`;
    if (!publicFiles.includes(route)) publicFiles.push(route);

    generated.push({
      name: config.output,
      content,
      sourceCount: config.files.length
    });
  }

  const beforeRequests =
    findAssetTags(originalHtml, "css").length +
    findAssetTags(originalHtml, "js").length;

  const afterRequests =
    findAssetTags(html, "css").length +
    findAssetTags(html, "js").length;

  if (CHECK_ONLY) {
    log(
      `validation OK : ${generated.length} bundles, ` +
      `${beforeRequests} -> ${afterRequests} requêtes CSS/JS.`
    );
    return;
  }

  for (const file of generated) {
    fs.writeFileSync(
      path.join(root, file.name),
      file.content,
      "utf8"
    );
  }

  fs.writeFileSync(indexPath, html, "utf8");
  fs.writeFileSync(
    publicFilesPath,
    JSON.stringify(publicFiles, null, 2) + "\n",
    "utf8"
  );

  log(
    `${generated.length} bundles générés : ` +
    `${beforeRequests} -> ${afterRequests} requêtes CSS/JS.`
  );

  for (const file of generated) {
    log(`${file.name}: ${file.sourceCount} -> 1`);
  }
}

try {
  buildFrontend();
} catch (error) {
  console.error(
    "[Frontend build] ERREUR:",
    error?.stack || error?.message || error
  );
  process.exitCode = 1;
}
