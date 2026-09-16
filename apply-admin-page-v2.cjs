#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = process.cwd();

function filePath(name) { return path.join(ROOT, name); }
function read(name) { return fs.readFileSync(filePath(name), "utf8"); }
function write(name, value) { fs.writeFileSync(filePath(name), value, "utf8"); }
function assertFile(name) {
  if (!fs.existsSync(filePath(name))) throw new Error(`Fichier introuvable : ${name}`);
}
function replaceOne(source, search, replacement, label) {
  const parts = source.split(search);
  if (parts.length !== 2) throw new Error(`${label}: marqueur attendu exactement une fois.`);
  return parts[0] + replacement + parts[1];
}
function replaceRegexOne(source, regex, replacement, label) {
  const matches = source.match(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g")) || [];
  if (matches.length !== 1) throw new Error(`${label}: bloc attendu exactement une fois, trouvé ${matches.length}.`);
  return source.replace(regex, replacement);
}

const files = [
  "admin-v1.js",
  "admin-v1.css",
  "admin-hook.js",
  "db-migrations.js",
  "db-migrations.test.cjs"
];
files.forEach(assertFile);

function patchAdminClient() {
  const name = "admin-v1.js";
  let s = read(name);

  if (!s.includes('itemTypeFilter:"all"')) {
    s = replaceOne(
      s,
      '    itemCatalog:[],\n',
      '    itemCatalog:[],\n    itemTypeFilter:"all",\n',
      "admin-v1 state"
    );
  }

  if (!s.includes('document.querySelectorAll(".admin-v1-crown-btn").forEach(button => button.remove())')) {
    const refreshMarker = `    state.infiniteLives = !!response.infiniteLives;\n\n    decorate();\n`;
    const refreshReplacement = `    state.infiniteLives = !!response.infiniteLives;\n\n    if (!state.admin) {\n      document.querySelectorAll(".admin-v1-crown-btn").forEach(button => button.remove());\n    }\n\n    decorate();\n`;
    s = replaceOne(s, refreshMarker, refreshReplacement, "masquage bouton admin");
  }

  if (!s.includes('state.admin &&\n      root &&')) {
    const decorateMarker = `    if (\n      root &&\n      !root.querySelector(".admin-v1-crown-btn")\n    ) {`;
    const decorateReplacement = `    if (\n      state.admin &&\n      root &&\n      !root.querySelector(".admin-v1-crown-btn")\n    ) {`;
    s = replaceOne(s, decorateMarker, decorateReplacement, "bouton admin réservé");
  }

  const shell = `  function shell() {
    return \`
      <header class="admin-page-v2-head">
        <button
          class="admin-page-v2-back"
          type="button"
          aria-label="Retour"
        >←</button>

        <div class="admin-page-v2-brand">
          <img src="/admin-crown.png" alt="">
          <div>
            <small>ESPACE PRIVÉ</small>
            <h1>Administration</h1>
            <p>Gestion et modération de P’tit Bac.</p>
          </div>
        </div>
      </header>

      <nav class="admin-v4-main-tabs admin-page-v2-tabs" aria-label="Menu administrateur">
        <button data-admin-tab="tools" class="\${state.activeTab === "tools" ? "active" : ""}">
          \${icon("tools")}
          <span>Outils</span>
        </button>

        <button data-admin-tab="reports" class="\${state.activeTab === "reports" ? "active" : ""}">
          \${icon("reports")}
          <span>Reports</span>
        </button>

        <button data-admin-tab="players" class="\${state.activeTab === "players" ? "active" : ""}">
          \${icon("users")}
          <span>Joueurs</span>
        </button>

        <button data-admin-tab="messages" class="\${state.activeTab === "messages" ? "active" : ""}">
          \${icon("messages")}
          <span>Messages</span>
        </button>

        <button data-admin-tab="items" class="\${state.activeTab === "items" ? "active" : ""}">
          \${icon("gift")}
          <span>Items</span>
        </button>
      </nav>

      <main id="adminV4Body" class="admin-v4-body admin-page-v2-body"></main>
    \`;
  }

`;

  s = replaceRegexOne(
    s,
    /  function shell\(\) \{[\s\S]*?\n  \}\n\n(?=  async function refreshAdmin)/,
    shell,
    "admin shell"
  );

  const menu = `  async function adminMenu(initialTab = "tools") {
    if (!state.admin) {
      const result = await refreshAdmin();

      if (!result?.admin) {
        return adminActivationModal();
      }
    }

    state.activeTab = initialTab;

    document.querySelector(".admin-page-v2")?.remove();

    const page = document.createElement("section");
    page.className = "admin-page-v2";
    page.innerHTML = shell();
    document.body.appendChild(page);
    document.body.classList.add("admin-page-v2-open");

    const closePage = () => {
      page.remove();
      document.body.classList.remove("admin-page-v2-open");
    };

    page
      .querySelector(".admin-page-v2-back")
      ?.addEventListener("click",closePage);

    page
      .querySelectorAll("[data-admin-tab]")
      .forEach(button => {
        button.addEventListener("click",() => {
          state.activeTab = button.dataset.adminTab;

          page
            .querySelectorAll("[data-admin-tab]")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });

          renderActiveTab(page);
        });
      });

    await renderActiveTab(page);
  }

`;

  s = replaceRegexOne(
    s,
    /  async function adminMenu\(initialTab = "tools"\) \{[\s\S]*?\n  \}\n\n(?=  async function renderActiveTab)/,
    menu,
    "adminMenu"
  );

  if (!s.includes('return renderItemsTab(overlay);')) {
    const routeNeedle = `    if (state.activeTab === "messages") {
      return renderMessagesTab(overlay);
    }

    return renderToolsTab(overlay);
`;
    const routeReplacement = `    if (state.activeTab === "messages") {
      return renderMessagesTab(overlay);
    }

    if (state.activeTab === "items") {
      return renderItemsTab(overlay);
    }

    return renderToolsTab(overlay);
`;
    s = replaceOne(s, routeNeedle, routeReplacement, "route Items");
  }

  if (!s.includes("async function renderItemsTab")) {
    const marker = `  async function renderToolsTab(overlay) {
`;
    const itemsRenderer = `  const ITEM_RARITY_LABELS = Object.freeze({
    commun:"Commun",
    rare:"Rare",
    epique:"Épique",
    ultra:"Ultra",
    exclusif:"Exclusif"
  });

  const ITEM_RARITY_HELP = Object.freeze({
    commun:"Boutique · Coffres (à venir)",
    rare:"Boutique · Coffres, avec une chance plus faible",
    epique:"Boutique · Coffres très rares",
    ultra:"Boutique · Coffres extrêmement rares",
    exclusif:"Boutique · Niveaux · Voie des trophées · Jamais dans les coffres"
  });

  function adminItemTypeLabel(type) {
    if (type === "avatar") return "Avatar";
    if (type === "frame") return "Cadre";
    if (type === "tag") return "Titre";
    return "Item";
  }

  function rarityOptions(selected) {
    return Object.entries(ITEM_RARITY_LABELS)
      .map(([key,label]) => \`
        <option value="\${key}" \${selected === key ? "selected" : ""}>
          \${label}
        </option>
      \`)
      .join("");
  }

  async function renderItemsTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    body.innerHTML = \`
      <section class="admin-v4-card admin-items-intro">
        <div>
          <small>CATALOGUE DU JEU</small>
          <h3>Gestion des items</h3>
          <p>
            Les items sont ajoutés au jeu par code. Ici tu règles leur rareté,
            leur prix et leur monnaie. La boutique sera gérée séparément plus tard.
          </p>
        </div>
      </section>

      <div class="admin-v1-empty">Chargement du catalogue…</div>
    \`;

    const catalog = await emit("admin:itemCatalog");

    if (!catalog.ok) {
      body.innerHTML = \`
        <div class="admin-v1-empty">
          \${esc(catalog.error || "Catalogue indisponible.")}
        </div>
      \`;
      return;
    }

    state.itemCatalog = catalog.items || [];

    const render = () => {
      const filtered = state.itemCatalog.filter(item =>
        state.itemTypeFilter === "all" ||
        item.type === state.itemTypeFilter
      );

      body.innerHTML = \`
        <section class="admin-v4-card admin-items-intro">
          <div>
            <small>CATALOGUE DU JEU</small>
            <h3>Gestion des items</h3>
            <p>
              Modifie les paramètres des avatars, cadres et titres existants.
              Aucun bouton n’ajoute directement un item à la boutique.
            </p>
          </div>

          <div id="admItemTypeFilter" class="admin-items-filter">
            <button data-item-filter="all" type="button">Tous</button>
            <button data-item-filter="avatar" type="button">Avatars</button>
            <button data-item-filter="frame" type="button">Cadres</button>
            <button data-item-filter="tag" type="button">Titres</button>
          </div>
        </section>

        <section class="admin-v4-card admin-rarity-guide">
          <h3>Raretés</h3>
          <div class="admin-rarity-guide-grid">
            <span class="rarity-common"><b>Commun</b><small>Boutique · Coffres</small></span>
            <span class="rarity-rare"><b>Rare</b><small>Boutique · Coffres plus rares</small></span>
            <span class="rarity-epic"><b>Épique</b><small>Boutique · Coffres très rares</small></span>
            <span class="rarity-ultra"><b>Ultra</b><small>Boutique · Coffres super rares</small></span>
            <span class="rarity-exclusive"><b>Exclusif</b><small>Boutique · Niveaux · Trophées · Pas de coffre</small></span>
          </div>
        </section>

        <section class="admin-items-list">
          \${
            filtered.length
              ? filtered.map(item => {
                  const rarity = ITEM_RARITY_LABELS[item.rarity]
                    ? item.rarity
                    : "commun";

                  return \`
                    <article
                      class="admin-item-card"
                      data-admin-item-key="\${esc(item.key)}"
                      data-rarity="\${esc(rarity)}"
                    >
                      <header class="admin-item-card-head">
                        <div class="admin-item-card-icon">\${esc(item.icon || "🎁")}</div>
                        <div class="admin-item-card-copy">
                          <b>\${esc(item.label)}</b>
                          <small>\${esc(adminItemTypeLabel(item.type))} · \${esc(item.key)}</small>
                        </div>
                        <span class="admin-item-rarity" data-item-rarity-label>
                          \${esc(ITEM_RARITY_LABELS[rarity])}
                        </span>
                      </header>

                      <div class="admin-item-fields">
                        <label>
                          <span>Rareté</span>
                          <select data-item-rarity>
                            \${rarityOptions(rarity)}
                          </select>
                        </label>

                        <label>
                          <span>Prix</span>
                          <input
                            data-item-price
                            type="number"
                            inputmode="numeric"
                            min="0"
                            max="999999"
                            value="\${Number(item.price || 0)}"
                          >
                        </label>

                        <label>
                          <span>Monnaie</span>
                          <select data-item-currency>
                            <option value="coins" \${item.currency === "gems" ? "" : "selected"}>🪙 Pièces</option>
                            <option value="gems" \${item.currency === "gems" ? "selected" : ""}>💎 Gemmes</option>
                          </select>
                        </label>
                      </div>

                      <div class="admin-item-acquisition" data-item-acquisition>
                        \${esc(ITEM_RARITY_HELP[rarity])}
                      </div>

                      <button
                        data-item-save
                        class="admin-v1-primary admin-item-save"
                        type="button"
                      >Enregistrer</button>
                    </article>
                  \`;
                }).join("")
              : \`<div class="admin-v1-empty">Aucun item dans cette catégorie.</div>\`
          }
        </section>
      \`;

      body
        .querySelectorAll("[data-item-filter]")
        .forEach(button => {
          button.classList.toggle(
            "active",
            button.dataset.itemFilter === state.itemTypeFilter
          );

          button.addEventListener("click",() => {
            state.itemTypeFilter = button.dataset.itemFilter;
            render();
          });
        });

      body
        .querySelectorAll("[data-admin-item-key]")
        .forEach(card => {
          const rarityField = card.querySelector("[data-item-rarity]");
          const acquisition = card.querySelector("[data-item-acquisition]");
          const rarityLabel = card.querySelector("[data-item-rarity-label]");

          rarityField?.addEventListener("change",() => {
            const rarity = rarityField.value;
            card.dataset.rarity = rarity;

            if (acquisition) {
              acquisition.textContent =
                ITEM_RARITY_HELP[rarity] ||
                ITEM_RARITY_HELP.commun;
            }

            if (rarityLabel) {
              rarityLabel.textContent =
                ITEM_RARITY_LABELS[rarity] ||
                ITEM_RARITY_LABELS.commun;
            }
          });

          card
            .querySelector("[data-item-save]")
            ?.addEventListener("click",async event => {
              const button = event.currentTarget;
              const itemKey = card.dataset.adminItemKey;
              const rarity = rarityField?.value || "commun";
              const price = Number(
                card.querySelector("[data-item-price]")?.value || 0
              );
              const currency =
                card.querySelector("[data-item-currency]")?.value || "coins";

              if (!Number.isFinite(price) || price < 0 || price > 999999) {
                return toast("Prix invalide.");
              }

              button.disabled = true;
              button.textContent = "Enregistrement…";

              const response = await emit(
                "admin:itemConfigUpdate",
                { itemKey,rarity,price,currency }
              );

              button.disabled = false;
              button.textContent = "Enregistrer";

              if (!response.ok || !response.item) {
                return toast(
                  response.error ||
                  "Configuration impossible."
                );
              }

              const index = state.itemCatalog.findIndex(
                item => item.key === response.item.key
              );

              if (index >= 0) {
                state.itemCatalog[index] = response.item;
              }

              toast(\`\${response.item.label} enregistré.\`);
              render();
            });
        });
    };

    render();
  }

`;

    s = replaceOne(s, marker, itemsRenderer + marker, "renderItemsTab");
  }

  write(name, s);
}

function patchAdminCss() {
  const name = "admin-v1.css";
  let s = read(name);
  if (s.includes("/* Admin page V2 — plein écran */")) return;

  s += `

/* =========================================================
   Admin page V2 — plein écran
   Le menu principal n'est plus une fenêtre modale.
   ========================================================= */

body.admin-page-v2-open {
  overflow:hidden!important;
}

.admin-page-v2 {
  position:fixed;
  inset:0;
  z-index:9998;
  overflow-y:auto;
  overscroll-behavior:contain;
  padding:
    max(10px,env(safe-area-inset-top))
    0
    max(24px,env(safe-area-inset-bottom));
  background:
    radial-gradient(circle at 8% -3%,rgba(113,52,232,.30),transparent 30%),
    radial-gradient(circle at 96% 22%,rgba(45,85,210,.18),transparent 31%),
    linear-gradient(165deg,#0b1647 0%,#071039 52%,#110b3f 100%);
  color:#fff;
  font-family:"DM Sans",system-ui,sans-serif;
  scrollbar-width:none;
}

.admin-page-v2::-webkit-scrollbar {
  display:none;
}

.admin-page-v2 *,
.admin-page-v2 *::before,
.admin-page-v2 *::after {
  box-sizing:border-box;
}

.admin-page-v2 button,
.admin-page-v2 input,
.admin-page-v2 textarea,
.admin-page-v2 select {
  font:inherit;
}

.admin-page-v2-head {
  width:min(100%,720px);
  margin:0 auto;
  padding:9px 16px 12px;
  display:grid;
  grid-template-columns:40px minmax(0,1fr);
  align-items:center;
  gap:10px;
}

.admin-page-v2-back {
  width:40px;
  height:40px;
  padding:0;
  border:0;
  background:transparent;
  color:#b96cff;
  font-size:31px;
  line-height:1;
  display:grid;
  place-items:center;
  filter:drop-shadow(0 0 7px rgba(179,85,255,.38));
}

.admin-page-v2-brand {
  min-width:0;
  display:grid;
  grid-template-columns:50px minmax(0,1fr);
  align-items:center;
  gap:10px;
}

.admin-page-v2-brand > img {
  width:50px;
  height:50px;
  object-fit:contain;
  filter:drop-shadow(0 0 10px rgba(177,64,255,.46));
}

.admin-page-v2-brand small {
  display:block;
  color:#bca2f1;
  font-size:.56rem;
  font-weight:900;
  letter-spacing:.17em;
}

.admin-page-v2-brand h1 {
  margin:2px 0 0;
  font-size:1.48rem;
  line-height:1;
  letter-spacing:-.035em;
}

.admin-page-v2-brand p {
  margin:5px 0 0;
  color:#9894ba;
  font-size:.64rem;
}

.admin-page-v2-tabs {
  position:sticky;
  top:0;
  z-index:6;
  width:min(calc(100% - 24px),696px);
  margin:0 auto 13px!important;
  padding:7px;
  grid-template-columns:repeat(5,minmax(0,1fr))!important;
  gap:5px!important;
  border:1px solid rgba(102,80,190,.40);
  border-radius:18px;
  background:rgba(7,16,57,.88);
  -webkit-backdrop-filter:blur(13px);
  backdrop-filter:blur(13px);
  box-shadow:0 13px 30px rgba(0,0,0,.18);
}

.admin-page-v2-tabs button {
  min-height:49px!important;
  padding:5px 3px!important;
  border:0!important;
  border-radius:12px!important;
  background:transparent!important;
  display:flex!important;
  flex-direction:column;
  gap:2px!important;
  color:#9e98be!important;
  font-size:.54rem!important;
}

.admin-page-v2-tabs button .admin-v4-icon {
  width:20px;
  height:20px;
  flex-basis:20px;
}

.admin-page-v2-tabs button.active {
  color:#fff!important;
  background:linear-gradient(135deg,#6e34ee,#b23df4)!important;
  box-shadow:0 0 15px rgba(160,55,255,.30)!important;
}

.admin-page-v2-body {
  width:min(calc(100% - 24px),696px);
  margin:0 auto;
  padding:0 0 22px;
}

.admin-page-v2 .admin-v4-card {
  border-color:rgba(77,93,169,.70);
  border-radius:19px;
  background:
    linear-gradient(145deg,rgba(17,37,91,.94),rgba(8,25,69,.94));
  box-shadow:0 10px 25px rgba(1,4,25,.14);
}

.admin-page-v2 .admin-v1-primary {
  min-height:46px;
  border-radius:13px;
}

.admin-items-intro > div > small {
  display:block;
  margin-bottom:5px;
  color:#a77cff;
  font-size:.54rem;
  font-weight:900;
  letter-spacing:.14em;
}

.admin-items-intro h3 {
  margin:0!important;
  font-size:1.05rem!important;
}

.admin-items-intro p {
  margin:7px 0 0;
  color:#a7a0c6;
  font-size:.64rem;
  line-height:1.45;
}

.admin-items-filter {
  margin-top:12px;
  padding:3px;
  border:1px solid #3e559b;
  border-radius:13px;
  background:#071846;
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:3px;
}

.admin-items-filter button {
  min-height:35px;
  padding:4px;
  border:0;
  border-radius:10px;
  background:transparent;
  color:#a39cc1;
  font-size:.60rem;
  font-weight:900;
}

.admin-items-filter button.active {
  background:linear-gradient(100deg,#6933e8,#a83bed);
  color:#fff;
}

.admin-rarity-guide h3 {
  margin-bottom:10px!important;
}

.admin-rarity-guide-grid {
  display:grid;
  gap:6px;
}

.admin-rarity-guide-grid > span {
  min-height:34px;
  padding:7px 9px;
  border:1px solid #31498a;
  border-radius:10px;
  background:#081b4c;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}

.admin-rarity-guide-grid b {
  font-size:.64rem;
}

.admin-rarity-guide-grid small {
  color:#8e88aa;
  font-size:.54rem;
  text-align:right;
}

.admin-rarity-guide-grid .rarity-common b { color:#e0e1eb; }
.admin-rarity-guide-grid .rarity-rare b { color:#62c5ff; }
.admin-rarity-guide-grid .rarity-epic b { color:#c975ff; }
.admin-rarity-guide-grid .rarity-ultra b { color:#ffd052; }
.admin-rarity-guide-grid .rarity-exclusive b { color:#ff82c2; }

.admin-items-list {
  display:grid;
  gap:10px;
}

.admin-item-card {
  padding:14px;
  border:1px solid #3c569a;
  border-radius:18px;
  background:
    radial-gradient(circle at 0 0,rgba(115,64,238,.11),transparent 33%),
    #091e54;
}

.admin-item-card-head {
  display:grid;
  grid-template-columns:42px minmax(0,1fr) auto;
  align-items:center;
  gap:9px;
}

.admin-item-card-icon {
  width:42px;
  height:42px;
  border:1px solid #7250cb;
  border-radius:12px;
  background:#171c57;
  display:grid;
  place-items:center;
  font-size:22px;
}

.admin-item-card-copy {
  min-width:0;
}

.admin-item-card-copy b {
  display:block;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:.78rem;
}

.admin-item-card-copy small {
  display:block;
  margin-top:3px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:#7f7a9f;
  font-size:.49rem;
}

.admin-item-rarity {
  padding:5px 8px;
  border:1px solid #7256c3;
  border-radius:999px;
  background:#171b51;
  color:#d9ceff;
  font-size:.51rem;
  font-weight:900;
}

.admin-item-card[data-rarity="rare"] .admin-item-rarity { color:#65c8ff; border-color:#408dcc; }
.admin-item-card[data-rarity="epique"] .admin-item-rarity { color:#cc78ff; border-color:#8a48cb; }
.admin-item-card[data-rarity="ultra"] .admin-item-rarity { color:#ffd35b; border-color:#bc8c25; }
.admin-item-card[data-rarity="exclusif"] .admin-item-rarity { color:#ff87c7; border-color:#b14b8a; }

.admin-item-fields {
  margin-top:12px;
  display:grid;
  grid-template-columns:1.1fr .8fr 1fr;
  gap:7px;
}

.admin-item-fields label {
  min-width:0;
  color:#a79fc5;
  font-size:.55rem;
  font-weight:800;
}

.admin-item-fields label > span {
  display:block;
  margin:0 0 5px 2px;
}

.admin-item-fields input,
.admin-item-fields select {
  width:100%;
  min-height:40px;
  padding:0 9px;
  border:1px solid #435b9f;
  border-radius:11px;
  outline:0;
  background:#071846;
  color:#fff;
  font-size:.64rem;
}

.admin-item-fields input:focus,
.admin-item-fields select:focus {
  border-color:#9e55ff;
  box-shadow:0 0 0 3px rgba(154,67,255,.11);
}

.admin-item-acquisition {
  margin-top:9px;
  padding:9px 10px;
  border:1px solid #304a89;
  border-radius:11px;
  background:#071947;
  color:#9f98bd;
  font-size:.56rem;
  line-height:1.35;
}

.admin-item-save {
  margin-top:9px!important;
}

@media(max-width:430px) {
  .admin-page-v2-head {
    padding-left:12px;
    padding-right:12px;
  }

  .admin-page-v2-brand h1 {
    font-size:1.28rem;
  }

  .admin-page-v2-brand p {
    display:none;
  }

  .admin-page-v2-tabs {
    width:calc(100% - 16px);
  }

  .admin-page-v2-body {
    width:calc(100% - 16px);
  }

  .admin-page-v2-tabs button span:not(.admin-v4-icon) {
    font-size:.49rem;
  }

  .admin-item-fields {
    grid-template-columns:1fr 1fr;
  }

  .admin-item-fields label:last-child {
    grid-column:1 / -1;
  }
}
`;

  write(name, s);
}

function patchAdminHook() {
  const name = "admin-hook.js";
  let s = read(name);

  if (!s.includes("ITEM_RARITY_RULES")) {
    const marker = `const ITEM_CATALOG = Object.freeze(catalogEntries());\n`;
    const block = marker + `
const ITEM_RARITY_RULES = Object.freeze({
  commun:Object.freeze({
    label:"Commun",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Disponible dans les coffres."
  }),
  rare:Object.freeze({
    label:"Rare",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Plus rare dans les coffres."
  }),
  epique:Object.freeze({
    label:"Épique",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Très rare dans les coffres."
  }),
  ultra:Object.freeze({
    label:"Ultra",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Super rare dans les coffres."
  }),
  exclusif:Object.freeze({
    label:"Exclusif",
    sources:Object.freeze(["Boutique","Niveaux","Voie des trophées"]),
    note:"Jamais disponible dans les coffres."
  })
});

function normalizeItemRarity(value) {
  const rarity = String(value || "").trim().toLowerCase();
  return ITEM_RARITY_RULES[rarity] ? rarity : "commun";
}

function normalizeItemCurrency(value) {
  return value === "gems" ? "gems" : "coins";
}

function normalizeItemPrice(value) {
  return Math.max(0, Math.min(999999, Math.floor(Number(value) || 0)));
}

function itemAcquisition(rarity) {
  const rule = ITEM_RARITY_RULES[normalizeItemRarity(rarity)];
  return {
    sources:[...rule.sources],
    note:rule.note
  };
}

async function loadAdminItemCatalog() {
  await schema();

  const q = await pool.query(
    \`SELECT item_key,rarity,price,currency,updated_at
       FROM public.ptitbac_item_catalog_settings\`
  ).catch(() => ({ rows:[] }));

  const byKey = new Map(
    (q.rows || []).map(row => [String(row.item_key || ""), row])
  );

  return ITEM_CATALOG.map(item => {
    const saved = byKey.get(item.key) || {};
    const rarity = normalizeItemRarity(saved.rarity);

    return {
      ...item,
      rarity,
      rarityLabel:ITEM_RARITY_RULES[rarity].label,
      price:normalizeItemPrice(saved.price),
      currency:normalizeItemCurrency(saved.currency),
      acquisition:itemAcquisition(rarity),
      updatedAt:saved.updated_at || null
    };
  });
}

async function saveAdminItemConfig(adminToken, payload = {}) {
  await schema();

  const itemKey = String(payload.itemKey || "").trim();
  const item = ITEM_CATALOG.find(entry => entry.key === itemKey);

  if (!item) throw new Error("Objet invalide.");

  const rarity = normalizeItemRarity(payload.rarity);
  const price = normalizeItemPrice(payload.price);
  const currency = normalizeItemCurrency(payload.currency);

  await pool.query(
    \`INSERT INTO public.ptitbac_item_catalog_settings
       (item_key,rarity,price,currency,updated_by_wallet_token,updated_at)
     VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT(item_key) DO UPDATE SET
       rarity=EXCLUDED.rarity,
       price=EXCLUDED.price,
       currency=EXCLUDED.currency,
       updated_by_wallet_token=EXCLUDED.updated_by_wallet_token,
       updated_at=now()\`,
    [itemKey,rarity,price,currency,adminToken]
  );

  await audit(adminToken,"item_config_update",null,{
    itemKey,
    rarity,
    price,
    currency
  });

  return {
    ...item,
    rarity,
    rarityLabel:ITEM_RARITY_RULES[rarity].label,
    price,
    currency,
    acquisition:itemAcquisition(rarity)
  };
}
`;

    s = replaceOne(s, marker, block, "admin item helpers");
  }

  const handlerRegex = /    socket\.on\("admin:itemCatalog", async \(payload=\{\}, cb=\(\)=>\{\}\) => \{[\s\S]*?\n    \}\);\n/;
  const current = s.match(handlerRegex)?.[0] || "";

  if (!current) throw new Error("admin:itemCatalog introuvable.");

  if (!s.includes('socket.on("admin:itemConfigUpdate"')) {
    const replacement = `    socket.on("admin:itemCatalog", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        cb({
          ok:true,
          items:await loadAdminItemCatalog()
        });
      } catch {
        cb({
          ok:false,
          error:"Catalogue indisponible."
        });
      }
    });

    socket.on("admin:itemConfigUpdate", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const item = await saveAdminItemConfig(token,payload);

        cb({
          ok:true,
          item
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Configuration de l’objet impossible."
        });
      }
    });
`;

    s = s.replace(handlerRegex, replacement);
  }

  write(name, s);
}

function patchMigrations() {
  const name = "db-migrations.js";
  let s = read(name);
  if (s.includes("ptitbac_item_catalog_settings")) return;

  const marker = `  await pool.query(\`\n    CREATE TABLE IF NOT EXISTS public.ptitbac_feedback_reports(`;
  const block = `  // Paramètres éditables du catalogue cosmétique. Les items officiels
  // restent déclarés dans inventory-service.js.
  await pool.query(\`
    CREATE TABLE IF NOT EXISTS public.ptitbac_item_catalog_settings(
      item_key text PRIMARY KEY,
      rarity text NOT NULL DEFAULT 'commun'
        CHECK (rarity IN ('commun','rare','epique','ultra','exclusif')),
      price integer NOT NULL DEFAULT 0
        CHECK (price >= 0 AND price <= 999999),
      currency text NOT NULL DEFAULT 'coins'
        CHECK (currency IN ('coins','gems')),
      updated_by_wallet_token text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  \`);

`;

  s = replaceOne(s, marker, block + marker, "migration catalogue items");
  write(name, s);
}

function patchMigrationTests() {
  const name = "db-migrations.test.cjs";
  let s = read(name);
  if (s.includes("ptitbac_item_catalog_settings")) return;

  const marker = `  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\\.ptitbac_inventory_items/);\n`;
  const replacement = marker + `  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\\.ptitbac_item_catalog_settings/);\n  assert.match(sql, /rarity IN \\('commun','rare','epique','ultra','exclusif'\\)/);\n  assert.match(sql, /currency IN \\('coins','gems'\\)/);\n`;

  s = replaceOne(s, marker, replacement, "tests migration items");
  write(name, s);
}

function validateResult() {
  const admin = read("admin-v1.js");
  const hook = read("admin-hook.js");
  const migration = read("db-migrations.js");

  const checks = [
    [admin.includes('data-admin-tab="items"'), "onglet Items"],
    [admin.includes("async function renderItemsTab"), "page Items"],
    [admin.includes('className = "admin-page-v2"'), "page admin plein écran"],
    [hook.includes('socket.on("admin:itemConfigUpdate"'), "endpoint sauvegarde items"],
    [migration.includes("ptitbac_item_catalog_settings"), "table paramètres items"]
  ];

  const failed = checks.filter(([ok]) => !ok).map(([,label]) => label);
  if (failed.length) throw new Error(`Validation échouée : ${failed.join(", ")}`);
}

const originals = Object.fromEntries(files.map(file => [file, read(file)]));

try {
  patchAdminClient();
  patchAdminCss();
  patchAdminHook();
  patchMigrations();
  patchMigrationTests();
  validateResult();

  for (const file of ["admin-v1.js","admin-hook.js","db-migrations.js","db-migrations.test.cjs"]) {
    execFileSync(process.execPath,["--check",file],{ cwd:ROOT, stdio:"pipe" });
  }

  execFileSync(
    process.execPath,
    ["--test","db-migrations.test.cjs"],
    { cwd:ROOT, stdio:"pipe" }
  );

  console.log("✅ Admin V2 plein écran installé.");
  console.log("✅ Onglet Items installé.");
  console.log("✅ Syntaxe vérifiée + tests migrations passés.");
  console.log("Fichiers modifiés :");
  files.forEach(file => console.log(`- ${file}`));
  console.log("\nTu peux supprimer apply-admin-page-v2.cjs après exécution.");
} catch (error) {
  for (const [file,content] of Object.entries(originals)) {
    write(file,content);
  }

  console.error("❌ Installation annulée, fichiers restaurés.");
  console.error(error?.stderr?.toString?.() || error.message || error);
  process.exitCode = 1;
}
