(() => {
  "use strict";

  const ACCOUNT_SESSION_KEY = "ptitbac_account_session";
  const GUEST_MODE_KEY = "ptitbac_guest_mode";
  const IDENTITY_EPOCH_KEY = "ptitbac_identity_epoch";
  const IDENTITY_EPOCH = "accounts-v1-cleanstart-20260916";

  let accountState = null;
  let gateRequired = false;
  let authBusy = false;

  function clearLegacyIdentityOnce() {
    if (localStorage.getItem(IDENTITY_EPOCH_KEY) === IDENTITY_EPOCH) return;

    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && /^(petitbac_|ptitbac_)/.test(key)) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
    localStorage.setItem(IDENTITY_EPOCH_KEY, IDENTITY_EPOCH);

    try {
      session.code = "";
      session.playerId = "";
      session.state = null;
      session.localAnswers = {};
      session.walletToken = "";
      session.walletBalance = 0;
    } catch {}

    if (typeof socket !== "undefined" && socket.connected) {
      socket.disconnect();
      queueMicrotask(() => socket.connect());
    }
  }

  function esc(value) {
    try { return escapeHtml(value); }
    catch {
      return String(value || "").replace(/[&<>"']/g, char => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
      }[char]));
    }
  }

  function accountSessionToken() {
    return String(localStorage.getItem(ACCOUNT_SESSION_KEY) || "").trim();
  }

  function isGuestMode() {
    return localStorage.getItem(GUEST_MODE_KEY) === "1";
  }

  function overlay() {
    return document.getElementById("ptbAccountGate");
  }

  function setMessage(message, kind = "") {
    const node = document.getElementById("ptbAccountMessage");
    if (!node) return;
    node.textContent = String(message || "");
    node.className = `ptb-account-message ${kind ? `is-${kind}` : ""}`;
  }

  function setBusy(value) {
    authBusy = Boolean(value);
    overlay()?.querySelectorAll("button,input").forEach(element => {
      element.disabled = authBusy;
    });
  }

  function closeGate() {
    gateRequired = false;
    overlay()?.remove();
  }

  function baseShell(content, { closable = false } = {}) {
    return `
      <div class="ptb-account-backdrop" aria-hidden="true"></div>
      <section class="ptb-account-card" role="dialog" aria-modal="true" aria-label="Compte P’tit Bac">
        ${closable ? `<button class="ptb-account-close" id="ptbAccountClose" type="button" aria-label="Fermer">×</button>` : ""}
        <div class="ptb-account-brand">
          <img src="/ptitbac.logo.png" alt="P’tit Bac">
          <div>
            <small>Ton espace joueur</small>
            <strong>Compte P’tit Bac</strong>
          </div>
        </div>
        ${content}
        <p id="ptbAccountMessage" class="ptb-account-message" role="status" aria-live="polite"></p>
      </section>`;
  }

  function loginContent() {
    return `
      <div class="ptb-account-tabs" role="tablist" aria-label="Compte">
        <button class="is-active" id="ptbShowLogin" type="button">Connexion</button>
        <button id="ptbShowRegister" type="button">Créer un compte</button>
      </div>
      <form id="ptbLoginForm" class="ptb-account-form">
        <label>
          <span>E-mail</span>
          <input id="ptbLoginEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="ton@email.fr">
        </label>
        <label>
          <span>Mot de passe</span>
          <input id="ptbLoginPassword" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="••••••••">
        </label>
        <button class="ptb-account-primary" type="submit">Se connecter</button>
      </form>
      <button class="ptb-account-guest" id="ptbContinueGuest" type="button">Continuer en invité</button>
      <small class="ptb-account-note">Ton compte servira à retrouver ton profil, tes pièces, gemmes, vies et ta progression sur un autre appareil.</small>`;
  }

  function registerContent() {
    return `
      <div class="ptb-account-tabs" role="tablist" aria-label="Compte">
        <button id="ptbShowLogin" type="button">Connexion</button>
        <button class="is-active" id="ptbShowRegister" type="button">Créer un compte</button>
      </div>
      <form id="ptbRegisterForm" class="ptb-account-form">
        <label>
          <span>Pseudo</span>
          <input id="ptbRegisterName" type="text" autocomplete="nickname" maxlength="24" minlength="2" required placeholder="Ton pseudo">
        </label>
        <label>
          <span>E-mail</span>
          <input id="ptbRegisterEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="ton@email.fr">
        </label>
        <label>
          <span>Mot de passe</span>
          <input id="ptbRegisterPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="8 caractères minimum">
        </label>
        <label>
          <span>Confirmer</span>
          <input id="ptbRegisterConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="Répète ton mot de passe">
        </label>
        <button class="ptb-account-primary" type="submit">Créer mon compte</button>
      </form>
      <button class="ptb-account-guest" id="ptbContinueGuest" type="button">Continuer en invité</button>`;
  }

  function accountContent() {
    const account = accountState || {};
    return `
      <div class="ptb-account-connected">
        <div class="ptb-account-avatar">
          ${String(account.avatar || "").startsWith("/")
            ? `<img src="${esc(account.avatar)}" alt="">`
            : `<span>${esc(account.avatar || "👤")}</span>`}
        </div>
        <div>
          <small>Connecté</small>
          <strong>${esc(account.username || "Joueur")}</strong>
          <span>${esc(account.email || "")}</span>
        </div>
      </div>
      <div class="ptb-account-security">
        <span>✓ Identité joueur permanente</span>
        <span>✓ Portefeuille lié au compte</span>
        <span>✓ Session restaurable</span>
      </div>
      <button class="ptb-account-secondary" id="ptbAccountLogout" type="button">Se déconnecter</button>`;
  }

  function renderGate(mode = "login", { required = gateRequired } = {}) {
    gateRequired = Boolean(required);
    overlay()?.remove();

    const layer = document.createElement("div");
    layer.id = "ptbAccountGate";
    layer.className = "ptb-account-gate";
    layer.innerHTML = baseShell(
      mode === "account" ? accountContent() : mode === "register" ? registerContent() : loginContent(),
      { closable: !gateRequired }
    );
    document.body.appendChild(layer);

    document.getElementById("ptbAccountClose")?.addEventListener("click", closeGate);
    document.getElementById("ptbShowLogin")?.addEventListener("click", () => renderGate("login", { required:gateRequired }));
    document.getElementById("ptbShowRegister")?.addEventListener("click", () => renderGate("register", { required:gateRequired }));
    document.getElementById("ptbContinueGuest")?.addEventListener("click", () => {
      localStorage.setItem(GUEST_MODE_KEY, "1");
      localStorage.removeItem(ACCOUNT_SESSION_KEY);
      accountState = null;
      closeGate();
      enhanceHome();
    });

    document.getElementById("ptbLoginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("ptbRegisterForm")?.addEventListener("submit", handleRegister);
    document.getElementById("ptbAccountLogout")?.addEventListener("click", handleLogout);
  }

  function emitAck(event, payload, timeoutMs = 12000) {
    return new Promise(resolve => {
      if (!socket?.connected) {
        resolve({ ok:false, error:"Connexion au serveur interrompue." });
        return;
      }
      socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
        if (error) {
          resolve({ ok:false, error:"Le serveur ne répond pas. Réessaie." });
          return;
        }
        resolve(response || { ok:false, error:"Réponse serveur invalide." });
      });
    });
  }

  function saveAccount(result) {
    const account = result?.account;
    if (!account?.sessionToken || !account?.walletToken) return false;

    localStorage.setItem(ACCOUNT_SESSION_KEY, account.sessionToken);
    localStorage.removeItem(GUEST_MODE_KEY);
    localStorage.setItem("petitbac_profile_name", String(account.username || "Joueur"));
    localStorage.setItem("petitbac_profile_icon", String(account.avatar || "/a1.webp"));
    if (account.friendCode) localStorage.setItem("petitbac_friendCode", String(account.friendCode));

    accountState = { ...account };
    return true;
  }

  function switchToAccountWallet(account) {
    if (!account?.walletToken) return;

    try {
      clearSession();
      setWalletState(account.walletToken, account.balance);
    } catch {
      session.walletToken = account.walletToken;
      session.walletBalance = Math.max(0, Number(account.balance) || 0);
      localStorage.setItem("petitbac_walletToken", account.walletToken);
      localStorage.setItem("petitbac_walletBalance", String(session.walletBalance));
    }

    if (socket.connected) socket.disconnect();
    setTimeout(() => socket.connect(), 0);
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (authBusy) return;

    setBusy(true);
    setMessage("Connexion…");
    const result = await emitAck("auth:login", {
      email: document.getElementById("ptbLoginEmail")?.value || "",
      password: document.getElementById("ptbLoginPassword")?.value || ""
    });

    if (!result?.ok || !saveAccount(result)) {
      setBusy(false);
      setMessage(result?.error || "Connexion impossible.", "error");
      return;
    }

    setMessage("Compte connecté.", "success");
    switchToAccountWallet(result.account);
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (authBusy) return;

    const password = document.getElementById("ptbRegisterPassword")?.value || "";
    const confirm = document.getElementById("ptbRegisterConfirm")?.value || "";
    if (password !== confirm) {
      setMessage("Les deux mots de passe sont différents.", "error");
      return;
    }

    setBusy(true);
    setMessage("Création du compte…");
    const result = await emitAck("auth:register", {
      username: document.getElementById("ptbRegisterName")?.value || "",
      email: document.getElementById("ptbRegisterEmail")?.value || "",
      password
    }, 15000);

    if (!result?.ok || !saveAccount(result)) {
      setBusy(false);
      setMessage(result?.error || "Création impossible.", "error");
      return;
    }

    setMessage("Compte créé.", "success");
    switchToAccountWallet(result.account);
  }

  async function handleLogout() {
    if (authBusy) return;
    setBusy(true);

    const token = accountSessionToken();
    if (token && socket.connected) {
      await emitAck("auth:logout", { sessionToken:token }, 8000);
    }

    localStorage.removeItem(ACCOUNT_SESSION_KEY);
    localStorage.removeItem(GUEST_MODE_KEY);
    localStorage.removeItem("petitbac_walletToken");
    localStorage.removeItem("petitbac_walletBalance");
    localStorage.removeItem("petitbac_friendCode");
    accountState = null;

    try {
      clearSession();
      session.walletToken = "";
      session.walletBalance = 0;
    } catch {}

    if (socket.connected) socket.disconnect();
    renderGate("login", { required:true });
    setTimeout(() => socket.connect(), 0);
  }

  async function resumeAccount() {
    const token = accountSessionToken();
    if (!token) {
      if (!isGuestMode()) renderGate("login", { required:true });
      return;
    }

    const result = await emitAck("auth:resume", { sessionToken:token }, 10000);
    if (!result?.ok || !result.account?.walletToken) {
      authBusy = false;
      localStorage.removeItem(ACCOUNT_SESSION_KEY);
      accountState = null;
      renderGate("login", { required:true });
      setMessage("Ta session a expiré. Reconnecte-toi.", "error");
      return;
    }

    saveAccount(result);
    const currentWallet = String(session?.walletToken || "");
    if (currentWallet !== result.account.walletToken) {
      switchToAccountWallet(result.account);
      return;
    }

    authBusy = false;
    closeGate();
    enhanceHome();
  }

  function enhanceHome() {
    const menu = document.getElementById("homeMenu");
    if (!menu || document.getElementById("homeAccount")) return;

    const button = document.createElement("button");
    button.id = "homeAccount";
    button.type = "button";
    button.className = "ptb-home-account-entry";
    button.innerHTML = `
      <span class="ptb-home-account-icon" aria-hidden="true">👤</span>
      <span>${accountState ? "Mon compte" : "Compte"}</span>`;

    const settings = document.getElementById("homeSettings");
    if (settings?.parentNode === menu) settings.after(button);
    else menu.prepend(button);

    button.addEventListener("click", () => {
      document.getElementById("homeMenu")?.setAttribute("hidden", "");
      renderGate(accountState ? "account" : "login", { required:false });
    });
  }

  clearLegacyIdentityOnce();

  if (!accountSessionToken() && !isGuestMode()) {
    renderGate("login", { required:true });
  }

  socket.on("connect", () => {
    setTimeout(resumeAccount, 0);
  });

  document.addEventListener("ptitbac:screen-rendered", enhanceHome);
  document.addEventListener("ptitbac:dom-updated", enhanceHome);

  window.PtitBacAccount = {
    open() {
      renderGate(accountState ? "account" : "login", { required:false });
    },
    state() {
      return accountState ? { ...accountState } : null;
    },
    isGuest: isGuestMode,
    resume: resumeAccount
  };
})();
