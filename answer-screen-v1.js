(() => {
  "use strict";

  let cleanupViewportBinding = null;

  function esc(value = "") {
    try {
      return escapeHtml(value);
    } catch {
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
  }

  function icon(category) {
    try {
      return categoryIcon(category);
    } catch {
      return "✨";
    }
  }

  function bindViewport(screen) {
    cleanupViewportBinding?.();

    const viewport = window.visualViewport;
    let baselineHeight =
      viewport?.height ||
      window.innerHeight ||
      document.documentElement.clientHeight;

    let raf = 0;
    let observer = null;
    let cleaned = false;

    const activeAnswerInput = () =>
      document.activeElement?.classList?.contains("asv1-input");

    const sync = () => {
      cancelAnimationFrame(raf);

      raf = requestAnimationFrame(() => {
        if (!screen.isConnected) {
          cleanup();
          return;
        }

        const height =
          viewport?.height ||
          window.innerHeight ||
          document.documentElement.clientHeight;

        if (!activeAnswerInput()) {
          baselineHeight = Math.max(
            baselineHeight,
            height
          );
        }

        const keyboardOpen =
          activeAnswerInput() &&
          baselineHeight - height > 100;

        const offsetTop =
          keyboardOpen
            ? Math.max(
                0,
                Math.round(
                  viewport?.offsetTop || 0
                )
              )
            : 0;

        screen.style.setProperty(
          "--asv1-vh",
          `${Math.max(320, Math.round(height))}px`
        );

        screen.style.setProperty(
          "--asv1-vv-top",
          `${offsetTop}px`
        );

        screen.classList.toggle(
          "is-keyboard-open",
          keyboardOpen
        );

        if (window.scrollY !== 0) {
          window.scrollTo(0,0);
        }

        if (document.documentElement.scrollTop) {
          document.documentElement.scrollTop = 0;
        }

        if (document.body.scrollTop) {
          document.body.scrollTop = 0;
        }
      });
    };

    const delayedSync = () => {
      sync();
      setTimeout(sync, 80);
      setTimeout(sync, 260);
    };

    function cleanup() {
      if (cleaned) return;
      cleaned = true;

      cancelAnimationFrame(raf);

      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener(
        "orientationchange",
        delayedSync
      );

      observer?.disconnect();

      if (cleanupViewportBinding === cleanup) {
        cleanupViewportBinding = null;
      }
    }

    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener(
      "orientationchange",
      delayedSync
    );

    observer = new MutationObserver(() => {
      if (!screen.isConnected) cleanup();
    });

    observer.observe(
      document.getElementById("app") || document.body,
      {
        childList:true,
        subtree:true
      }
    );

    cleanupViewportBinding = cleanup;

    sync();

    return {
      sync,
      delayedSync,
      cleanup
    };
  }

  function renderAnswerScreenV1() {
    clearInterval(session.timerHandle);
    cleanupViewportBinding?.();

    const state = session.state;

    if (!state || state.phase !== "round") {
      return;
    }

    const categories =
      Array.isArray(state.categories)
        ? state.categories
        : [];

    const letter =
      String(state.currentLetter || "?")
        .slice(0,1)
        .toUpperCase();

    const fields = categories
      .map((category, index) => {
        const key = answerKey(category);
        const value =
          session.localAnswers[key] || "";

        const isLast =
          index === categories.length - 1;

        return `
          <div
            class="asv1-row ${value ? "has-value" : ""}"
            data-answer-row="${index}"
          >
            <div class="asv1-category">
              <span aria-hidden="true">${icon(category)}</span>
              <strong title="${esc(category)}">${esc(category)}</strong>
            </div>

            <div class="asv1-input-wrap">
              <input
                class="answer-input asv1-input"
                data-category="${esc(category)}"
                data-answer-index="${index}"
                maxlength="60"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="words"
                spellcheck="false"
                inputmode="text"
                enterkeyhint="${isLast ? "done" : "next"}"
                aria-label="${esc(category)}"
                placeholder="Ta réponse..."
                value="${esc(value)}"
              >

              <button
                type="button"
                class="asv1-clear"
                data-clear-index="${index}"
                aria-label="Effacer la réponse"
              >×</button>
            </div>
          </div>`;
      })
      .join("");

    setScreen(`
      <main class="asv1-screen">
        <header class="asv1-header">
          <button
            class="asv1-quit"
            id="leaveGameBtn"
            type="button"
            aria-label="Quitter la partie"
          >
            <img src="/lobby-exit.png" alt="">
          </button>

          <span class="asv1-round-mini">
            <span>Manche</span>
            <strong>${Number(state.roundIndex || 0) + 1}/${Number(state.rounds || 1)}</strong>
          </span>
        </header>

        <section class="asv1-hero" aria-label="Lettre et temps restant">
          <div class="asv1-letter-card">
            <small>Lettre actuelle</small>
            <strong>${esc(letter)}</strong>
          </div>

          <div
            class="asv1-timer"
            id="timerRing"
            style="--progress:100%"
            aria-label="Temps restant"
          >
            <div>
              <strong id="timer">${Number(state.duration || 0)}</strong>
              <span>secondes</span>
            </div>
          </div>
        </section>

        <section
          class="asv1-list"
          id="answerList"
          aria-label="Réponses"
        >
          ${fields}
        </section>

        <div class="asv1-submit-wrap">
          <button
            class="asv1-submit"
            id="submitRound"
            type="button"
          >
            <span aria-hidden="true">➤</span>
            Valider mes réponses
          </button>
        </div>
      </main>
    `);

    const screen =
      document.querySelector(".asv1-screen");

    const list =
      document.getElementById("answerList");

    const inputs =
      [...document.querySelectorAll(".asv1-input")];

    const viewportBinding =
      screen
        ? bindViewport(screen)
        : null;

    const keepInputVisible = input => {
      setTimeout(() => {
        if (
          !input?.isConnected ||
          !list?.isConnected
        ) {
          return;
        }

        const row =
          input.closest(".asv1-row");

        if (!row) return;

        const rowTop =
          row.offsetTop;

        const rowBottom =
          rowTop + row.offsetHeight;

        const viewTop =
          list.scrollTop;

        const viewBottom =
          viewTop + list.clientHeight;

        const margin = 8;

        if (rowTop < viewTop + margin) {
          list.scrollTo({
            top:Math.max(
              0,
              rowTop - margin
            ),
            behavior:"auto"
          });
        } else if (
          rowBottom >
          viewBottom - margin
        ) {
          list.scrollTo({
            top:Math.max(
              0,
              rowBottom -
              list.clientHeight +
              margin
            ),
            behavior:"auto"
          });
        }

        if (window.scrollY !== 0) {
          window.scrollTo(0,0);
        }
      }, 280);
    };

    inputs.forEach((input, index) => {
      const row =
        input.closest(".asv1-row");

      input.addEventListener("focus", () => {
        row?.classList.add("is-active");
        viewportBinding?.delayedSync();
        keepInputVisible(input);
      });

      input.addEventListener("blur", () => {
        row?.classList.remove("is-active");
        viewportBinding?.delayedSync();
      });

      input.addEventListener("input", event => {
        const category =
          event.target.dataset.category;

        const value =
          event.target.value;

        session.localAnswers[
          answerKey(category)
        ] = value;

        row?.classList.toggle(
          "has-value",
          Boolean(value.trim())
        );

        socket.emit(
          "answer:update",
          {
            code:state.code,
            playerId:session.playerId,
            category,
            value
          }
        );
      });

      input.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;

        event.preventDefault();

        const next =
          inputs[index + 1];

        if (next) {
          next.focus();
          keepInputVisible(next);
        } else {
          input.blur();
        }
      });
    });

    document
      .querySelectorAll("[data-clear-index]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const index =
            Number(button.dataset.clearIndex);

          const input =
            inputs[index];

          if (!input) return;

          const category =
            input.dataset.category;

          input.value = "";

          session.localAnswers[
            answerKey(category)
          ] = "";

          input
            .closest(".asv1-row")
            ?.classList.remove("has-value");

          socket.emit(
            "answer:update",
            {
              code:state.code,
              playerId:session.playerId,
              category,
              value:""
            }
          );

          input.focus();
          keepInputVisible(input);
        });
      });

    document
      .getElementById("leaveGameBtn")
      ?.addEventListener("click", () => {
        gameExitModal(
          state,
          me(),
          "asv1-exit"
        );
      });

    document
      .getElementById("submitRound")
      ?.addEventListener("click", event => {
        if (!socket.connected) {
          return toast(
            "Connexion interrompue. Attends la reconnexion."
          );
        }

        const button = event.currentTarget;
        button.disabled = true;

        socket.emit(
          "round:submit",
          {
            code:state.code,
            playerId:session.playerId
          }
        );

        setTimeout(() => {
          const current = session.state;
          const stillWaitingForSubmit =
            current?.phase === "round" &&
            !me()?.submitted;

          if (
            socket.connected &&
            button.isConnected &&
            stillWaitingForSubmit
          ) {
            button.disabled = false;
            toast(
              "La validation n’a pas été confirmée. Réessaie."
            );
          }
        }, 8000);
      });

    const tick = () => {
      const timer =
        document.getElementById("timer");

      const ring =
        document.getElementById("timerRing");

      if (!timer) return;

      const remaining =
        Math.max(
          0,
          Number(state.roundEndsAt || 0) -
          (
            typeof serverNowMs === "function"
              ? serverNowMs()
              : Date.now()
          )
        );

      const seconds =
        Math.ceil(remaining / 1000);

      timer.textContent =
        String(seconds);

      const progress =
        Number(state.duration) > 0
          ? Math.max(
              0,
              Math.min(
                100,
                (
                  remaining /
                  (Number(state.duration) * 1000)
                ) * 100
              )
            )
          : 0;

      if (ring) {
        ring.style.setProperty(
          "--progress",
          `${progress}%`
        );

        ring.classList.toggle(
          "danger",
          seconds <= 10
        );
      }

      if (seconds <= 0) {
        document
          .querySelectorAll(
            ".asv1-input,.asv1-clear,#submitRound"
          )
          .forEach(element => {
            element.disabled = true;
          });
      }
    };

    tick();

    session.timerHandle =
      setInterval(tick, 100);
  }

  window.PtitBacAnswerScreen = Object.freeze({
    render: renderAnswerScreenV1
  });
})();
