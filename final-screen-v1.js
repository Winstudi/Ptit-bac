(() => {
  "use strict";

  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      })[char]
    );

  function avatar(player) {
    const raw = String(player?.avatar || "");
    const image =
      window.PtitBacProfilePhoto?.isImageAvatar?.(raw) ||
      /^data:image\//i.test(raw);

    return (
      '<span class="fin-avatar">' +
        (
          image
            ? '<img src="' + esc(raw) + '" alt="" draggable="false">'
            : '<span>' +
                esc(
                  raw ||
                  String(player?.name || "?").slice(0, 1)
                ) +
              '</span>'
        ) +
      '</span>'
    );
  }

  const points = player =>
    Number(player?.score) || 0;

  const pts = player =>
    points(player) +
    " pt" +
    (points(player) > 1 ? "s" : "");

  function renderFinishedV2() {
    clearInterval(session.timerHandle);

    const state = session.state;
    const user = me();

    if (
      !state ||
      state.phase !== "finished"
    ) {
      return;
    }

    const ranked =
      [...(state.players || [])].sort(
        (a, b) =>
          points(b) - points(a) ||
          String(a.name || "").localeCompare(
            String(b.name || "")
          )
      );

    const rank = player =>
      ranked.findIndex(
        item =>
          points(item) === points(player)
      ) + 1;

    const winners =
      ranked.filter(
        player =>
          points(player) ===
          points(ranked[0])
      );

    const title =
      winners.length > 1
        ? "Victoire partagée : " +
          winners
            .map(player => player.name)
            .join(" & ")
        : winners.length
          ? winners[0].name +
            " remporte la partie !"
          : "Partie terminée";

    const top =
      ranked.slice(0, 3);

    const order =
      top.length >= 3
        ? [top[1], top[0], top[2]]
        : top.length > 1
          ? [top[1], top[0]]
          : top;

    const podium =
      order.map(player => {
        const playerRank =
          rank(player);

        return (
          '<article class="fin-podium-card place-' +
            Math.min(playerRank, 3) +
          '">' +
            '<div class="fin-medal">' +
              playerRank +
            '</div>' +

            (
              playerRank === 1
                ? '<img class="fin-crown" src="/admin-crown.png" alt="" aria-hidden="true">'
                : ""
            ) +

            avatar(player) +

            '<strong>' +
              esc(player.name) +
            '</strong>' +

            (
              winners.length > 1 && playerRank === 1
                ? '<span class="fin-you-slot">' +
                    (
                      player.id === session.playerId
                        ? '<small class="fin-you">Toi</small>'
                        : ""
                    ) +
                  '</span>'
                : (
                    player.id === session.playerId
                      ? '<small class="fin-you">Toi</small>'
                      : ""
                  )
            ) +

            '<b>' +
              pts(player) +
            '</b>' +

            '<div class="fin-pedestal" aria-hidden="true">' +
              playerRank +
            '</div>' +
          '</article>'
        );
      }).join("");

    /*
      Le classement inférieur ne répète jamais les joueurs
      déjà affichés sur le podium. Cela corrige notamment
      les égalités à deux joueurs.
    */
    const podiumIds =
      new Set(
        top.map(player => String(player.id))
      );

    const rankingPlayers =
      ranked.filter(
        player =>
          !podiumIds.has(String(player.id))
      );

    const rows =
      rankingPlayers.map(player => {
        const playerRank =
          rank(player);

        return (
          '<div class="fin-row ' +
            (
              player.id === session.playerId
                ? "is-me"
                : ""
            ) +
          '">' +

            '<span class="fin-rank place-' +
              Math.min(playerRank, 4) +
            '">' +
              playerRank +
            '</span>' +

            '<div class="fin-player">' +
              avatar(player) +
              '<strong>' +
                esc(player.name) +
              '</strong>' +
              (
                player.id === session.playerId
                  ? '<small class="fin-you">Toi</small>'
                  : ""
              ) +
            '</div>' +

            '<b>' +
              pts(player) +
            '</b>' +
          '</div>'
        );
      }).join("");

    const rankingSection =
      rankingPlayers.length
        ? (
          '<section class="fin-ranking ' +
            (
              ranked.length >= 5
                ? "is-many"
                : ""
            ) +
          '">' +
            rows +
          '</section>'
        )
        : "";

    const rawDifficulty =
      String(
        state.categoryDifficulty || ""
      ).toLowerCase();

    const difficulty =
      ["hard", "difficile"].includes(
        rawDifficulty
      )
        ? "Difficile"
        : ["medium", "normal", "moyen"]
            .includes(rawDifficulty)
          ? "Moyen"
          : "Facile";

    const quick =
      state.mode === "quick";

    const gain =
      Math.max(
        0,
        Number(
          state.myReward ??
          state.rewardsByPlayerId?.[
            session.playerId
          ] ??
          0
        ) || 0
      );

    setScreen(
      '<main class="fsv1-screen final-mobile">' +

        '<header class="fin-top">' +
          '<img class="fin-brand" src="/ptitbac.logo.png" alt="P’tit Bac">' +
          '<span></span>' +
        '</header>' +

        '<section class="fin-heading">' +
          '<h1>Partie <span>terminée !</span></h1>' +
          '<p>' +
            esc(title) +
          '</p>' +
        '</section>' +

        '<section class="fin-podium fin-podium-' +
          Math.min(top.length, 3) +
          (
            winners.length > 1
              ? " fin-podium-shared-win"
              : ""
          ) +
          '" aria-label="Podium">' +
          podium +
        '</section>' +

        rankingSection +

        '<section class="fin-stats">' +
          [
            [
              "/friends.png",
              ranked.length,
              "Joueurs"
            ],
            [
              "/lightning.png",
              Number(state.rounds) || 1,
              "Manche" +
                (
                  state.rounds > 1
                    ? "s"
                    : ""
                )
            ],
            [
              "/lobby-clock.png",
              (Number(state.duration) || 0) +
                " s",
              "Par manche"
            ],
            [
              "/difficulty.png",
              difficulty,
              "Niveau"
            ]
          ]
            .map(
              ([img, value, label]) =>
                '<div>' +
                  '<img src="' +
                    img +
                    '" alt="">' +
                  '<strong>' +
                    value +
                  '</strong>' +
                  '<small>' +
                    label +
                  '</small>' +
                '</div>'
            )
            .join("") +
        '</section>' +

        '<p class="fin-mode">' +
          (
            quick
              ? "Partie rapide · +" +
                gain +
                " pièces"
              : "Salon privé · Partie sans gain de pièces"
          ) +
        '</p>' +

        '<div class="fin-actions">' +
          (
            user?.isHost && !quick
              ? '<button id="finReplay" class="fin-primary">↻ Rejouer</button>'
              : quick
                ? '<button id="finQuick" class="fin-primary">↻ Rejouer</button>'
                : '<p>L’hôte peut relancer une partie.</p>'
          ) +

          '<button id="finHome" class="fin-secondary">⌂ Retour à l’accueil</button>' +
        '</div>' +

      '</main>'
    );

    const leave = () => {
      socket.emit(
        "room:leave",
        {
          code:state.code,
          playerId:session.playerId
        }
      );

      clearSession();
      renderHome();
    };

    document
      .getElementById("finHome")
      .onclick = leave;

    const replay =
      document.getElementById(
        "finReplay"
      );

    if (replay) {
      replay.onclick = () => {
        if (replay.disabled) return;

        replay.disabled = true;

        socket.emit(
          "game:restart",
          {
            code:state.code,
            playerId:session.playerId
          }
        );
      };
    }

    const again =
      document.getElementById(
        "finQuick"
      );

    if (again) {
      again.onclick = () => {
        if (again.disabled) return;

        again.disabled = true;

        const profile = {
          name:user?.name || "Joueur",
          icon:user?.avatar || "🙂"
        };

        leave();

        window.startQuickPlay?.(
          profile
        );
      };
    }
  }

  window.renderFinished =
    renderFinishedV2;

  try {
    renderFinished =
      renderFinishedV2;
  } catch {}
})();
