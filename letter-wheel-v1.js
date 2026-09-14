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
    audioContext: null,
    spinSoundBuffer: null,
    spinSoundSource: null
  };

  const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function adminCoins() {
    const st = window.PtitBacAdminDisplayState;
    if (st?.admin && st?.infiniteCoins) return "∞";
    if (document.documentElement.classList.contains("ptb-admin-infinite-coins")) return "∞";
    return typeof getCoins === "function" ? String(getCoins()) : "0";
  }

  /* =========================================================
     Son de la roue — version fluide
     Un seul AudioBuffer est joué pendant toute la rotation.
     Aucun son n'est déclenché dans requestAnimationFrame.
     ========================================================= */

  function getWheelAudioContext() {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!runtime.audioContext) {
      try {
        runtime.audioContext =
          new AudioContextClass();
      } catch {
        return null;
      }
    }

    return runtime.audioContext;
  }

  function primeWheelAudio() {
    const context =
      getWheelAudioContext();

    if (!context) return;

    try {
      if (context.state === "suspended") {
        context.resume().catch(() => {});
      }

      // Déblocage iOS/Safari pendant un geste utilisateur.
      const buffer =
        context.createBuffer(
          1,
          1,
          context.sampleRate
        );

      const source =
        context.createBufferSource();

      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
    } catch {}
  }

  function buildSpinSoundBuffer(duration) {
    const context =
      getWheelAudioContext();

    if (!context) return null;

    const sampleRate =
      context.sampleRate;

    const frameCount =
      Math.max(
        1,
        Math.ceil(
          duration * sampleRate
        )
      );

    const buffer =
      context.createBuffer(
        1,
        frameCount,
        sampleRate
      );

    const data =
      buffer.getChannelData(0);

    /*
      Clic doux de roue :
      - rapide au début
      - ralentit progressivement
      - son plus grave et moins métallique que l'ancienne version
    */
    let clickTime = 0.10;
    let clickIndex = 0;

    while (
      clickTime <
      duration - 0.10
    ) {
      const progress =
        clickTime / duration;

      const interval =
        0.055 +
        0.145 *
          Math.pow(progress, 2.15);

      const clickFrames =
        Math.floor(
          0.020 * sampleRate
        );

      const startFrame =
        Math.floor(
          clickTime * sampleRate
        );

      const baseFrequency =
        520 -
        90 * progress +
        (clickIndex % 2 ? 22 : -12);

      const amplitude =
        0.105 +
        0.035 * progress;

      for (
        let i = 0;
        i < clickFrames;
        i += 1
      ) {
        const frame =
          startFrame + i;

        if (
          frame >=
          frameCount
        ) {
          break;
        }

        const t =
          i / sampleRate;

        const env =
          Math.exp(
            -t * 150
          );

        // Deux harmoniques très courtes = petit "toc" doux.
        const tone =
          Math.sin(
            2 *
            Math.PI *
            baseFrequency *
            t
          ) *
          0.72 +
          Math.sin(
            2 *
            Math.PI *
            baseFrequency *
            1.68 *
            t
          ) *
          0.28;

        data[frame] +=
          tone *
          env *
          amplitude;
      }

      clickTime += interval;
      clickIndex += 1;
    }

    /*
      Arrêt discret : un petit "toc" grave, pas de bip/ding.
    */
    const landingStart =
      Math.max(
        0,
        Math.floor(
          (duration - 0.075) *
          sampleRate
        )
      );

    const landingFrames =
      Math.floor(
        0.055 *
        sampleRate
      );

    for (
      let i = 0;
      i < landingFrames;
      i += 1
    ) {
      const frame =
        landingStart + i;

      if (
        frame >=
        frameCount
      ) {
        break;
      }

      const t =
        i / sampleRate;

      const env =
        Math.exp(
          -t * 72
        );

      data[frame] +=
        Math.sin(
          2 *
          Math.PI *
          310 *
          t
        ) *
        env *
        0.15;
    }

    return buffer;
  }

  function stopSpinSound() {
    const source =
      runtime.spinSoundSource;

    runtime.spinSoundSource =
      null;

    if (!source) return;

    try {
      source.stop();
    } catch {}

    try {
      source.disconnect();
    } catch {}
  }

  function playSpinSound(duration) {
    const context =
      getWheelAudioContext();

    if (
      !context ||
      duration < 0.2
    ) {
      return;
    }

    stopSpinSound();

    if (
      context.state ===
      "suspended"
    ) {
      context.resume().catch(
        () => {}
      );
    }

    /*
      Le buffer n'est calculé qu'une fois pour la durée normale
      de 3,5 s. Ensuite chaque tour ne lance qu'une source audio.
    */
    if (
      !runtime.spinSoundBuffer ||
      Math.abs(
        runtime.spinSoundBuffer.duration -
        duration
      ) > 0.08
    ) {
      runtime.spinSoundBuffer =
        buildSpinSoundBuffer(
          duration
        );
    }

    if (
      !runtime.spinSoundBuffer ||
      context.state !== "running"
    ) {
      return;
    }

    try {
      const source =
        context.createBufferSource();

      const gain =
        context.createGain();

      gain.gain.value = 0.78;

      source.buffer =
        runtime.spinSoundBuffer;

      source.connect(gain);
      gain.connect(
        context.destination
      );

      source.onended = () => {
        if (
          runtime.spinSoundSource ===
          source
        ) {
          runtime.spinSoundSource =
            null;
        }

        try {
          source.disconnect();
          gain.disconnect();
        } catch {}
      };

      runtime.spinSoundSource =
        source;

      source.start();
    } catch {
      runtime.spinSoundSource =
        null;
    }
  }

  /*
    Débloque WebAudio dès la première interaction avec le jeu.
    Le bouton "Lancer la roue" rappelle aussi primeWheelAudio().
  */
  ["pointerdown", "touchstart", "click", "keydown"]
    .forEach(eventName => {
      window.addEventListener(
        eventName,
        primeWheelAudio,
        {
          once:true,
          passive:
            eventName !== "keydown"
        }
      );
    });

  function stopAnimation() {
    if (runtime.animationFrame) {
      cancelAnimationFrame(
        runtime.animationFrame
      );
    }

    runtime.animationFrame = 0;
    runtime.animating = false;
    stopSpinSound();
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

    stopAnimation();
    primeWheelAudio();

    runtime.animating = true;

    zone?.classList.add(
      "is-spinning"
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

      if (center) {
        center.textContent = letter;
      }

      runtime.animating = false;
      runtime.lastVersion = version;

      document
        .getElementById(
          "pbw1WheelZone"
        )
        ?.classList.remove(
          "is-spinning"
        );

      document
        .getElementById(
          "pbw1WheelZone"
        )
        ?.classList.add(
          "is-landed"
        );

      document
        .getElementById(
          "pbw1Actions"
        )
        ?.classList.add(
          "is-visible"
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

        primeWheelAudio();

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

          primeWheelAudio();

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
          primeWheelAudio();
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

          primeWheelAudio();

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
