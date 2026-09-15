(() => {
  "use strict";

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const SEGMENT = 360 / LETTERS.length;

  const runtime = {
    rotation: 0,
    animating: false,
    animationFrame: 0,
    lastVersion: null,
    activeCode: "",
    spinKey: "",
    dragged: false,
    spinAudio: null,
    spinAudioUnlocked: false,
    spinAudioStartedAt: 0
  };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function adminCoins() {
    const st = window.PtitBacAdminDisplayState;
    if (st?.admin && st?.infiniteCoins) return "∞";
    if (document.documentElement.classList.contains("ptb-admin-infinite-coins")) return "∞";
    return typeof getCoins === "function" ? String(getCoins()) : "0";
  }

  /* =========================================================
     Effets visuels de la roue
     - étoiles multicolores pendant la rotation
     - burst + rayons + pop de la lettre à l'arrêt
     - animations limitées à transform/opacity pour rester fluides
     ========================================================= */

  const SPIN_STARS = [
    ["8%","23%","14px","0s","1.12s","#b45cff","-10px","-8px"],
    ["19%","9%","11px",".18s","1.34s","#55d8ff","-4px","-11px"],
    ["36%","4%","15px",".42s","1.22s","#ffd95e","3px","-10px"],
    ["58%","5%","12px",".08s","1.45s","#6cf5bb","6px","-11px"],
    ["79%","12%","16px",".31s","1.18s","#ff72ca","10px","-7px"],
    ["92%","30%","11px",".55s","1.32s","#7c78ff","11px","-3px"],
    ["95%","52%","15px",".15s","1.26s","#ffd45c","12px","3px"],
    ["87%","75%","12px",".49s","1.41s","#54dfff","10px","8px"],
    ["69%","89%","16px",".25s","1.20s","#ff72cb","6px","11px"],
    ["47%","94%","11px",".62s","1.30s","#78f1ad","0px","12px"],
    ["27%","89%","14px",".11s","1.38s","#ffd95e","-6px","11px"],
    ["10%","75%","11px",".38s","1.16s","#9d69ff","-11px","7px"],
    ["5%","52%","16px",".68s","1.28s","#59dfff","-12px","2px"],
    ["14%","40%","10px",".23s","1.47s","#ff7bc8","-10px","0px"],
    ["84%","42%","10px",".74s","1.36s","#6cf5bb","10px","0px"],
    ["52%","11%","9px",".35s","1.55s","#ffffff","3px","-10px"]
  ];

  const BURST_STARS = [
    ["50%","1%","22px","0s","#ffd858","0px","-38px"],
    ["71%","7%","18px",".04s","#5ee6ff","25px","-31px"],
    ["89%","22%","21px",".09s","#ff72c9","36px","-22px"],
    ["98%","48%","17px",".13s","#8b69ff","42px","0px"],
    ["89%","74%","20px",".07s","#65efb3","35px","27px"],
    ["69%","91%","18px",".15s","#ffd95e","24px","37px"],
    ["47%","98%","22px",".02s","#ff78c8","0px","43px"],
    ["24%","91%","17px",".11s","#5fddff","-27px","35px"],
    ["8%","76%","21px",".06s","#a76cff","-37px","27px"],
    ["2%","51%","17px",".16s","#ffd95e","-43px","1px"],
    ["10%","26%","20px",".03s","#68f0b6","-36px","-25px"],
    ["28%","8%","17px",".12s","#ff72c9","-24px","-34px"]
  ];

  function wheelFxMarkup() {
    const spinStars =
      SPIN_STARS.map(
        ([x,y,size,delay,duration,color,dx,dy], index) => `
          <i
            class="pbw1-fx-star pbw1-fx-spin-star"
            style="
              --fx-x:${x};
              --fx-y:${y};
              --fx-size:${size};
              --fx-delay:${delay};
              --fx-duration:${duration};
              --fx-color:${color};
              --fx-dx:${dx};
              --fx-dy:${dy};
              --fx-rot:${index % 2 ? "38deg" : "-34deg"};
            "
          ></i>
        `
      ).join("");

    const burstStars =
      BURST_STARS.map(
        ([x,y,size,delay,color,dx,dy], index) => `
          <i
            class="pbw1-fx-star pbw1-fx-burst-star"
            style="
              --fx-x:${x};
              --fx-y:${y};
              --fx-size:${size};
              --fx-delay:${delay};
              --fx-color:${color};
              --fx-dx:${dx};
              --fx-dy:${dy};
              --fx-rot:${index % 2 ? "78deg" : "-72deg"};
            "
          ></i>
        `
      ).join("");

    return `
      <div class="pbw1-fx-layer" aria-hidden="true">
        <div class="pbw1-fx-spin">
          ${spinStars}
        </div>

        <div class="pbw1-fx-land">
          <div class="pbw1-fx-rays"></div>
          <div class="pbw1-fx-glow"></div>
          ${burstStars}
        </div>
      </div>
    `;
  }

  /* =========================================================
     Son de la roue — V4 iOS
     Une seule piste audio de 3,5 s jouée une fois par rotation.
     Aucun play() dans requestAnimationFrame => roue fluide.
     ========================================================= */

  const WHEEL_SPIN_AUDIO = "/letter-wheel-spin.wav";

  function ensureSpinAudio() {
    if (runtime.spinAudio) {
      return runtime.spinAudio;
    }

    if (typeof Audio !== "function") {
      return null;
    }

    const audio =
      new Audio(WHEEL_SPIN_AUDIO);

    audio.preload = "auto";
    audio.volume = 0.85;
    audio.setAttribute(
      "playsinline",
      ""
    );

    runtime.spinAudio = audio;

    return audio;
  }

  function primeSpinAudio() {
    const audio =
      ensureSpinAudio();

    if (!audio) return;

    try {
      audio.load?.();
    } catch {}
  }

  function stopSpinSound() {
    const audio =
      runtime.spinAudio;

    runtime.spinAudioStartedAt = 0;

    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }

  function startSpinSoundFromGesture() {
    const audio =
      ensureSpinAudio();

    if (!audio) return false;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.68;

      runtime.spinAudioStartedAt =
        performance.now();

      const promise =
        audio.play();

      if (
        promise &&
        typeof promise.then ===
          "function"
      ) {
        promise
          .then(() => {
            runtime.spinAudioUnlocked =
              true;
          })
          .catch(() => {
            runtime.spinAudioStartedAt =
              0;
          });
      } else {
        runtime.spinAudioUnlocked =
          true;
      }

      return true;
    } catch {
      runtime.spinAudioStartedAt = 0;
      return false;
    }
  }

  function playSpinSound(duration) {
    if (duration < 0.2) return;

    const audio =
      ensureSpinAudio();

    if (!audio) return;

    /*
      Si le son a déjà été lancé par le clic/tap qui a demandé
      la roue, surtout ne pas le couper/rejouer quand le serveur
      renvoie la lettre. C'est ce qui rend le son fiable sur iOS
      et garde la roue fluide.
    */
    const gestureStartedRecently =
      runtime.spinAudioStartedAt > 0 &&
      performance.now() -
        runtime.spinAudioStartedAt <
        1200 &&
      !audio.paused;

    if (gestureStartedRecently) {
      return;
    }

    try {
      audio.currentTime = 0;
      audio.volume = 0.68;

      const promise =
        audio.play();

      runtime.spinAudioStartedAt =
        performance.now();

      if (
        promise &&
        typeof promise.catch ===
          "function"
      ) {
        promise.catch(() => {
          runtime.spinAudioStartedAt =
            0;
        });
      }
    } catch {
      runtime.spinAudioStartedAt = 0;
    }
  }

  /*
    On prépare le son dès une interaction dans l'application,
    et surtout lors du bouton "Lancer la roue".
  */
  ["pointerdown", "touchstart", "click"]
    .forEach(eventName => {
      window.addEventListener(
        eventName,
        primeSpinAudio,
        {
          once:true,
          passive:true
        }
      );
    });

  function stopAnimation(stopSound = true) {
    if (runtime.animationFrame) {
      cancelAnimationFrame(
        runtime.animationFrame
      );
    }

    runtime.animationFrame = 0;
    runtime.animating = false;

    if (stopSound) {
      stopSpinSound();
    }
  }

  function setRotation(value) {
    runtime.rotation = value;

    const wheel =
      document.getElementById("pbw1Wheel");

    if (!wheel) return;

    wheel.style.setProperty(
      "--pbw1-rotation",
      `${value}deg`
    );

    wheel.style.transform =
      `rotate(${value}deg)`;
  }

  function exactTarget(
    letter,
    start,
    direction = 1
  ) {
    const index =
      Math.max(
        0,
        LETTERS.indexOf(letter)
      );

    // Pointer is at 12 o'clock. Sector centers start at 0deg.
    const desired =
      -index * SEGMENT;

    if (direction >= 0) {
      let target = desired;

      while (
        target <= start + 1440
      ) {
        target += 360;
      }

      return target;
    }

    let target = desired;

    while (
      target >= start - 1440
    ) {
      target -= 360;
    }

    return target;
  }

  function animateToLetter(
    letter,
    version
  ) {
    const wheel =
      document.getElementById("pbw1Wheel");

    const zone =
      document.getElementById("pbw1WheelZone");

    const actions =
      document.getElementById("pbw1Actions");

    if (!wheel) return;

    stopAnimation(false);
    primeSpinAudio();

    runtime.animating = true;

    zone?.classList.remove(
      "is-landed"
    );

    zone?.classList.add(
      "is-spinning"
    );

    const currentCenter =
      document.getElementById(
        "pbw1CenterLetter"
      );

    currentCenter?.classList.remove(
      "pbw1-letter-reveal"
    );

    actions?.classList.remove(
      "is-visible"
    );

    const start =
      runtime.rotation || 0;

    const direction = 1;

    const base =
      exactTarget(
        letter,
        start,
        direction
      );

    const target =
      base + 360 * 3;

    const duration =
      window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      ).matches
        ? 1
        : 3500;

    const started =
      performance.now();

    playSpinSound(
      duration / 1000
    );

    const tick = now => {
      if (
        session.state?.phase !==
          "letter_selection" ||
        !document.getElementById(
          "pbw1Wheel"
        )
      ) {
        stopAnimation();
        return;
      }

      const t =
        clamp(
          (now - started) / duration,
          0,
          1
        );

      // Garde une rotation visible jusqu'à la toute fin.
      const eased =
        1 - Math.pow(1 - t, 3);

      // Très léger rebond seulement sur les 3% finaux.
      let value =
        start +
        (target - start) * eased;

      if (t > 0.97) {
        const local =
          (t - 0.97) / 0.03;

        value +=
          Math.sin(
            local * Math.PI
          ) * 0.65;
      }

      setRotation(value);

      if (t < 1) {
        runtime.animationFrame =
          requestAnimationFrame(tick);

        return;
      }

      setRotation(target);

      // Affiche la lettre sur la même frame que l'arrêt exact de la roue.
      const center =
        document.getElementById(
          "pbw1CenterLetter"
        );

      const landedZone =
        document.getElementById(
          "pbw1WheelZone"
        );

      if (center) {
        center.textContent = letter;
        center.classList.remove(
          "pbw1-letter-reveal"
        );

        // Force un nouveau départ de l'animation même après une relance.
        void center.offsetWidth;

        center.classList.add(
          "pbw1-letter-reveal"
        );
      }

      runtime.animating = false;
      runtime.lastVersion = version;

      landedZone?.classList.remove(
        "is-spinning"
      );

      landedZone?.classList.remove(
        "is-landed"
      );

      if (landedZone) {
        // Même principe : permet de rejouer le burst après un reroll.
        void landedZone.offsetWidth;
        landedZone.classList.add(
          "is-landed"
        );
      }

      const revealDelay =
        window.matchMedia?.(
          "(prefers-reduced-motion: reduce)"
        ).matches
          ? 0
          : 740;

      window.setTimeout(
        () => {
          if (
            session.state?.phase !==
            "letter_selection"
          ) {
            return;
          }

          document
            .getElementById(
              "pbw1Actions"
            )
            ?.classList.add(
              "is-visible"
            );
        },
        revealDelay
      );
    };

    runtime.animationFrame =
      requestAnimationFrame(tick);
  }

  function renderLetterWheelV1() {
    clearInterval(
      session.timerHandle
    );

    const state =
      session.state;

    const user =
      me();

    if (
      !state ||
      state.phase !==
        "letter_selection"
    ) {
      return render();
    }

    const contextKey =
      JSON.stringify([
        state.code,
        state.gameSessionId,
        state.roundIndex
      ]);

    if (
      runtime.activeCode !==
        contextKey ||
      !state.pendingLetter
    ) {
      stopAnimation();

      runtime.lastVersion = null;
      runtime.spinKey = "";
      runtime.rotation = 0;
    }

    runtime.activeCode =
      contextKey;

    const chooser =
      state.players.find(
        p =>
          p.id ===
          state.letterChooserPlayerId
      );

    const isChooser =
      user?.id ===
      state.letterChooserPlayerId;

    const selectedLetter =
      String(
        state.pendingLetter || ""
      ).slice(0, 1);

    const version =
      Number(
        state.letterSpinVersion || 0
      );

    const rerollCost =
      Number(
        state.letterRerollCost || 10
      );

    const canReroll =
      typeof getCoins !== "function" ||
      getCoins() >= rerollCost;

    const sectors =
      LETTERS.map((_, i) => {
        const start =
          i * SEGMENT;

        const end =
          (i + 1) * SEGMENT;

        const color =
          i % 2
            ? "#242166"
            : "#7534c9";

        return (
          `${color} ${start}deg ${end}deg`
        );
      }).join(",");

    const labels =
      LETTERS.map(
        (letter, i) => {
          const angle =
            i * SEGMENT;

          return `
            <span
              class="pbw1-letter"
              style="--pbw1-angle:${angle}deg"
            >
              <b>${letter}</b>
            </span>
          `;
        }
      ).join("");

    const chooserName =
      chooser?.name ||
      "Un joueur";

    setScreen(`
      <main class="pbw1-screen letter-prototype">
        <header class="pbw1-top">
          <button
            class="pbw1-exit"
            id="pbw1Exit"
            type="button"
            aria-label="Quitter"
          >
            <img
              src="/lobby-exit.png"
              alt=""
            >
          </button>

          <img
            class="pbw1-brand"
            src="/ptitbac.logo.png"
            alt="P’tit Bac"
            width="62"
            height="52"
          >

          <div class="pbw1-wallet">
            <img
              src="/coin.png"
              alt=""
            >
            <strong>${adminCoins()}</strong>
          </div>
        </header>

        <nav
          class="pbw1-steps"
          aria-label="Étapes de la manche"
        >
          <span>Catégories</span>
          <i>•</i>
          <strong aria-current="step">
            Lettre
          </strong>
          <i>•</i>
          <span>À vous de jouer</span>
        </nav>

        <section class="pbw1-chooser">
          <div class="pbw1-lightning">
            <img
              src="/lightning.png"
              alt=""
            >
          </div>

          <div class="pbw1-chooser-copy">
            <small>C’est à</small>
            <strong>
              ${escapeHtml(chooserName)}
            </strong>
            <span>
              de lancer la roue
            </span>
          </div>
        </section>

        <section
          class="pbw1-wheel-zone ${
            isChooser &&
            !selectedLetter
              ? "is-ready"
              : ""
          }"
          id="pbw1WheelZone"
          ${
            isChooser &&
            !selectedLetter
              ? 'role="button" tabindex="0" aria-label="Lancer la roue"'
              : ""
          }
        >
          ${wheelFxMarkup()}

          <div
            class="pbw1-pointer"
            aria-hidden="true"
          ></div>

          <div class="pbw1-wheel-shell">
            <div
              class="pbw1-wheel"
              id="pbw1Wheel"
              style="
                --pbw1-sectors:
                  conic-gradient(
                    from -${SEGMENT / 2}deg,
                    ${sectors}
                  );
                --pbw1-rotation:
                  ${runtime.rotation}deg
              "
            >
              ${labels}
            </div>

            <div
              class="pbw1-center"
              id="pbw1Center"
            >
              <strong
                id="pbw1CenterLetter"
                aria-live="polite"
              >
                ↻
              </strong>
            </div>
          </div>
        </section>

        ${
          isChooser &&
          selectedLetter
            ? `
              <section
                class="pbw1-actions ${
                  runtime.lastVersion ===
                  version
                    ? "is-visible"
                    : ""
                }"
                id="pbw1Actions"
              >
                ${
                  state.mode !== "quick"
                    ? `
                      <button
                        class="pbw1-reroll"
                        id="pbw1Reroll"
                        type="button"
                        ${
                          canReroll
                            ? ""
                            : "disabled"
                        }
                      >
                        <span>
                          ↻ Relancer
                        </span>

                        <b>
                          <img
                            src="/coin.png"
                            alt=""
                          >
                          ${rerollCost}
                        </b>
                      </button>
                    `
                    : ""
                }

                <button
                  class="pbw1-confirm"
                  id="pbw1Confirm"
                  type="button"
                >
                  Valider la lettre
                  ${escapeHtml(
                    selectedLetter
                  )}
                  <span>→</span>
                </button>
              </section>
            `
            : isChooser
              ? `
                <section
                  class="pbw1-actions is-visible"
                >
                  <button
                    class="pbw1-confirm"
                    id="pbw1Launch"
                    type="button"
                  >
                    Lancer la roue
                    <span>↻</span>
                  </button>
                </section>
              `
              : `
                <p
                  class="pbw1-wait"
                  role="status"
                >
                  ${
                    selectedLetter
                      ? "La lettre va être validée…"
                      : `En attente de ${escapeHtml(
                          chooserName
                        )}…`
                  }
                </p>
              `
        }
      </main>
    `);

    setRotation(
      runtime.rotation
    );

    document
      .getElementById(
        "pbw1Exit"
      )
      ?.addEventListener(
        "click",
        () =>
          gameExitModal(
            state,
            user,
            "pbw1"
          )
      );

    if (selectedLetter) {
      if (
        runtime.lastVersion !==
        version
      ) {
        const spinKey =
          version +
          ":" +
          selectedLetter;

        if (
          !runtime.animating ||
          runtime.spinKey !==
            spinKey
        ) {
          runtime.spinKey =
            spinKey;

          animateToLetter(
            selectedLetter,
            version
          );
        }
      } else {
        document
          .getElementById(
            "pbw1Actions"
          )
          ?.classList.add(
            "is-visible"
          );

        const center =
          document.getElementById(
            "pbw1CenterLetter"
          );

        if (center) {
          center.textContent =
            selectedLetter;
        }
      }
    }

    if (
      isChooser &&
      !selectedLetter
    ) {
      const zone =
        document.getElementById(
          "pbw1WheelZone"
        );

      const wheel =
        document.getElementById(
          "pbw1Wheel"
        );

      let dragging = false;
      let moved = false;
      let previousAngle = 0;
      let localRotation =
        runtime.rotation;

      const pointerAngle = e => {
        const rect =
          zone.getBoundingClientRect();

        const cx =
          rect.left +
          rect.width / 2;

        const cy =
          rect.top +
          rect.height / 2;

        return (
          Math.atan2(
            e.clientY - cy,
            e.clientX - cx
          ) *
          180 /
          Math.PI
        );
      };

      const shortestDelta =
        (a, b) => {
          let d = a - b;

          while (d > 180) {
            d -= 360;
          }

          while (d < -180) {
            d += 360;
          }

          return d;
        };

      const launch = () => {
        if (
          zone.classList.contains(
            "is-requesting"
          )
        ) {
          return;
        }

        startSpinSoundFromGesture();

        zone.classList.add(
          "is-requesting"
        );

        const button =
          document.getElementById(
            "pbw1Launch"
          );

        if (button) {
          button.disabled = true;
          button.textContent =
            "Lancement…";
        }

        socket.emit(
          "game:spinLetter",
          {
            code:state.code,
            playerId:
              session.playerId
          }
        );
      };

      document
        .getElementById(
          "pbw1Launch"
        )
        ?.addEventListener(
          "click",
          launch
        );

      zone.addEventListener(
        "pointerdown",
        e => {
          if (
            runtime.animating
          ) {
            return;
          }

          primeSpinAudio();

          dragging = true;
          moved = false;

          previousAngle =
            pointerAngle(e);

          localRotation =
            runtime.rotation;

          zone.setPointerCapture?.(
            e.pointerId
          );

          e.preventDefault();
        }
      );

      zone.addEventListener(
        "pointermove",
        e => {
          if (!dragging) return;

          const angle =
            pointerAngle(e);

          const delta =
            shortestDelta(
              angle,
              previousAngle
            );

          if (
            Math.abs(delta) >
            0.8
          ) {
            moved = true;
          }

          localRotation +=
            delta;

          previousAngle =
            angle;

          setRotation(
            localRotation
          );

          e.preventDefault();
        }
      );

      const finish = e => {
        if (!dragging) return;

        dragging = false;

        zone.releasePointerCapture?.(
          e.pointerId
        );

        launch();
      };

      zone.addEventListener(
        "pointerup",
        finish
      );

      zone.addEventListener(
        "pointercancel",
        () => {
          dragging = false;
          moved = true;
        }
      );

      zone.addEventListener(
        "click",
        () => {
          if (!moved) {
            launch();
          }
        }
      );

      zone.addEventListener(
        "keydown",
        e => {
          if (
            e.key !== "Enter" &&
            e.key !== " "
          ) {
            return;
          }

          e.preventDefault();
          launch();
        }
      );

      if (wheel) {
        wheel.style.touchAction =
          "none";
      }
    }

    document
      .getElementById(
        "pbw1Reroll"
      )
      ?.addEventListener(
        "click",
        () => {
          if (
            runtime.animating ||
            runtime.lastVersion !==
              version
          ) {
            return;
          }

          if (!canReroll) {
            return toast(
              `Il te faut ${rerollCost} pièces pour relancer.`
            );
          }

          startSpinSoundFromGesture();

          const reroll =
            document.getElementById(
              "pbw1Reroll"
            );

          const confirm =
            document.getElementById(
              "pbw1Confirm"
            );

          if (reroll) {
            reroll.disabled = true;
          }

          if (confirm) {
            confirm.disabled = true;
          }

          socket.emit(
            "game:rerollLetter",
            {
              code:state.code,
              playerId:
                session.playerId
            }
          );
        }
      );

    document
      .getElementById(
        "pbw1Confirm"
      )
      ?.addEventListener(
        "click",
        () => {
          if (
            runtime.animating ||
            runtime.lastVersion !==
              version
          ) {
            return;
          }

          const reroll =
            document.getElementById(
              "pbw1Reroll"
            );

          const confirm =
            document.getElementById(
              "pbw1Confirm"
            );

          if (reroll) {
            reroll.disabled = true;
          }

          if (confirm) {
            confirm.disabled = true;
          }

          socket.emit(
            "game:confirmLetter",
            {
              code:state.code,
              playerId:
                session.playerId
            }
          );
        }
      );
  }

  // Nouveau point d'entrée unique pour la phase letter_selection.
  window.renderLetterSelection =
    renderLetterWheelV1;

  try {
    renderLetterSelection =
      renderLetterWheelV1;
  } catch {}
})();
