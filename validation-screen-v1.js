(() => {
  "use strict";

  function renderValidationV2() {
    clearInterval(session.timerHandle);

    const state =
      session.state;

    const user =
      me();

    if (
      !state ||
      state.phase !== "validation"
    ) {
      return;
    }

    const validation =
      state.validation || {};

    const unavailable =
      validation.status ===
      "unavailable";

    const complete =
      validation.status ===
      "complete";

    setScreen(`
      <main class="vsv1-screen">
        <button
          class="vsv1-exit"
          id="vsv1Exit"
          type="button"
          aria-label="Quitter la partie"
        >
          <img
            src="/lobby-exit.png"
            alt=""
          >
        </button>

        <section
          class="vsv1-simple"
          role="status"
          aria-live="polite"
        >
          <div
            class="vsv1-spinner ${
              complete
                ? "is-complete"
                : unavailable
                  ? "is-error"
                  : ""
            }"
          >
            ${
              complete
                ? "✓"
                : unavailable
                  ? "!"
                  : ""
            }
          </div>

          <h1>
            ${
              complete
                ? "Vérification terminée !"
                : unavailable
                  ? "Vérification en pause"
                  : "Vérification des réponses…"
            }
          </h1>

          ${
            unavailable &&
            user?.isHost
              ? `
                <button
                  class="vsv1-retry"
                  id="vsv1Retry"
                  type="button"
                >
                  ↻ Réessayer
                </button>
              `
              : ""
          }
        </section>
      </main>
    `);

    document
      .getElementById("vsv1Exit")
      ?.addEventListener(
        "click",
        () =>
          gameExitModal(
            state,
            user,
            "vsv1"
          )
      );

    document
      .getElementById("vsv1Retry")
      ?.addEventListener(
        "click",
        () => {
          const button =
            document.getElementById(
              "vsv1Retry"
            );

          if (!socket.connected) {
            return toast(
              "Connexion interrompue. Attends la reconnexion."
            );
          }

          if (button) {
            button.disabled = true;
          }

          socket.emit(
            "validation:retry",
            {
              code:state.code,
              playerId:
                session.playerId
            }
          );

          setTimeout(() => {
            const current = session.state;
            const stillUnavailable =
              current?.phase === "validation" &&
              current?.validation?.status === "unavailable";

            if (
              socket.connected &&
              button?.isConnected &&
              stillUnavailable
            ) {
              button.disabled = false;
              toast(
                "La relance n’a pas été confirmée. Réessaie."
              );
            }
          }, 8000);
        }
      );
  }

  window.renderValidation =
    renderValidationV2;

  try {
    renderValidation =
      renderValidationV2;
  } catch {}
})();
