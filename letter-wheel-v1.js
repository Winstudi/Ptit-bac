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
    lastSoundSegment: null,
    lastSoundAt: 0,
    tickAudioPool: [],
    tickAudioIndex: 0,
    landingAudio: null,
    mediaAudioReady: false
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
     Son de la roue
     - aucun fichier audio supplémentaire
     - petits clics synchronisés avec les secteurs
     ========================================================= */

  const WHEEL_TICK_AUDIO =
    "data:audio/wav;base64,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";

  const WHEEL_LANDING_AUDIO =
    "data:audio/wav;base64,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";

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

  function ensureMediaAudio() {
    if (
      runtime.tickAudioPool.length &&
      runtime.landingAudio
    ) {
      return;
    }

    if (typeof Audio !== "function") {
      return;
    }

    runtime.tickAudioPool =
      Array.from(
        { length: 5 },
        () => {
          const audio =
            new Audio(WHEEL_TICK_AUDIO);

          audio.preload = "auto";
          audio.volume = 0.82;
          audio.setAttribute(
            "playsinline",
            ""
          );

          return audio;
        }
      );

    runtime.landingAudio =
      new Audio(
        WHEEL_LANDING_AUDIO
      );

    runtime.landingAudio.preload =
      "auto";

    runtime.landingAudio.volume =
      0.9;

    runtime.landingAudio.setAttribute(
      "playsinline",
      ""
    );
  }

  function unlockMediaAudio() {
    ensureMediaAudio();

    const all = [
      ...runtime.tickAudioPool,
      runtime.landingAudio
    ].filter(Boolean);

    if (!all.length) return;

    /*
      iOS Safari demande qu'un média soit lancé une première fois
      pendant une interaction utilisateur. On le lance ici en
      silencieux puis on le remet à zéro.
    */
    all.forEach(audio => {
      try {
        audio.muted = true;
        audio.currentTime = 0;

        const promise =
          audio.play();

        if (
          promise &&
          typeof promise.then === "function"
        ) {
          promise
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
              runtime.mediaAudioReady =
                true;
            })
            .catch(() => {
              audio.muted = false;
            });
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          runtime.mediaAudioReady = true;
        }
      } catch {
        audio.muted = false;
      }
    });
  }

  function primeWheelAudio() {
    unlockMediaAudio();

    const context =
      getWheelAudioContext();

    if (!context) return;

    try {
      if (
        context.state ===
        "suspended"
      ) {
        context.resume().catch(
          () => {}
        );
      }

      /*
        Débloque aussi Web Audio sur iOS avec un buffer muet
        réellement démarré pendant le geste utilisateur.
      */
      const buffer =
        context.createBuffer(
          1,
          1,
          22050
        );

      const source =
        context.createBufferSource();

      source.buffer = buffer;
      source.connect(
        context.destination
      );
      source.start(0);
    } catch {}
  }

  function playWebAudioTick(
    intensity = 1
  ) {
    const context =
      getWheelAudioContext();

    if (
      !context ||
      context.state !== "running"
    ) {
      return;
    }

    const now =
      context.currentTime;

    const oscillator =
      context.createOscillator();

    const gain =
      context.createGain();

    oscillator.type = "triangle";

    oscillator.frequency
      .setValueAtTime(
        1200 +
          180 * intensity,
        now
      );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain
      .exponentialRampToValueAtTime(
        0.09 * intensity,
        now + 0.002
      );

    gain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        now + 0.03
      );

    oscillator.connect(gain);
    gain.connect(
      context.destination
    );

    oscillator.start(now);
    oscillator.stop(
      now + 0.032
    );
  }

  function playWebAudioLanding() {
    const context =
      getWheelAudioContext();

    if (
      !context ||
      context.state !== "running"
    ) {
      return;
    }

    const now =
      context.currentTime;

    const oscillator =
      context.createOscillator();

    const gain =
      context.createGain();

    oscillator.type = "sine";

    oscillator.frequency
      .setValueAtTime(
        520,
        now
      );

    oscillator.frequency
      .exponentialRampToValueAtTime(
        340,
        now + 0.09
      );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain
      .exponentialRampToValueAtTime(
        0.1,
        now + 0.004
      );

    gain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        now + 0.1
      );

    oscillator.connect(gain);
    gain.connect(
      context.destination
    );

    oscillator.start(now);
    oscillator.stop(
      now + 0.11
    );
  }

  function playWheelTick(
    intensity = 1
  ) {
    ensureMediaAudio();

    const pool =
      runtime.tickAudioPool;

    if (!pool.length) {
      playWebAudioTick(
        intensity
      );
      return;
    }

    const audio =
      pool[
        runtime.tickAudioIndex %
        pool.length
      ];

    runtime.tickAudioIndex += 1;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;

      audio.volume =
        clamp(
          0.72 +
            intensity * 0.2,
          0,
          1
        );

      const promise =
        audio.play();

      if (
        promise &&
        typeof promise.catch ===
          "function"
      ) {
        promise.catch(
          () =>
            playWebAudioTick(
              intensity
            )
        );
      }
    } catch {
      playWebAudioTick(
        intensity
      );
    }
  }

  function playWheelLanding() {
    ensureMediaAudio();

    const audio =
      runtime.landingAudio;

    if (!audio) {
      playWebAudioLanding();
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = 0.95;

      const promise =
        audio.play();

      if (
        promise &&
        typeof promise.catch ===
          "function"
      ) {
        promise.catch(
          playWebAudioLanding
        );
      }
    } catch {
      playWebAudioLanding();
    }
  }

  function wheelSegmentForRotation(value) {
    const normalized =
      ((value % 360) + 360) % 360;

    return Math.floor(
      (normalized + SEGMENT / 2) /
      SEGMENT
    ) % LETTERS.length;
  }

  function syncWheelSound(
    rotation,
    progress = 0,
    nowMs = performance.now()
  ) {
    const segment =
      wheelSegmentForRotation(rotation);

    if (runtime.lastSoundSegment === null) {
      runtime.lastSoundSegment = segment;
      return;
    }

    if (
      segment ===
      runtime.lastSoundSegment
    ) {
      return;
    }

    runtime.lastSoundSegment = segment;

    /*
      Au début la roue traverse plusieurs secteurs très vite.
      Ce petit délai évite un son agressif tout en gardant
      l'effet mécanique de la roue.
    */
    if (
      nowMs - runtime.lastSoundAt <
      34
    ) {
      return;
    }

    runtime.lastSoundAt = nowMs;

    const intensity =
      1 - clamp(progress, 0, 1) * 0.32;

    playWheelTick(intensity);
  }

  /*
    iOS/Safari exige qu'un son soit débloqué par une interaction
    de l'utilisateur. Une première interaction avec le jeu suffit.
  */
  window.addEventListener(
    "pointerdown",
    primeWheelAudio,
    { once:true }
  );

  window.addEventListener(
    "touchstart",
    primeWheelAudio,
    { once:true, passive:true }
  );

  window.addEventListener(
    "keydown",
    primeWheelAudio,
    { once:true }
  );

  /*
    Déblocage audio global : une interaction n'importe où dans le jeu
    prépare le son avant d'arriver sur la roue.
  */
  ["pointerdown", "touchstart", "click"].forEach(
    eventName => {
      window.addEventListener(
        eventName,
        primeWheelAudio,
        {
          once:true,
          passive:true
        }
      );
    }
  );

  function stopAnimation() {
    if (runtime.animationFrame) {
      cancelAnimationFrame(
        runtime.animationFrame
      );
    }

    runtime.animationFrame = 0;
    runtime.animating = false;
    runtime.lastSoundSegment = null;
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
    runtime.lastSoundSegment =
      wheelSegmentForRotation(
        runtime.rotation || 0
      );

    runtime.lastSoundAt =
      performance.now();

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
      syncWheelSound(
        value,
        t,
        now
      );

      if (t < 1) {
        runtime.animationFrame =
          requestAnimationFrame(tick);

        return;
      }

      setRotation(target);
      playWheelLanding();

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
      runtime.lastSoundSegment = null;

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

          runtime.lastSoundSegment =
            wheelSegmentForRotation(
              localRotation
            );

          runtime.lastSoundAt =
            performance.now();

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

          syncWheelSound(
            localRotation,
            0,
            performance.now()
          );

          e.preventDefault();
        }
      );

      const finish = e => {
        if (!dragging) return;

        dragging = false;

        runtime.lastSoundSegment =
          null;

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

          runtime.lastSoundSegment =
            null;
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
