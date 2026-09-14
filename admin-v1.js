(() => {
  "use strict";

  const state = {
    admin:false,
    infiniteCoins:false,
    infiniteLives:false,
    reports:[],
    activeTab:"tools",
    reportFilter:"all",
    itemCatalog:[],
    player:null
  };

  const token = () =>
    String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    );

  const friendCode = () =>
    String(
      localStorage.getItem("petitbac_friendCode") ||
      ""
    ).replace(/^#/,"");

  const profile = () =>
    window.getProfile?.() ||
    { name:"Joueur" };

  function emit(name,payload={}) {
    return new Promise(resolve => {
      socket.emit(
        name,
        {
          ...payload,
          walletToken:token()
        },
        response => resolve(response || {})
      );
    });
  }

  function esc(value="") {
    if (typeof escapeHtml === "function") {
      return escapeHtml(value);
    }

    return String(value).replace(
      /[&<>"']/g,
      char => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[char])
    );
  }

  function modal(inner, extraClass="") {
    document
      .querySelector(".admin-v1-overlay")
      ?.remove();

    const overlay = document.createElement("div");
    overlay.className =
      `admin-v1-overlay ${extraClass}`.trim();

    overlay.innerHTML = `
      <div class="admin-v1-modal">
        ${inner}
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click",event => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    return overlay;
  }

  function icon(name) {
    const icons = {
      tools:`
        <svg viewBox="0 0 24 24">
          <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"></path>
          <path d="M19 13a8 8 0 0 0 0-2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.6-.9L14.7 3h-5.4L9 6.2a8 8 0 0 0-1.6.9l-2.4-1-2 3.4L5 11a8 8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.6.9l.3 3.2h5.4l.3-3.2a8 8 0 0 0 1.6-.9l2.4 1 2-3.4L19 13Z"></path>
        </svg>`,
      reports:`
        <svg viewBox="0 0 24 24">
          <path d="M6 3h9l4 4v14H6V3Z"></path>
          <path d="M15 3v5h4M9 12h6M9 16h6"></path>
        </svg>`,
      users:`
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0"></path>
          <circle cx="17" cy="9" r="2.3"></circle>
          <path d="M15.5 14.5c2.7.1 4.7 1.4 5 3.7"></path>
        </svg>`,
      coins:`
        <svg viewBox="0 0 24 24">
          <ellipse cx="12" cy="6" rx="7" ry="3"></ellipse>
          <path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"></path>
          <path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"></path>
          <path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"></path>
        </svg>`,
      gift:`
        <svg viewBox="0 0 24 24">
          <path d="M4 10h16v10H4V10ZM3 6h18v4H3V6Z"></path>
          <path d="M12 6v14M12 6c-1.3 0-4.2-.4-4.2-2.2C7.8 2.6 9 2 10 2c1.4 0 2 1.1 2 4Zm0 0c1.3 0 4.2-.4 4.2-2.2C16.2 2.6 15 2 14 2c-1.4 0-2 1.1-2 4Z"></path>
        </svg>`,
      search:`
        <svg viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="6.5"></circle>
          <path d="m15.5 15.5 5 5"></path>
        </svg>`
    };

    return `<span class="admin-v4-icon">${icons[name] || icons.tools}</span>`;
  }

  function shell() {
    return `
      <button
        class="admin-v1-x"
        type="button"
        aria-label="Fermer"
      >×</button>

      <header class="admin-v4-head">
        <img src="/admin-crown.png" alt="">
        <div>
          <small>ESPACE PRIVÉ</small>
          <h2>Menu admin</h2>
          <p>Outils personnels et modération du jeu.</p>
        </div>
      </header>

      <nav class="admin-v4-main-tabs" aria-label="Menu administrateur">
        <button data-admin-tab="tools" class="${state.activeTab === "tools" ? "active" : ""}">
          ${icon("tools")}
          <span>Outils</span>
        </button>

        <button data-admin-tab="reports" class="${state.activeTab === "reports" ? "active" : ""}">
          ${icon("reports")}
          <span>Reports</span>
        </button>

        <button data-admin-tab="players" class="${state.activeTab === "players" ? "active" : ""}">
          ${icon("users")}
          <span>Joueurs</span>
        </button>
      </nav>

      <div id="adminV4Body" class="admin-v4-body"></div>
    `;
  }

  async function refreshAdmin() {
    const response = await emit("admin:status");

    state.admin = !!response.admin;
    state.infiniteCoins = !!response.infiniteCoins;
    state.infiniteLives = !!response.infiniteLives;

    decorate();

    const crowns = document.querySelectorAll(
      ".admin-v1-crown-btn"
    );

    crowns.forEach(crown => {
      crown.setAttribute(
        "aria-label",
        state.admin
          ? "Ouvrir le menu admin"
          : "Activer l’espace admin"
      );

      crown.onclick = () =>
        state.admin
          ? adminMenu()
          : adminActivationModal();
    });

    return response;
  }

  async function adminMenu(initialTab = "tools") {
    if (!state.admin) {
      const result = await refreshAdmin();

      if (!result?.admin) {
        return adminActivationModal();
      }
    }

    state.activeTab = initialTab;

    const overlay = modal(
      shell(),
      "admin-v4-overlay"
    );

    overlay
      .querySelector(".admin-v1-x")
      ?.addEventListener("click",() => {
        overlay.remove();
      });

    overlay
      .querySelectorAll("[data-admin-tab]")
      .forEach(button => {
        button.addEventListener("click",() => {
          state.activeTab = button.dataset.adminTab;

          overlay
            .querySelectorAll("[data-admin-tab]")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });

          renderActiveTab(overlay);
        });
      });

    await renderActiveTab(overlay);
  }

  async function renderActiveTab(overlay) {
    if (!overlay?.isConnected) return;

    if (state.activeTab === "reports") {
      return renderReportsTab(overlay);
    }

    if (state.activeTab === "players") {
      return renderPlayersTab(overlay);
    }

    return renderToolsTab(overlay);
  }

  async function renderToolsTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    if (!state.itemCatalog.length) {
      const catalog = await emit("admin:itemCatalog");
      if (catalog.ok) {
        state.itemCatalog = catalog.items || [];
      }
    }

    body.innerHTML = `
      <section class="admin-v4-card">
        <h3>${icon("tools")}<span>Avantages admin</span></h3>

        <label class="admin-v1-toggle">
          <span>
            <b>Pièces infinies</b>
            <small>Ton portefeuille ne diminue plus</small>
          </span>

          <input
            id="admCoins"
            type="checkbox"
            ${state.infiniteCoins ? "checked" : ""}
          >
          <i></i>
        </label>

        <label class="admin-v1-toggle">
          <span>
            <b>Vies infinies</b>
            <small>Tes vies restent disponibles</small>
          </span>

          <input
            id="admLives"
            type="checkbox"
            ${state.infiniteLives ? "checked" : ""}
          >
          <i></i>
        </label>
      </section>

      <section class="admin-v4-card">
        <h3>${icon("coins")}<span>Gérer les ressources</span></h3>

        <div class="admin-v4-choice-grid">
          <div>
            <small>Mode</small>
            <div class="admin-v4-segment" id="admResourceMode">
              <button class="active" data-mode="set" type="button">Définir</button>
              <button data-mode="add" type="button">Ajouter</button>
            </div>
          </div>

          <div>
            <small>Ressource</small>
            <div class="admin-v4-segment" id="admResourceType">
              <button class="active" data-resource="coins" type="button">🪙 Pièces</button>
              <button data-resource="gems" type="button">💎 Gemmes</button>
            </div>
          </div>
        </div>

        <div class="admin-v1-fields">
          <label>
            ID du joueur
            <input
              id="admResourceId"
              inputmode="numeric"
              maxlength="6"
              placeholder="#84251"
            >
          </label>

          <label>
            Montant
            <input
              id="admResourceAmount"
              inputmode="numeric"
              type="number"
              min="0"
              max="999999"
              placeholder="100"
            >
          </label>
        </div>

        <button
          id="admResourceValidate"
          class="admin-v1-primary"
          type="button"
        >Valider</button>
      </section>

      <section class="admin-v4-card">
        <h3>${icon("gift")}<span>Donner un objet</span></h3>

        <div class="admin-v4-object-grid">
          <label>
            ID du joueur
            <input
              id="admItemId"
              inputmode="numeric"
              maxlength="6"
              placeholder="#84251"
            >
          </label>

          <label>
            Objet
            <select id="admItemKey">
              ${
                state.itemCatalog.length
                  ? state.itemCatalog
                      .map(item => `
                        <option value="${esc(item.key)}">
                          ${esc(item.icon || "🎁")} ${esc(item.label)}
                        </option>
                      `)
                      .join("")
                  : `<option value="">Aucun objet</option>`
              }
            </select>
          </label>

          <label>
            Quantité
            <input
              id="admItemQuantity"
              inputmode="numeric"
              type="number"
              min="1"
              max="99"
              value="1"
            >
          </label>
        </div>

        <button
          id="admItemSend"
          class="admin-v1-primary"
          type="button"
        >Envoyer l’objet</button>
      </section>

      <aside class="admin-v4-note">
        <span>✓</span>
        <div>
          <b>Outils réservés aux administrateurs</b>
          <small>Chaque modification sensible est enregistrée dans les logs admin.</small>
        </div>
      </aside>
    `;

    const saveSettings = async () => {
      const response = await emit(
        "admin:selfSettings",
        {
          infiniteCoins:
            body.querySelector("#admCoins")?.checked,
          infiniteLives:
            body.querySelector("#admLives")?.checked
        }
      );

      if (!response.ok) {
        return toast(
          response.error ||
          "Modification impossible."
        );
      }

      state.infiniteCoins = !!response.infiniteCoins;
      state.infiniteLives = !!response.infiniteLives;

      toast("Options admin enregistrées.");
    };

    body
      .querySelector("#admCoins")
      ?.addEventListener("change",saveSettings);

    body
      .querySelector("#admLives")
      ?.addEventListener("change",saveSettings);

    let mode = "set";
    let resource = "coins";

    body
      .querySelectorAll("#admResourceMode button")
      .forEach(button => {
        button.addEventListener("click",() => {
          mode = button.dataset.mode;

          body
            .querySelectorAll("#admResourceMode button")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });
        });
      });

    body
      .querySelectorAll("#admResourceType button")
      .forEach(button => {
        button.addEventListener("click",() => {
          resource = button.dataset.resource;

          body
            .querySelectorAll("#admResourceType button")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });
        });
      });

    body
      .querySelector("#admResourceValidate")
      ?.addEventListener("click",async event => {
        const button = event.currentTarget;

        const friendCode =
          String(
            body.querySelector("#admResourceId")?.value ||
            ""
          ).replace("#","").trim();

        const amount =
          Number(
            body.querySelector("#admResourceAmount")?.value
          );

        if (!/^\d{5}$/.test(friendCode)) {
          return toast("Entre un ID joueur valide.");
        }

        if (
          !Number.isFinite(amount) ||
          amount < 0
        ) {
          return toast("Entre un montant valide.");
        }

        button.disabled = true;
        button.textContent = "Modification…";

        const response = await emit(
          "admin:resourceAdjust",
          {
            friendCode,
            mode,
            resource,
            amount
          }
        );

        button.disabled = false;
        button.textContent = "Valider";

        if (!response.ok) {
          return toast(
            response.error ||
            "Modification impossible."
          );
        }

        const label =
          resource === "gems"
            ? "gemmes"
            : "pièces";

        const value =
          resource === "gems"
            ? response.gems
            : response.coins;

        toast(
          `${response.name} : ${value} ${label}.`
        );
      });

    body
      .querySelector("#admItemSend")
      ?.addEventListener("click",async event => {
        const button = event.currentTarget;

        const friendCode =
          String(
            body.querySelector("#admItemId")?.value ||
            ""
          ).replace("#","").trim();

        const itemKey =
          body.querySelector("#admItemKey")?.value || "";

        const quantity =
          Number(
            body.querySelector("#admItemQuantity")?.value ||
            1
          );

        if (!/^\d{5}$/.test(friendCode)) {
          return toast("Entre un ID joueur valide.");
        }

        if (!itemKey) {
          return toast("Choisis un objet.");
        }

        button.disabled = true;
        button.textContent = "Envoi…";

        const response = await emit(
          "admin:grantItem",
          {
            friendCode,
            itemKey,
            quantity
          }
        );

        button.disabled = false;
        button.textContent = "Envoyer l’objet";

        if (!response.ok) {
          return toast(
            response.error ||
            "Envoi impossible."
          );
        }

        toast(
          `${response.item} ×${response.quantity} envoyé à ${response.name}.`
        );
      });
  }

  function reportBadge(report) {
    if (report.type === "report-avis") {
      return "AVIS";
    }

    if (report.type === "report-joueur") {
      return "JOUEUR";
    }

    return "RÉPONSE / BUG";
  }

  function reportActions(report) {
    if (
      report.type !== "report-bug" ||
      !report.letter ||
      !report.category ||
      !report.answer
    ) {
      return "";
    }

    const validated =
      report.status === "admin_validated";

    if (validated) {
      return `
        <div class="admin-v4-report-valid">
          ✓ VALIDÉ — APPRIS PAR L’IA
        </div>
      `;
    }

    return `
      <div class="admin-v4-report-actions">
        <button
          type="button"
          class="adm-answer-validate"
          data-id="${esc(report.id)}"
        >✓ Valider</button>

        <button
          type="button"
          class="adm-answer-delete"
          data-id="${esc(report.id)}"
        >Supprimer</button>
      </div>
    `;
  }

  async function loadReports(force = false) {
    if (
      state.reports.length &&
      !force
    ) {
      return true;
    }

    const response = await emit("admin:reports");

    if (!response.ok) {
      toast(
        response.error ||
        "Impossible de charger les reports."
      );
      return false;
    }

    state.reports = response.reports || [];
    return true;
  }

  async function renderReportsTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    body.innerHTML = `
      <section class="admin-v4-card admin-v4-reports-card">
        <div class="admin-v4-section-head">
          <h3>${icon("reports")}<span>Reports</span></h3>
          <button id="admReportsRefresh" type="button">Actualiser</button>
        </div>

        <div class="admin-v4-report-filters">
          <button data-filter="all">Tous</button>
          <button data-filter="report-avis">Avis</button>
          <button data-filter="report-bug">Réponses / bugs</button>
          <button data-filter="report-joueur">Joueurs</button>
        </div>

        <div id="admReportList" class="admin-v1-list">
          <div class="admin-v1-empty">Chargement…</div>
        </div>
      </section>
    `;

    const renderList = () => {
      const listNode =
        body.querySelector("#admReportList");

      if (!listNode) return;

      const list = state.reports.filter(
        report =>
          state.reportFilter === "all" ||
          report.type === state.reportFilter
      );

      body
        .querySelectorAll("[data-filter]")
        .forEach(button => {
          button.classList.toggle(
            "active",
            button.dataset.filter ===
              state.reportFilter
          );
        });

      listNode.innerHTML = list.length
        ? list.map(report => `
            <article class="admin-v1-report">
              <div class="admin-v1-report-top">
                <span class="admin-v1-badge ${esc(report.type)}">
                  ${reportBadge(report)}
                </span>

                <time>
                  ${
                    report.created_at
                      ? new Date(report.created_at)
                          .toLocaleString("fr-FR")
                      : ""
                  }
                </time>
              </div>

              <h4>
                ${esc(report.player_name || "Signalement")}
                ${
                  report.friend_code
                    ? `<small>#${esc(report.friend_code)}</small>`
                    : ""
                }
              </h4>

              ${
                report.letter
                  ? `<p class="admin-v1-context"><b>Lettre ${esc(report.letter)}</b></p>`
                  : ""
              }

              ${
                report.category
                  ? `<p class="admin-v1-context"><b>Catégorie :</b> ${esc(report.category)}</p>`
                  : ""
              }

              ${
                report.answer
                  ? `<p class="admin-v1-context"><b>Réponse :</b> « ${esc(report.answer)} »</p>`
                  : ""
              }

              <p>${esc(report.message || "Signalement")}</p>

              ${
                report.room_code
                  ? `<small>Salon ${esc(report.room_code)}</small>`
                  : ""
              }

              ${reportActions(report)}
            </article>
          `).join("")
        : `<div class="admin-v1-empty">Aucun report dans cette catégorie.</div>`;

      listNode
        .querySelectorAll(".adm-answer-validate")
        .forEach(button => {
          button.addEventListener("click",async () => {
            button.disabled = true;
            button.textContent = "Validation…";

            const response = await emit(
              "admin:answerReportAction",
              {
                reportId:button.dataset.id,
                action:"validate"
              }
            );

            if (!response.ok) {
              button.disabled = false;
              button.textContent = "✓ Valider";

              return toast(
                response.error ||
                "Erreur."
              );
            }

            toast(
              `Réponse validée : ${response.answer}`
            );

            await loadReports(true);
            renderList();
          });
        });

      listNode
        .querySelectorAll(".adm-answer-delete")
        .forEach(button => {
          button.addEventListener("click",async () => {
            button.disabled = true;
            button.textContent = "Suppression…";

            const response = await emit(
              "admin:answerReportAction",
              {
                reportId:button.dataset.id,
                action:"delete"
              }
            );

            if (!response.ok) {
              button.disabled = false;
              button.textContent = "Supprimer";

              return toast(
                response.error ||
                "Erreur."
              );
            }

            toast("Report supprimé.");

            await loadReports(true);
            renderList();
          });
        });
    };

    body
      .querySelectorAll("[data-filter]")
      .forEach(button => {
        button.addEventListener("click",() => {
          state.reportFilter = button.dataset.filter;
          renderList();
        });
      });

    body
      .querySelector("#admReportsRefresh")
      ?.addEventListener("click",async () => {
        await loadReports(true);
        renderList();
      });

    await loadReports();
    renderList();
  }

  async function renderPlayersTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    body.innerHTML = `
      <section class="admin-v4-card">
        <h3>${icon("users")}<span>Rechercher un joueur</span></h3>

        <div class="admin-v4-player-search">
          <label>
            ID du joueur
            <input
              id="admPlayerSearch"
              inputmode="numeric"
              maxlength="6"
              placeholder="#84251"
            >
          </label>

          <button
            id="admPlayerSearchBtn"
            type="button"
            class="admin-v1-primary"
          >
            ${icon("search")}
            <span>Rechercher</span>
          </button>
        </div>
      </section>

      <div id="admPlayerResult"></div>
    `;

    const resultNode =
      body.querySelector("#admPlayerResult");

    const renderPlayer = player => {
      if (!player) {
        resultNode.innerHTML = "";
        return;
      }

      resultNode.innerHTML = `
        <section class="admin-v4-card admin-v4-player-card">
          <div class="admin-v4-player-head">
            <div class="admin-v4-player-avatar">
              ${esc(player.avatar || "🧠")}
            </div>

            <div>
              <h3>${esc(player.name || "Joueur")}</h3>
              <small>#${esc(player.friendCode || "-----")}</small>
            </div>

            <span class="admin-v4-online ${player.online ? "is-online" : ""}">
              ${player.online ? "En ligne" : "Hors ligne"}
            </span>
          </div>

          <div class="admin-v4-player-stats">
            <article>
              <small>Pièces</small>
              <strong>🪙 ${Number(player.coins || 0)}</strong>
            </article>

            <article>
              <small>Gemmes</small>
              <strong>💎 ${Number(player.gems || 0)}</strong>
            </article>

            <article>
              <small>Vies</small>
              <strong>❤️ ${Number(player.lives || 0)}/5</strong>
            </article>

            <article>
              <small>Reports</small>
              <strong>⚑ ${Number(player.reports || 0)}</strong>
            </article>
          </div>

          <div class="admin-v4-player-meta">
            <p>
              <b>Membre depuis</b>
              <span>${player.createdAt ? new Date(player.createdAt).toLocaleDateString("fr-FR") : "—"}</span>
            </p>

            <p>
              <b>Dernière activité</b>
              <span>${player.lastSeen ? new Date(player.lastSeen).toLocaleString("fr-FR") : "—"}</span>
            </p>
          </div>

          <div class="admin-v4-items">
            <b>Objets</b>
            ${
              player.items?.length
                ? `<div>${player.items.map(item => `
                    <span>${esc(item.label)} ×${Number(item.quantity || 0)}</span>
                  `).join("")}</div>`
                : `<small>Aucun objet attribué.</small>`
            }
          </div>

          <button
            id="admPlayerReports"
            class="admin-v4-secondary"
            type="button"
          >Voir les reports de ce joueur</button>
        </section>
      `;

      resultNode
        .querySelector("#admPlayerReports")
        ?.addEventListener("click",async () => {
          state.activeTab = "reports";
          state.reportFilter = "report-joueur";

          overlay
            .querySelectorAll("[data-admin-tab]")
            .forEach(button => {
              button.classList.toggle(
                "active",
                button.dataset.adminTab === "reports"
              );
            });

          await renderReportsTab(overlay);
        });
    };

    const search = async () => {
      const code =
        String(
          body.querySelector("#admPlayerSearch")?.value ||
          ""
        ).replace("#","").trim();

      if (!/^\d{5}$/.test(code)) {
        return toast("Entre un ID joueur valide.");
      }

      resultNode.innerHTML = `
        <div class="admin-v1-empty">
          Recherche…
        </div>
      `;

      const response = await emit(
        "admin:playerLookup",
        { friendCode:code }
      );

      if (!response.ok) {
        resultNode.innerHTML = `
          <div class="admin-v1-empty">
            ${esc(response.error || "Joueur introuvable.")}
          </div>
        `;
        return;
      }

      state.player = response.player;
      renderPlayer(response.player);
    };

    body
      .querySelector("#admPlayerSearchBtn")
      ?.addEventListener("click",search);

    body
      .querySelector("#admPlayerSearch")
      ?.addEventListener("keydown",event => {
        if (event.key === "Enter") {
          event.preventDefault();
          search();
        }
      });

    if (state.player) {
      renderPlayer(state.player);
    }
  }

  function feedbackModal(type="report-avis") {
    const isBug = type === "report-bug";

    const overlay = modal(
      `
        <button
          class="admin-v1-x"
          type="button"
        >×</button>

        <div class="admin-v1-feedback-icon">
          ${isBug ? "⚑" : "✦"}
        </div>

        <h2>
          ${isBug ? "Signaler une réponse" : "Donne-nous ton avis"}
        </h2>

        <p class="admin-v1-sub">
          ${
            isBug
              ? "Explique pourquoi tu penses que la réponse devrait être acceptée."
              : "Une idée ou quelque chose à améliorer ? Ton avis nous aide."
          }
        </p>

        <textarea
          id="feedbackText"
          maxlength="1000"
          placeholder="${isBug ? "Explique le problème…" : "Écris ton avis…"}"
        ></textarea>

        <button
          id="feedbackSend"
          class="admin-v1-primary"
          type="button"
        >Envoyer</button>
      `,
      "admin-v1-feedback"
    );

    overlay
      .querySelector(".admin-v1-x")
      ?.addEventListener("click",() => {
        overlay.remove();
      });

    overlay
      .querySelector("#feedbackSend")
      ?.addEventListener("click",async () => {
        const response = await emit(
          "feedback:submit",
          {
            type,
            message:
              overlay.querySelector("#feedbackText")?.value,
            friendCode:friendCode(),
            playerName:profile().name,
            roomCode:session?.code || ""
          }
        );

        if (response.ok) {
          overlay.remove();
          toast("Merci, ton message a bien été envoyé !");
        } else {
          toast(
            response.error ||
            "Envoi impossible."
          );
        }
      });
  }

  function adminActivationModal() {
    if (state.admin) {
      return adminMenu();
    }

    const overlay = modal(
      `
        <button
          class="admin-v1-x"
          type="button"
          aria-label="Fermer"
        >×</button>

        <div class="admin-v1-brand admin-v1-activation-brand">
          <img src="/admin-crown.png" alt="">
          <div>
            <small>ACCÈS PRIVÉ</small>
            <h2>Administration</h2>
          </div>
        </div>

        <p class="admin-v1-sub">
          Entre ton code administrateur pour lier ce compte à l’espace admin.
        </p>

        <label class="admin-v1-code-label">
          Code administrateur
          <input
            id="adminActivationCode"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="••••••••"
          >
        </label>

        <p
          id="adminActivationError"
          class="admin-v1-inline-error"
          hidden
        ></p>

        <button
          id="adminActivationValidate"
          class="admin-v1-primary"
          type="button"
        >Activer l’espace admin</button>
      `,
      "admin-v1-activation"
    );

    const input =
      overlay.querySelector("#adminActivationCode");

    const error =
      overlay.querySelector("#adminActivationError");

    const validate =
      overlay.querySelector("#adminActivationValidate");

    overlay
      .querySelector(".admin-v1-x")
      ?.addEventListener("click",() => {
        overlay.remove();
      });

    const submit = async () => {
      const code =
        String(input?.value || "").trim();

      if (!code) {
        error.hidden = false;
        error.textContent =
          "Entre le code administrateur.";
        return;
      }

      validate.disabled = true;
      error.hidden = true;

      const response = await emit(
        "admin:claim",
        { code }
      );

      if (!response.ok) {
        validate.disabled = false;
        error.hidden = false;
        error.textContent =
          response.error ||
          "Activation impossible.";
        return;
      }

      overlay.remove();
      toast("Espace administrateur activé.");

      await refreshAdmin();
      adminMenu();
    };

    validate?.addEventListener("click",submit);

    input?.addEventListener("keydown",event => {
      if (event.key === "Enter") {
        submit();
      }
    });

    setTimeout(() => input?.focus(),120);
  }

  function decorate() {
    const root =
      document.querySelector(
        ".profile-v10,.profile-v2-final"
      );

    if (
      root &&
      !root.querySelector(".admin-v1-crown-btn")
    ) {
      const button = document.createElement("button");

      button.className = "admin-v1-crown-btn";
      button.type = "button";

      button.setAttribute(
        "aria-label",
        state.admin
          ? "Ouvrir le menu admin"
          : "Activer l’espace admin"
      );

      button.innerHTML =
        '<img src="/admin-crown.png" alt="">';

      button.onclick = () =>
        state.admin
          ? adminMenu()
          : adminActivationModal();

      root.appendChild(button);
    }

    const text =
      (
        document.querySelector("#app")
          ?.textContent ||
        ""
      ).toLowerCase();

    if (
      (text.includes("résultat") || text.includes("score")) &&
      !document.querySelector(".admin-v1-answer-report")
    ) {
      const button =
        document.createElement("button");

      button.className =
        "admin-v1-answer-report";

      button.textContent =
        "⚑ Signaler une réponse";

      button.onclick = () =>
        feedbackModal("report-bug");

      document
        .querySelector("main.screen")
        ?.appendChild(button);
    }
  }

  const observer =
    new MutationObserver(() => decorate());

  observer.observe(
    document.getElementById("app"),
    {
      childList:true,
      subtree:true
    }
  );

  socket.on("connect",() => {
    setTimeout(refreshAdmin,300);
  });

  window.PtitBacAdmin = {
    open(tab="tools") {
      if (state.admin) {
        return adminMenu(tab);
      }

      return adminActivationModal();
    },

    refresh:refreshAdmin,

    isAdmin() {
      return state.admin;
    }
  };

  setTimeout(refreshAdmin,600);
})();
