#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(path.join(ROOT, file), content, "utf8");
}

function replaceOnce(file, source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${file}: marqueur ${label} attendu 1 fois, trouvé ${count}.`);
  }
  return source.replace(before, after);
}

function patchDbMigrations() {
  const file = "db-migrations.js";
  let source = read(file);

  const marker = `  await pool.query(\`
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_settings(
      wallet_token text PRIMARY KEY,
      infinite_coins boolean NOT NULL DEFAULT false,
      infinite_lives boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  \`);
`;

  const replacement = marker + `
  // Catalogue administrable des cosmétiques. Les items eux-mêmes restent
  // déclarés dans inventory-service.js ; cette table stocke seulement leurs
  // paramètres éditables depuis le menu admin.
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

  source = replaceOnce(file, source, marker, replacement, "table admin settings");
  write(file, source);
}

function patchDbMigrationTests() {
  const file = "db-migrations.test.cjs";
  let source = read(file);

  const marker = `  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\\.ptitbac_inventory_items/);\n`;
  const replacement = marker + `  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\\.ptitbac_item_catalog_settings/);\n  assert.match(sql, /rarity IN \\('commun','rare','epique','ultra','exclusif'\\)/);\n  assert.match(sql, /currency IN \\('coins','gems'\\)/);\n`;

  source = replaceOnce(file, source, marker, replacement, "assertions migration inventaire");
  write(file, source);
}

function patchAdminHook() {
  const file = "admin-hook.js";
  let source = read(file);

  const catalogMarker = `const ITEM_CATALOG = Object.freeze(catalogEntries());\n`;
  const catalogReplacement = catalogMarker + `
