(() => {
  "use strict";

  const originalRenderScoreboard = window.renderScoreboard;

  function esc(value = "") {
    try { return escapeHtml(value); } catch {
      return String(value).replace(/[&<>"']/g, c => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
      }[c]));
    }
  }

  function categoryEmoji(category) {
    try { return categoryIcon(category); } catch { return "✨"; }
  }

  function isImageAvatar(value) {
    const raw = String(value || "");
    return Boolean(window.PtitBacProfilePhoto?.isImageAvatar?.(raw)) || /^data:image\//i.test(raw);
  }

  function playerAvatar(player) {
    const raw = String(player?.avatar || "");
    if (isImageAvatar(raw)) return `<img src="${raw}" alt="" draggable="false">`;
    return `<span>${esc(raw || String(player?.name || "?").slice(0,1).toUpperCase())}</span>`;
  }

  function adminCoins() {
    const st = window.PtitBacAdminDisplayState;
    if (st?.admin && st?.infiniteCoins) return "∞";
    if (document.documentElement.classList.contains("ptb-admin-infinite-coins")) return "∞";
    return typeof getCoins === "function" ? String(getCoins()) : "0";
  }

  function difficultyLabel(value) {
    const raw = String(value || "").toLowerCase();
    if (raw === "hard" || raw === "difficult" || raw === "difficile") return "Difficile";
    if (raw === "easy" || raw === "beginner" || raw === "facile") return "Facile";
    return "Moyen";
  }

  function difficultyIcon(value) {
    const raw = String(value || "").toLowerCase();
    if (raw === "hard" || raw === "difficult" || raw === "difficile") return "/difficulty-hard.png";
    if (raw === "easy" || raw === "beginner" || raw === "facile") return "/difficulty-easy.png";
    return "/difficulty-normal.png";
  }

  function gameMinutes(state) {
    const explicit = Number(
      state?.gameDurationSeconds ??
      state?.elapsedSeconds ??
      state?.durationSeconds ??
      0
    );
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.max(1, Math.round(explicit / 60));
    }

    const perRound = Number(
      state?.roundDurationSeconds ??
      state?.answerDurationSeconds ??
      state?.responseTime ??
      state?.roundTime ??
      60
    );
    const roundsDone = Math.max(1, Number(state?.roundIndex || 0) + 1);
    const seconds = Number.isFinite(perRound) && perRound > 0 ? perRound * roundsDone : 60;
    return Math.max(1, Math.round(seconds / 60));
  }

  function roundWinner(state, players) {
    const scores = state.lastRoundScores || {};
    const ranked = [...players].sort((a,b) =>
      Number(scores[b.id] || 0) - Number(scores[a.id] || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );
    const best = ranked.length ? Number(scores[ranked[0].id] || 0) : 0;
    const winners = ranked.filter(p => Number(scores[p.id] || 0) === best);
    return { winners, points: best };
  }

  function renderScoreboardV1() {
    const state = session.state;
    const user = me();

    if (!state || state.phase !== "scoreboard") {
      if (typeof originalRenderScoreboard === "function") return originalRenderScoreboard();
      return;
    }

    const players = [...(state.players || [])];
    const results = state.lastRoundResults || {
      byPlayer: {},
      categories: state.categories || [],
      letter: state.currentLetter || ""
    };

    const categories = (results.categories?.length ? results.categories : state.categories) || [];
    const isLastRound = Number(state.roundIndex || 0) + 1 >= Number(state.rounds || 1);
    const winner = roundWinner(state, players);
    const winnerNames = winner.winners.map(p => esc(p.name)).join(" & ");
    const winnerTitle = winner.winners.length > 1 ? "ÉGALITÉ SUR LA MANCHE" : "VAINQUEUR DE LA MANCHE";
    const winnerPoints = winner.winners.length > 1
      ? `avec ${winner.points} point${winner.points !== 1 ? "s" : ""} chacun !`
      : `avec ${winner.points} point${winner.points !== 1 ? "s" : ""} !`;

    const headerCells = categories.map(category => `
      <div class="ssv1-cat-head">
        <span>${categoryEmoji(category)}</span>
        <small>${esc(category)}</small>
      </div>
    `).join("");

    const fixedPlayerRows = players.map(player => `
      <div class="ssv1-player ssv1-player-fixed">
        <div class="ssv1-avatar">${playerAvatar(player)}</div>
        <div class="ssv1-player-copy">
          <strong>${esc(player.name || "Joueur")}</strong>
          <small>${Number(player.score || 0)} pt${Number(player.score || 0) !== 1 ? "s" : ""}</small>
        </div>
      </div>
    `).join("");

    const rows = players.map(player => {
      const cells = categories.map(category => {
        const result = results.byPlayer?.[player.id]?.[category] || {
          answer: "",
          status: "invalid",
          correction: "Aucune réponse"
        };

        const status = result.status === "valid"
          ? "valid"
          : result.status === "duplicate"
            ? "duplicate"
            : "invalid";

        const hasAnswer = Boolean(result.answer);
        const answer = hasAnswer ? esc(result.answer) : "—";
        const symbol = status === "valid" ? "✓" : status === "duplicate" ? "!" : (hasAnswer ? "×" : "");
        const correction = status === "valid"
          ? ""
          : esc(result.correction || (status === "duplicate" ? "Doublon" : hasAnswer ? "Mauvaise réponse" : "Aucune réponse"));

        const canReport =
          player.id === session.playerId &&
          status === "invalid" &&
          result.reportable;

        return `
          <div class="ssv1-answer ${status}">
            <strong>${answer}</strong>
            ${correction ? `<small>${correction}</small>` : ""}
            ${symbol ? `<b>${symbol}</b>` : ""}
            ${canReport ? `
              <button
                type="button"
                class="ssv1-report ${result.reported ? "is-reported" : ""}"
                data-category="${encodeURIComponent(category)}"
                data-round="${Number(results.roundIndex ?? state.roundIndex)}"
                ${result.reported ? "disabled" : ""}
              >${result.reported ? "Signalé ✓" : "Signaler"}</button>
            ` : ""}
          </div>
        `;
      }).join("");

      return `<div class="ssv1-player-row ssv1-player-row-scroll">${cells}</div>`;
    }).join("");

    const roundNumber = Number(state.roundIndex || 0) + 1;
    const roundTotal = Number(state.rounds || 1);
    const minutes = gameMinutes(state);
    const difficulty = difficultyLabel(state.categoryDifficulty);

    setScreen(`
      <main class="ssv1-screen">
        <header class="ssv1-game-header">
          <button class="ssv1-exit" id="ssv1Exit" type="button" aria-label="Quitter la partie">
            <img src="/lobby-exit.png" alt="">
          </button>

          <img class="ssv1-brand" src="/ptitbac.logo.png" alt="P’tit Bac">

          <div class="ssv1-wallet">
            <img src="/coin.png" alt="">
            <strong>${adminCoins()}</strong>
          </div>
        </header>

        <section class="ssv1-heading">
          <h1>Résultats <span>de la manche</span></h1>
          <p>Voici toutes les réponses et leurs corrections !</p>
        </section>

        <section class="ssv1-winner">
          <small class="ssv1-winner-label"><img src="/admin-crown.png" alt=""> ${winnerTitle}</small>

          <div class="ssv1-winner-body">
            <div class="ssv1-trophy"><img src="/scoreboard-trophy.png" alt="Trophée"></div>

            <div class="ssv1-winner-copy">
              <div class="ssv1-winner-name-row">
                ${winner.winners[0] ? `<div class="ssv1-winner-avatar">${playerAvatar(winner.winners[0])}</div>` : ""}
                <strong>${winnerNames || "Aucun vainqueur"}</strong>
              </div>
              <span class="ssv1-winner-points">${winnerNames ? winnerPoints : "Aucun point marqué."}</span>
            </div>
          </div>
        </section>

        <section class="ssv1-board-shell">
          <div class="ssv1-board-hint" aria-hidden="true">
            <span>☝</span> Glisse pour voir les autres catégories <b>→</b>
          </div>

          <div class="ssv1-board-fixed">
            <div class="ssv1-player-title">Joueurs</div>
            ${fixedPlayerRows}
          </div>

          <div class="ssv1-board-scroll">
            <div class="ssv1-board-scroll-inner" style="--ssv1-cols:${Math.max(1,categories.length)}">
              <div class="ssv1-grid-head ssv1-grid-head-scroll">${headerCells}</div>
              ${rows}
            </div>
          </div>
        </section>


${user?.isHost ? `
          <button class="ssv1-next" id="ssv1Next" type="button">
            ${isLastRound ? "Afficher le classement" : "Prochaine manche"} <span>→</span>
          </button>
        ` : `
          <div class="ssv1-wait-host">
            <span class="ssv1-mini-spinner"></span>
            En attente de l’hôte pour continuer
          </div>
        `}
</main>
    `);

    document.getElementById("ssv1Exit")?.addEventListener("click", () => gameExitModal(state, user, "ssv1"));

    document.getElementById("ssv1Next")?.addEventListener("click", () => {
      socket.emit("game:nextRound", { code: state.code, playerId: session.playerId });
    });

    document.querySelectorAll(".ssv1-report:not(:disabled)").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "Envoi…";

        socket.emit("answer:report", {
          code: state.code,
          playerId: session.playerId,
          roundIndex: Number(btn.dataset.round),
          category: decodeURIComponent(btn.dataset.category || "")
        }, res => {
          if (!res?.ok) {
            btn.disabled = false;
            btn.textContent = "Signaler";
            return toast(res?.error || "Impossible d’envoyer le signalement.");
          }
          btn.textContent = "Signalé ✓";
          btn.classList.add("is-reported");
          toast("Signalement envoyé.");
        });
      });
    });
  }

  window.renderScoreboard = renderScoreboardV1;
  try { renderScoreboard = renderScoreboardV1; } catch {}
})();