const ITEM_RARITY_RULES = Object.freeze({
  commun:Object.freeze({
    key:"commun",
    label:"Commun",
    acquisition:Object.freeze(["Boutique","Coffres (à venir)"]),
    chestNote:"Disponible dans les coffres."
  }),
  rare:Object.freeze({
    key:"rare",
    label:"Rare",
    acquisition:Object.freeze(["Boutique","Coffres (à venir)"]),
    chestNote:"Plus rare dans les coffres."
  }),
  epique:Object.freeze({
    key:"epique",
    label:"Épique",
    acquisition:Object.freeze(["Boutique","Coffres (à venir)"]),
    chestNote:"Très rare dans les coffres."
  }),
  ultra:Object.freeze({
    key:"ultra",
    label:"Ultra",
    acquisition:Object.freeze(["Boutique","Coffres (à venir)"]),
    chestNote:"Super rare dans les coffres."
  }),
  exclusif:Object.freeze({
    key:"exclusif",
    label:"Exclusif",
    acquisition:Object.freeze(["Boutique","Niveaux","Voie des trophées"]),
    chestNote:"Jamais disponible dans les coffres."
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
    sources:[...rule.acquisition],
    note:rule.chestNote
  };
}

async function loadAdminItemCatalog() {
  await schema();

  const settings = await pool.query(
    \`SELECT item_key,rarity,price,currency,updated_at
       FROM public.ptitbac_item_catalog_settings\`
  ).catch(() => ({ rows:[] }));

  const byKey = new Map(
    (settings.rows || []).map(row => [String(row.item_key || ""), row])
  );

  return ITEM_CATALOG.map(item => {
    const saved = byKey.get(item.key) || {};
    const rarity = normalizeItemRarity(saved.rarity);
    const rule = ITEM_RARITY_RULES[rarity];

    return {
      ...item,
      rarity,
      rarityLabel:rule.label,
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

  if (!item) {
    throw new Error("Objet invalide.");
  }

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

  await audit(adminToken, "item_config_update", null, {
    itemKey,
    rarity,
    price,
    currency
  });

  const rule = ITEM_RARITY_RULES[rarity];

  return {
    ...item,
    rarity,
    rarityLabel:rule.label,
    price,
    currency,
    acquisition:itemAcquisition(rarity)
  };
}
`;

  source = replaceOnce(file, source, catalogMarker, catalogReplacement, "catalogue inventaire");

  const oldCatalogHandler = `    socket.on("admin:itemCatalog", async (payload={}, cb=()=>{}) => {
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
          items:ITEM_CATALOG
        });
      } catch {
        cb({
          ok:false,
          error:"Catalogue indisponible."
        });
      }
    });
`;

  const newCatalogHandler = `    socket.on("admin:itemCatalog", async (payload={}, cb=()=>{}) => {
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

        const item = await saveAdminItemConfig(token, payload);

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

  source = replaceOnce(file, source, oldCatalogHandler, newCatalogHandler, "handler admin:itemCatalog");
  write(file, source);
}

function patchAdminClient() {
  const file = "admin-v1.js";
  let source = read(file);

  source = replaceOnce(
    file,
    source,
    `    reportFilter:"all",\n    itemCatalog:[],\n`,
    `    reportFilter:"all",\n    itemCatalog:[],\n    itemTypeFilter:"all",\n`,
    "état itemTypeFilter"
  );

  source = replaceOnce(
    file,
    source,
    `<nav class="admin-v4-main-tabs" aria-label="Menu administrateur">`,
    `<nav class="admin-v4-main-tabs" aria-label="Menu administrateur" style="grid-template-columns:repeat(5,minmax(0,1fr))">`,
    "grille onglets admin"
  );

  const messagesTab = `        <button data-admin-tab="messages" class="\${state.activeTab === "messages" ? "active" : ""}">
          \${icon("messages")}
          <span>Messages</span>
        </button>
`;

  const messagesAndItems = messagesTab + `
        <button data-admin-tab="items" class="\${state.activeTab === "items" ? "active" : ""}">
          \${icon("gift")}
          <span>Items</span>
        </button>
`;

  source = replaceOnce(file, source, messagesTab, messagesAndItems, "onglet Items");

  const routeMarker = `    if (state.activeTab === "messages") {
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

  source = replaceOnce(file, source, routeMarker, routeReplacement, "route Items");

  const toolsMarker = `  async function renderToolsTab(overlay) {\n`;

  const itemsPage = `  const ITEM_RARITY_LABELS = Object.freeze({
    commun:"Commun",
    rare:"Rare",
    epique:"Épique",
    ultra:"Ultra",
    exclusif:"Exclusif"
  });

  const ITEM_RARITY_HELP = Object.freeze({
    commun:"Boutique • Coffres (à venir)",
    rare:"Boutique • Coffres rares (à venir)",
    epique:"Boutique • Coffres très rares (à venir)",
    ultra:"Boutique • Coffres super rares (à venir)",
    exclusif:"Boutique • Niveaux • Voie des trophées • Jamais dans les coffres"
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
      <section class="admin-v4-card">
        <h3>\${icon("gift")}<span>Gestion des items</span></h3>
        <p style="margin:0;color:#aaa0cc;font-size:.64rem;line-height:1.45">
          Les items sont ajoutés au jeu par code. Ici tu gères leur rareté,
          leur prix et la monnaie utilisée.
        </p>
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
        <section class="admin-v4-card">
          <h3>\${icon("gift")}<span>Gestion des items</span></h3>
          <p style="margin:0 0 12px;color:#aaa0cc;font-size:.64rem;line-height:1.45">
            Les items sont ajoutés au jeu par code. Ici tu gères leur rareté,
            leur prix et la monnaie utilisée. Aucun item n’est ajouté
            automatiquement à la boutique depuis cette page.
          </p>

          <div id="admItemTypeFilter" class="admin-v4-segment" style="grid-template-columns:repeat(4,minmax(0,1fr))">
            <button data-item-filter="all" type="button">Tous</button>
            <button data-item-filter="avatar" type="button">Avatars</button>
            <button data-item-filter="frame" type="button">Cadres</button>
            <button data-item-filter="tag" type="button">Titres</button>
          </div>
        </section>

        <section class="admin-v4-card">
          <h3><span>Raretés</span></h3>
          <div style="display:grid;gap:7px">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:.61rem"><b style="color:#d9d9e7">Commun</b><span style="color:#928aaa;text-align:right">Boutique • Coffres</span></div>
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:.61rem"><b style="color:#5fc4ff">Rare</b><span style="color:#928aaa;text-align:right">Boutique • Coffres plus rares</span></div>
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:.61rem"><b style="color:#bf6dff">Épique</b><span style="color:#928aaa;text-align:right">Boutique • Coffres très rares</span></div>
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:.61rem"><b style="color:#ffcf4c">Ultra</b><span style="color:#928aaa;text-align:right">Boutique • Coffres super rares</span></div>
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:.61rem"><b style="color:#ff7bbf">Exclusif</b><span style="color:#928aaa;text-align:right">Boutique • Niveaux • Trophées • Pas de coffre</span></div>
          </div>
        </section>

        <div id="admItemCatalogList" style="display:grid;gap:10px">
          \${
            filtered.length
              ? filtered.map(item => {
                  const rarity = ITEM_RARITY_LABELS[item.rarity]
                    ? item.rarity
                    : "commun";

                  return \`
                    <article class="admin-v4-card" data-admin-item-key="\${esc(item.key)}">
                      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px">
                        <div style="min-width:0">
                          <b style="display:block;font-size:.80rem">\${esc(item.icon || "🎁")} \${esc(item.label)}</b>
                          <small style="display:block;margin-top:3px;color:#827b9e;font-size:.53rem;word-break:break-all">\${esc(adminItemTypeLabel(item.type))} • \${esc(item.key)}</small>
                        </div>
                        <span data-item-rarity-label style="flex:none;padding:5px 8px;border:1px solid #6e55c4;border-radius:999px;background:#161d53;color:#d9ccff;font-size:.52rem;font-weight:900">\${esc(ITEM_RARITY_LABELS[rarity])}</span>
                      </div>

                      <div class="admin-v1-fields">
                        <label>
                          Rareté
                          <select data-item-rarity style="width:100%;min-height:44px;margin-top:6px;padding:0 10px;border:1px solid #4b62af;border-radius:13px;background:#071a4b;color:#fff">
                            \${rarityOptions(rarity)}
                          </select>
                        </label>
                        <label>
                          Prix
                          <input data-item-price type="number" inputmode="numeric" min="0" max="999999" value="\${Number(item.price || 0)}">
                        </label>
                      </div>

                      <label style="display:block;margin-top:9px;color:#aaa0cc;font-size:.59rem;font-weight:800">
                        Monnaie
                        <select data-item-currency style="width:100%;min-height:44px;margin-top:6px;padding:0 10px;border:1px solid #4b62af;border-radius:13px;background:#071a4b;color:#fff">
                          <option value="coins" \${item.currency === "gems" ? "" : "selected"}>🪙 Pièces</option>
                          <option value="gems" \${item.currency === "gems" ? "selected" : ""}>💎 Gemmes</option>
                        </select>
                      </label>

                      <div data-item-acquisition style="margin-top:9px;padding:9px 10px;border:1px solid #324d8f;border-radius:12px;background:#091c4a;color:#aaa2c8;font-size:.57rem;line-height:1.35">\${esc(ITEM_RARITY_HELP[rarity])}</div>

                      <button data-item-save class="admin-v1-primary" type="button">Enregistrer</button>
                    </article>
                  \`;
                }).join("")
              : \`<div class="admin-v1-empty">Aucun item dans cette catégorie.</div>\`
          }
        </div>
      \`;

      body.querySelectorAll("[data-item-filter]").forEach(button => {
        button.classList.toggle("active", button.dataset.itemFilter === state.itemTypeFilter);
        button.addEventListener("click",() => {
          state.itemTypeFilter = button.dataset.itemFilter;
          render();
        });
      });

      body.querySelectorAll("[data-admin-item-key]").forEach(card => {
        const rarityField = card.querySelector("[data-item-rarity]");
        const acquisition = card.querySelector("[data-item-acquisition]");
        const rarityLabel = card.querySelector("[data-item-rarity-label]");

        rarityField?.addEventListener("change",() => {
          const rarity = rarityField.value;
          if (acquisition) acquisition.textContent = ITEM_RARITY_HELP[rarity] || ITEM_RARITY_HELP.commun;
          if (rarityLabel) rarityLabel.textContent = ITEM_RARITY_LABELS[rarity] || ITEM_RARITY_LABELS.commun;
        });

        card.querySelector("[data-item-save]")?.addEventListener("click",async event => {
          const button = event.currentTarget;
          const itemKey = card.dataset.adminItemKey;
          const rarity = rarityField?.value || "commun";
          const price = Number(card.querySelector("[data-item-price]")?.value || 0);
          const currency = card.querySelector("[data-item-currency]")?.value || "coins";

          if (!Number.isFinite(price) || price < 0 || price > 999999) {
            return toast("Prix invalide.");
          }

          button.disabled = true;
          button.textContent = "Enregistrement…";

          const response = await emit("admin:itemConfigUpdate", {
            itemKey,
            rarity,
            price,
            currency
          });

          button.disabled = false;
          button.textContent = "Enregistrer";

          if (!response.ok || !response.item) {
            return toast(response.error || "Configuration impossible.");
          }

          const index = state.itemCatalog.findIndex(item => item.key === response.item.key);
          if (index >= 0) state.itemCatalog[index] = response.item;

          toast(\`\${response.item.label} enregistré.\`);
          render();
        });
      });
    };

    render();
  }

` + toolsMarker;

  source = replaceOnce(file, source, toolsMarker, itemsPage, "fonction renderToolsTab");
  write(file, source);
}

function main() {
  const required = [
    "admin-v1.js",
    "admin-hook.js",
    "db-migrations.js",
    "db-migrations.test.cjs"
  ];

  for (const file of required) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      throw new Error(`Fichier introuvable: ${file}. Lance ce script à la racine du dépôt P'tit Bac.`);
    }
  }

  patchDbMigrations();
  patchDbMigrationTests();
  patchAdminHook();
  patchAdminClient();

  console.log("✅ Page Admin > Items installée.");
  console.log("Fichiers modifiés : admin-v1.js, admin-hook.js, db-migrations.js, db-migrations.test.cjs");
  console.log("Tu peux maintenant supprimer apply-admin-items.cjs : il n'est pas nécessaire au jeu.");
}

try {
  main();
} catch (error) {
  console.error("❌", error.message);
  process.exitCode = 1;
}
