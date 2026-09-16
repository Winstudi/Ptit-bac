/**
 * P'tit Bac — interface Amis V2
 * Design harmonisé avec les dernières pages Profil / Accueil.
 */
(() => {
  "use strict";

  const friendSocket = socket;
  let friendsState = {
    profile: null,
    friends: [],
    incoming: [],
    outgoing: [],
    activeTab: "friends",
    search: "",
    sort: "online",
    quickMenuFriendId: ""
  };
  let friendsOpen = false;
  let bootstrapTimer = null;
  let openedFriendId = "";
  let inviteTimer = null;

  function resetFriendsIdentityState() {
    clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
    friendsState.profile = null;
    friendsState.friends = [];
    friendsState.incoming = [];
    friendsState.outgoing = [];
    friendsState.activeTab = "friends";
    friendsState.search = "";
    friendsState.sort = "online";
    friendsState.quickMenuFriendId = "";
    openedFriendId = "";
    closeInvite();
  }
  const inMenus = () => typeof session !== "undefined" && (!session.state || session.state.phase === "finished");
  function closeInvite() {
    clearTimeout(inviteTimer);
    document.getElementById("friendInviteDialog")?.remove();
  }
  function invitation({from,roomCode,expiresAt} = {}) {
    if (!roomCode || !inMenus() || Date.now() >= Number(expiresAt)) return;
    if (document.getElementById("friendInviteDialog")) return;
    const el=document.createElement("div");
    el.id="friendInviteDialog"; el.className="friends-popup";
    el.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="friendInviteTitle">
      <h2 id="friendInviteTitle">Invitation à jouer</h2>
      <p><strong>${escapeHtml(from?.username || "Un ami")}</strong> t’invite dans son salon.</p>
      <p>Code : <b>${escapeHtml(roomCode)}</b></p>
      <div class="friends-popup-actions"><button id="friendInviteNo">Refuser</button><button id="friendInviteYes" class="primary">Rejoindre</button></div>
      <p id="friendInviteError" role="status"></p></section>`;
    document.body.append(el);
    const decline=el.querySelector("#friendInviteNo"),accept=el.querySelector("#friendInviteYes");
    decline.onclick=closeInvite; decline.focus();
    el.addEventListener("keydown",e=>{
      if(e.key==="Escape")closeInvite();
      if(e.key==="Tab"){e.preventDefault();(document.activeElement===decline?accept:decline).focus();}
    });
    inviteTimer=setTimeout(closeInvite,Math.max(0,Number(expiresAt)-Date.now()));
    accept.onclick=()=>{
      if(!inMenus() || Date.now()>=Number(expiresAt)){closeInvite();return;}
      accept.disabled=true;accept.textContent="Connexion…";
      const p=identityPayload();
      socket.emit("room:join",{code:roomCode,name:p.username,avatar:p.avatar,walletToken:p.walletToken},res=>{
        if(!res?.ok){
          if(!el.isConnected)return;
          accept.disabled=false;accept.textContent="Rejoindre";
          el.querySelector("#friendInviteError").textContent=res?.error||"Invitation indisponible.";
          return;
        }
        closeInvite();friendsOpen=false;
        if(typeof setWalletState==="function")setWalletState(res.walletToken,res.balance);
        saveSession(res.code,res.playerId);session.state=res.state;render();
      });
    };
  }
  function reportFriend(user) {
    document.getElementById("friendReportDialog")?.remove();
    const el=document.createElement("div");el.id="friendReportDialog";el.className="friends-popup";
    el.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="friendReportTitle">
      <h2 id="friendReportTitle">Signaler ${escapeHtml(user.username)}</h2>
      <label for="friendReportReason">Motif du signalement</label>
      <textarea id="friendReportReason" maxlength="500" placeholder="Explique ce qui s’est passé"></textarea>
      <div class="friends-popup-actions"><button id="friendReportCancel">Annuler</button><button id="friendReportSend" class="primary">Envoyer</button></div>
      <p id="friendReportStatus" role="status"></p></section>`;
    document.body.append(el);
    el.querySelector("#friendReportCancel").onclick=()=>el.remove();
    el.querySelector("textarea").focus();
    el.querySelector("#friendReportSend").onclick=()=>{
      const reason=el.querySelector("textarea").value.trim();
      if(!reason){el.querySelector("#friendReportStatus").textContent="Indique un motif.";return;}
      const btn=el.querySelector("#friendReportSend");btn.disabled=true;
      friendSocket.emit("players:report",identityPayload({targetFriendId:user.id,reason}),res=>{
        if(!res?.ok){btn.disabled=false;el.querySelector("#friendReportStatus").textContent=res?.error||"Envoi impossible.";return;}
        el.remove();localToast("Signalement envoyé à la modération.");
      });
    };
  }

  function identityPayload(extra = {}) {
    return {
      walletToken: localStorage.getItem("petitbac_walletToken") || "",
      username: localStorage.getItem("petitbac_profile_name") || "Joueur",
      avatar: localStorage.getItem("petitbac_profile_icon") || "🐼",
      ...extra
    };
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[ch]);
  }

  function isImageAvatar(value) {
    if (window.PtitBacProfilePhoto?.isImageAvatar) {
      return window.PtitBacProfilePhoto.isImageAvatar(value);
    }
    return typeof value === "string" && /^data:image\//i.test(value);
  }

  function avatarMarkup(value, className = "") {
    const avatar = value || "🐼";
    if (isImageAvatar(avatar)) {
      return `<img class="${className}" src="${avatar}" alt="" draggable="false">`;
    }
    return `<span>${escapeHtml(avatar)}</span>`;
  }

  function copyIcon() {
    return `
      <svg class="friends-v2-copy-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="7" width="10" height="12" rx="2"></rect>
        <path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
  }

  function tabIcon(type) {
    const icons = {
      friends: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 18a5.5 5.5 0 0 1 11 0"></path>
          <circle cx="17" cy="9" r="2.3"></circle>
          <path d="M15.5 14.5c2.7.1 4.7 1.4 5 3.7"></path>
        </svg>`,
      requests: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 18a5.5 5.5 0 0 1 11 0"></path>
          <path d="M18 7v6M15 10h6"></path>
        </svg>`,
      add: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 18a5.5 5.5 0 0 1 11 0"></path>
          <path d="M18 7v6M15 10h6"></path>
        </svg>`
    };
    return icons[type] || icons.friends;
  }

  function localToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._friendTimer);
    toast._friendTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function prettyLastSeen(value) {
    if (!value) return "Hors ligne";
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "Hors ligne";
    const diff = Math.max(0, Date.now() - time);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 2) return "Vu récemment";
    if (minutes < 60) return `Vu il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Vu il y a ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Vu il y a ${days} j`;
  }

  function bootstrap(silent = true) {
    const token = identityPayload().walletToken;
    if (!token) {
      clearTimeout(bootstrapTimer);
      bootstrapTimer = setTimeout(() => bootstrap(silent), 900);
      return;
    }

    friendSocket.emit("friends:bootstrap", identityPayload(), res => {
      if (identityPayload().walletToken !== token) return;
      if (!res?.ok) {
        if (!silent) localToast(res?.error || "Impossible de charger les amis.");
        return;
      }

      friendsState.profile = res.profile || null;
      if (friendsState.profile?.friendCode) localStorage.setItem("petitbac_friendCode", friendsState.profile.friendCode);
      friendsState.friends = res.friends || [];
      friendsState.incoming = res.incoming || [];
      friendsState.outgoing = res.outgoing || [];

      if (friendsOpen && friendsState.activeTab !== "messages" && document.querySelector(".friends-mobile")) renderFriends();
    });
  }

  function refreshFriends(showError = false) {
    const token = identityPayload().walletToken;
    if (!token) return;
    friendSocket.emit("friends:list", identityPayload(), res => {
      if (identityPayload().walletToken !== token) return;
      if (!res?.ok) {
        if (showError) localToast(res?.error || "Impossible de charger les amis.");
        return;
      }
      friendsState.profile = res.profile || friendsState.profile;
      if (friendsState.profile?.friendCode) localStorage.setItem("petitbac_friendCode", friendsState.profile.friendCode);
      friendsState.friends = res.friends || [];
      friendsState.incoming = res.incoming || [];
      friendsState.outgoing = res.outgoing || [];
      if (openedFriendId && !friendsState.friends.some(item => String(item.id) === String(openedFriendId))) {
        openedFriendId = "";
      }
      if (friendsOpen && friendsState.activeTab !== "messages" && document.querySelector(".friends-mobile")) renderFriends();
    });
  }

  function statusMarkup(user) {
    if (user.online) {
      return `<span class="friends-v2-status online"><i></i>En ligne</span>`;
    }
    return `<span class="friends-v2-status"><i></i>${escapeHtml(prettyLastSeen(user.lastSeen))}</span>`;
  }

  function friendCard(user) {
    return `
      <article class="friends-v4-card" data-card-id="${escapeHtml(user.id)}">
        <button class="friends-v4-main" type="button"
          data-friend-profile="${escapeHtml(user.id)}"
          aria-label="Voir le profil de ${escapeHtml(user.username)}">
          <div class="friends-v4-avatar-wrap">
            <div class="friends-v2-avatar">${avatarMarkup(user.avatar, "friends-v2-avatar-img")}</div>
            <i class="${user.online ? "online" : ""}"></i>
          </div>

          <div class="friends-v2-card-main">
            <strong>${escapeHtml(user.username)}</strong>
            ${statusMarkup(user)}
          </div>
        </button>

        <div class="friends-v4-actions">
          <button class="friends-v4-chat-btn" type="button"
            data-friend-message="${escapeHtml(user.id)}"
            aria-label="Envoyer un message à ${escapeHtml(user.username)}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h14v10H9l-4 4V5Z"></path>
            </svg>
            <span>Message</span>
          </button>
          <button class="friends-invite-btn invite-friend" type="button" data-id="${escapeHtml(user.id)}" aria-label="Inviter ${escapeHtml(user.username)}">Inviter</button>

          <button class="friends-v4-more-btn" type="button"
            data-friend-menu="${escapeHtml(user.id)}"
            aria-label="Plus d'options">⋮</button>
        </div>

        ${friendsState.quickMenuFriendId === String(user.id) ? `
          <div class="friends-v4-context" data-context-menu="${escapeHtml(user.id)}">
            <button type="button" class="danger" data-menu-remove="${escapeHtml(user.id)}">Supprimer l'ami</button>
            <button type="button" data-menu-report="${escapeHtml(user.id)}">Signaler</button>
          </div>
        ` : ""}
      </article>`;
  }

  function incomingCard(item) {
    const user = item.user;
    return `
      <article class="friends-v2-card request">
        <div class="friends-v2-avatar">${avatarMarkup(user.avatar, "friends-v2-avatar-img")}</div>
        <div class="friends-v2-card-main">
          <strong>${escapeHtml(user.username)}</strong>
          <small>${escapeHtml(user.friendCode || "")}</small>
        </div>
        <div class="friends-v2-request-actions">
          <button class="friends-v2-small-btn decline-request" data-request="${escapeHtml(item.requestId)}">Refuser</button>
          <button class="friends-v2-small-btn primary accept-request" data-request="${escapeHtml(item.requestId)}">Accepter</button>
        </div>
      </article>`;
  }

  function outgoingCard(item) {
    const user = item.user;
    return `
      <article class="friends-v2-card request">
        <div class="friends-v2-avatar">${avatarMarkup(user.avatar, "friends-v2-avatar-img")}</div>
        <div class="friends-v2-card-main">
          <strong>${escapeHtml(user.username)}</strong>
          <small>${escapeHtml(user.friendCode || "")}</small>
        </div>
        <span class="friends-v2-pending">En attente</span>
      </article>`;
  }

  function emptyFriendsState() {
    return `
      <div class="friends-v2-empty">
        <div class="friends-v2-empty-icon friends-v3-empty-icon">
          <img src="/friends.png" alt="" aria-hidden="true">
        </div>
        <strong>Pas encore d'amis</strong>
        <p>Ajoute quelqu'un avec son code ami<br>pour commencer !</p>
        <button id="friendsV2EmptyAdd" class="friends-v2-empty-add" type="button">
          ${tabIcon("add")}
          <span>Ajouter un ami</span>
        </button>
      </div>`;
  }

  function genericEmpty(icon, title, text) {
    return `
      <div class="friends-v2-empty compact">
        <span class="friends-v2-empty-emoji">${icon}</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </div>`;
  }

  function friendProfileModal() {
    if (!openedFriendId) return "";

    const user = friendsState.friends.find(item => String(item.id) === String(openedFriendId));
    if (!user) {
      openedFriendId = "";
      return "";
    }

    const roomCode = (localStorage.getItem("petitbac_code") || "").trim().toUpperCase();

    return `
      <div class="friends-v3-modal-backdrop" id="friendsProfileBackdrop">
        <section class="friends-v3-profile-modal" role="dialog" aria-modal="true" aria-label="Profil de ${escapeHtml(user.username)}">
          <button class="friends-v3-modal-close" id="friendsProfileClose" type="button" aria-label="Fermer">×</button>

          <div class="friends-v3-modal-avatar-wrap">
            <div class="friends-v3-modal-avatar">
              ${avatarMarkup(user.avatar, "friends-v3-modal-avatar-img")}
            </div>
            <i class="${user.online ? "online" : ""}"></i>
          </div>

          <h2>${escapeHtml(user.username)}</h2>
          ${statusMarkup(user)}

          <div class="friends-v3-friend-code">
            <div>
              <small>Code ami</small>
              <strong>${escapeHtml(user.friendCode || "—")}</strong>
            </div>
            <button id="copyOpenedFriendCode" type="button" ${user.friendCode ? "" : "disabled"} aria-label="Copier le code ami">
              ${copyIcon()}
            </button>
          </div>

          <div class="friends-v3-modal-actions">
            <button id="inviteOpenedFriend" class="primary" type="button" ${roomCode ? "" : "disabled"}>
              <span>${roomCode ? "Inviter dans une partie" : "Aucun salon à inviter"}</span>
            </button>

            <button id="messageOpenedFriend" type="button">
              <span>Envoyer un message</span>
            </button>

            <button id="removeOpenedFriend" class="danger" type="button">
              <span>Supprimer l'ami</span>
            </button>
          </div>
        </section>
      </div>`;
  }

  function visibleFriends() {
    const query = String(friendsState.search || "").trim().toLowerCase();
    const list = friendsState.friends.filter(user => {
      if (!query) return true;
      return String(user.username || "").toLowerCase().includes(query)
        || String(user.friendCode || "").includes(query);
    });

    if (friendsState.sort === "name") {
      return list.sort((a, b) =>
        String(a.username || "").localeCompare(String(b.username || ""), "fr", { sensitivity:"base" })
      );
    }

    if (friendsState.sort === "recent") {
      return list.sort((a, b) =>
        new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime()
      );
    }

    return list.sort((a, b) => {
      if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
      return String(a.username || "").localeCompare(String(b.username || ""), "fr", { sensitivity:"base" });
    });
  }

  function friendTools() {
    return `
      <div class="friends-v4-tools">
        <label class="friends-v4-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
          <input id="friendsSearchInput" type="search" autocomplete="off"
            placeholder="Rechercher un ami..." value="${escapeHtml(friendsState.search || "")}">
        </label>

        <label class="friends-v4-sort">
          <span>↕</span>
          <select id="friendsSortSelect" aria-label="Trier les amis">
            <option value="online" ${friendsState.sort === "online" ? "selected" : ""}>En ligne d'abord</option>
            <option value="name" ${friendsState.sort === "name" ? "selected" : ""}>Nom A-Z</option>
            <option value="recent" ${friendsState.sort === "recent" ? "selected" : ""}>Activité récente</option>
          </select>
        </label>
      </div>`;
  }

  function addFriendShortcut() {
    return `
      <button id="friendsQuickAdd" class="friends-v4-add-shortcut" type="button">
        <span class="friends-v4-add-icon">${tabIcon("add")}</span>
        <span>
          <strong>Ajouter un ami</strong>
          <small>Entre le code de 5 chiffres de ton ami</small>
        </span>
        <b>›</b>
      </button>`;
  }

  function currentPanel() {
    if (friendsState.activeTab === "messages") return '<section id="friendsChatPanel" aria-label="Messages"><p>Chargement des messages…</p></section>';
    if (friendsState.activeTab === "requests") {
      const incoming = friendsState.incoming.length
        ? friendsState.incoming.map(incomingCard).join("")
        : genericEmpty("💌", "Aucune demande", "Tes nouvelles demandes apparaîtront ici.");

      const outgoing = friendsState.outgoing.length
        ? `<h3 class="friends-v2-subtitle">Envoyées</h3>${friendsState.outgoing.map(outgoingCard).join("")}`
        : "";

      return `
        <section class="friends-v2-list">
          ${incoming}
          ${outgoing}
        </section>`;
    }

    if (friendsState.activeTab === "add") {
      return `
        <section class="friends-v2-add">
          <div class="friends-v2-add-icon">${tabIcon("add")}</div>
          <h2>Ajouter un ami</h2>
          <p>Entre son code ami à 5 chiffres, par exemple <b>48317</b>.</p>
          <div class="friends-v2-add-row">
            <input id="friendCodeInput" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="00000" />
            <button id="friendSendBtn">Ajouter</button>
          </div>
        </section>`;
    }

    if (!friendsState.friends.length) {
      return `
        <section class="friends-v4-friends-panel">
          ${emptyFriendsState()}
        </section>`;
    }

    const visible = visibleFriends();

    return `
      <section class="friends-v4-friends-panel">
        ${friendTools()}

        <div class="friends-v4-list">
          ${visible.length
            ? visible.map(friendCard).join("")
            : `<div class="friends-v4-no-result">Aucun ami ne correspond à ta recherche.</div>`}
        </div>

        ${addFriendShortcut()}
      </section>`;
  }

  function renderFriends() {
    friendsOpen = true;
    const app = document.getElementById("app");
    if (!app) return;

    const profile = friendsState.profile;
    const incomingCount = friendsState.incoming.length;

    document.documentElement.classList.remove("gameplay-flow");
    app.innerHTML = `
      <main class="screen friends-v2 friends-mobile">
        <div class="friends-v2-bg-glow glow-a"></div>
        <div class="friends-v2-bg-glow glow-b"></div>
        <header class="friends-v2-header">
          <button class="friends-v2-back" id="friendsBackBtn" aria-label="Retour">
            <img src="/back-arrow.png" alt="">
          </button>

          <div class="friends-v2-title">
            <h1>Amis</h1>
          </div>

          <button id="copyFriendCode" class="friends-header-code" type="button" aria-label="Copier mon code ami" ${profile?.friendCode ? "" : "disabled"}>
            <span><small>Code ami</small><strong>${escapeHtml(profile?.friendCode || "…")}</strong></span>
            ${copyIcon()}
          </button>
        </header>

        <nav class="friends-v2-tabs">
          <button data-friend-tab="friends" class="${friendsState.activeTab === "friends" ? "active" : ""}">
            <span class="friends-v2-tab-icon">${tabIcon("friends")}</span>
            <span>Mes amis</span>
            ${friendsState.friends.length ? `<b class="friends-v4-friend-count">${friendsState.friends.length}</b>` : ""}
          </button>

          <button data-friend-tab="messages" class="${friendsState.activeTab === "messages" ? "active" : ""}" type="button"><span>Messages</span></button>

          <button data-friend-tab="requests" class="${friendsState.activeTab === "requests" ? "active" : ""}">
            <span class="friends-v2-tab-icon">${tabIcon("requests")}</span>
            <span>Demandes</span>
            ${incomingCount ? `<b>${incomingCount}</b>` : ""}
          </button>

          <button data-friend-tab="add" class="${friendsState.activeTab === "add" ? "active" : ""}">
            <span class="friends-v2-tab-icon">${tabIcon("add")}</span>
            <span>Ajouter</span>
          </button>
        </nav>

        <div class="friends-v2-content">
          ${currentPanel()}
        </div>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>

        ${friendProfileModal()}
      </main>`;

    bindFriendsUI();
    if (friendsState.activeTab === "messages") window.PtitBacChat?.mount?.();
  }

  function bindFriendsUI() {
    document.querySelectorAll("[data-menu-report]").forEach(btn=>btn.onclick=()=>{
      const user=friendsState.friends.find(u=>String(u.id)===btn.dataset.menuReport);
      if(user)reportFriend(user);
    });
    document.getElementById("friendsBackBtn")?.addEventListener("click", () => {
      if (openedFriendId) {
        openedFriendId = "";
        return renderFriends();
      }
      friendsOpen = false;
      window.PtitBacChat?.unmount?.();
      if (typeof window.renderHome === "function") {
        window.renderHome();
      } else {
        window.location.reload();
      }
    });

    document.getElementById("friendsMessagesBtn")?.addEventListener("click", () => {
      if (!window.PtitBacChat?.openList) return localToast("Messagerie indisponible.");
      window.PtitBacChat.openList({ from: "friends" });
    });

    document.getElementById("copyFriendCode")?.addEventListener("click", async () => {
      const code = friendsState.profile?.friendCode;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        localToast("Code ami copié !");
      } catch {
        localToast(code);
      }
    });

    document.getElementById("friendsV2EmptyAdd")?.addEventListener("click", () => {
      friendsState.activeTab = "add";
      renderFriends();
    });

    document.querySelectorAll("[data-friend-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        openedFriendId = "";
        friendsState.quickMenuFriendId = "";
        friendsState.activeTab = btn.dataset.friendTab;
        if(friendsState.activeTab !== "messages") window.PtitBacChat?.unmount?.();
        renderFriends();
      });
    });

    const searchInput = document.getElementById("friendsSearchInput");
    searchInput?.addEventListener("input", event => {
      friendsState.search = event.target.value || "";
      friendsState.quickMenuFriendId = "";
      renderFriends();
      const next = document.getElementById("friendsSearchInput");
      next?.focus({ preventScroll:true });
      try { next?.setSelectionRange(next.value.length, next.value.length); } catch {}
    });

    document.getElementById("friendsSortSelect")?.addEventListener("change", event => {
      friendsState.sort = event.target.value || "online";
      friendsState.quickMenuFriendId = "";
      renderFriends();
    });

    document.getElementById("friendsQuickAdd")?.addEventListener("click", () => {
      friendsState.activeTab = "add";
      friendsState.quickMenuFriendId = "";
      renderFriends();
    });

    document.querySelectorAll("[data-friend-message]").forEach(btn => {
      btn.addEventListener("click", event => {
        event.stopPropagation();
        const user = friendsState.friends.find(item => String(item.id) === String(btn.dataset.friendMessage));
        if (!user) return;
        if (!window.PtitBacChat?.openConversation) return localToast("Messagerie indisponible.");
        window.PtitBacChat.openConversation(user);
      });
    });

    document.querySelectorAll("[data-friend-menu]").forEach(btn => {
      btn.addEventListener("click", event => {
        event.stopPropagation();
        const id = String(btn.dataset.friendMenu || "");
        friendsState.quickMenuFriendId = friendsState.quickMenuFriendId === id ? "" : id;
        renderFriends();
      });
    });

    document.querySelectorAll("[data-menu-profile]").forEach(btn => {
      btn.addEventListener("click", () => {
        friendsState.quickMenuFriendId = "";
        openedFriendId = btn.dataset.menuProfile || "";
        renderFriends();
      });
    });

    document.querySelectorAll("[data-menu-message]").forEach(btn => {
      btn.addEventListener("click", () => {
        const user = friendsState.friends.find(item => String(item.id) === String(btn.dataset.menuMessage));
        if (!user) return;
        friendsState.quickMenuFriendId = "";
        if (!window.PtitBacChat?.openConversation) return localToast("Messagerie indisponible.");
        window.PtitBacChat.openConversation(user);
      });
    });

    document.querySelectorAll("[data-menu-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const user = friendsState.friends.find(item => String(item.id) === String(btn.dataset.menuRemove));
        if (!user) return;
        if (!confirm(`Supprimer ${user.username || "cet ami"} ?`)) return;

        friendSocket.emit(
          "friends:remove",
          identityPayload({ friendId: user.id }),
          res => {
            if (!res?.ok) return localToast(res?.error || "Suppression impossible.");
            friendsState.quickMenuFriendId = "";
            localToast("Ami supprimé.");
            refreshFriends();
          }
        );
      });
    });

    document.querySelectorAll("[data-friend-profile]").forEach(card => {
      card.addEventListener("click", () => {
        openedFriendId = card.dataset.friendProfile || "";
        renderFriends();
      });
    });

    const closeFriendProfile = () => {
      openedFriendId = "";
      renderFriends();
    };

    document.getElementById("friendsProfileClose")?.addEventListener("click", closeFriendProfile);

    document.getElementById("friendsProfileBackdrop")?.addEventListener("click", event => {
      if (event.target.id === "friendsProfileBackdrop") closeFriendProfile();
    });

    document.getElementById("copyOpenedFriendCode")?.addEventListener("click", async () => {
      const user = friendsState.friends.find(item => String(item.id) === String(openedFriendId));
      const code = user?.friendCode;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        localToast("Code ami copié !");
      } catch {
        localToast(code);
      }
    });

    document.getElementById("inviteOpenedFriend")?.addEventListener("click", () => {
      const user = friendsState.friends.find(item => String(item.id) === String(openedFriendId));
      const roomCode = (localStorage.getItem("petitbac_code") || "").trim();
      if (!user || !roomCode) return localToast("Crée ou rejoins d'abord un salon.");

      friendSocket.emit(
        "friends:invite",
        identityPayload({ friendId: user.id, roomCode }),
        res => {
          if (!res?.ok) return localToast(res?.error || "Invitation impossible.");
          localToast(res.delivered ? "Invitation envoyée !" : "Ami hors ligne pour le moment.");
        }
      );
    });

    document.getElementById("messageOpenedFriend")?.addEventListener("click", () => {
      const user = friendsState.friends.find(item => String(item.id) === String(openedFriendId));
      if (!user) return;
      if (!window.PtitBacChat?.openConversation) return localToast("Messagerie indisponible.");
      window.PtitBacChat.openConversation(user);
    });

    document.getElementById("removeOpenedFriend")?.addEventListener("click", () => {
      const user = friendsState.friends.find(item => String(item.id) === String(openedFriendId));
      if (!user) return;
      if (!confirm(`Supprimer ${user.username || "cet ami"} ?`)) return;

      friendSocket.emit(
        "friends:remove",
        identityPayload({ friendId: user.id }),
        res => {
          if (!res?.ok) return localToast(res?.error || "Suppression impossible.");
          openedFriendId = "";
          localToast("Ami supprimé.");
          refreshFriends();
        }
      );
    });

    const input = document.getElementById("friendCodeInput");
    if (input) {
      input.addEventListener("input", () => {
        input.value = input.value
          .toUpperCase()
          .replace(/\D/g, "")
          .slice(0, 5);
      });
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("friendSendBtn")?.click();
      });
    }

    document.getElementById("friendSendBtn")?.addEventListener("click", () => {
      const friendCode = input?.value.trim();
      if (!/^\d{5}$/.test(friendCode || "")) return localToast("Entre le code ami à 5 chiffres.");

      friendSocket.emit("friends:send", identityPayload({ friendCode }), res => {
        if (!res?.ok) return localToast(res?.error || "Demande impossible.");
        localToast(`Demande envoyée à ${res.target?.username || "ce joueur"} !`);
        friendsState.activeTab = "requests";
        refreshFriends();
      });
    });

    document.querySelectorAll(".accept-request").forEach(btn => {
      btn.addEventListener("click", () => {
        friendSocket.emit(
          "friends:accept",
          identityPayload({ requestId: btn.dataset.request }),
          res => {
            if (!res?.ok) return localToast(res?.error || "Impossible d'accepter.");
            localToast("Ami ajouté !");
            refreshFriends();
          }
        );
      });
    });

    document.querySelectorAll(".decline-request").forEach(btn => {
      btn.addEventListener("click", () => {
        friendSocket.emit(
          "friends:decline",
          identityPayload({ requestId: btn.dataset.request }),
          res => {
            if (!res?.ok) return localToast(res?.error || "Impossible de refuser.");
            refreshFriends();
          }
        );
      });
    });

    document.querySelectorAll(".remove-friend").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("Supprimer cet ami ?")) return;
        friendSocket.emit(
          "friends:remove",
          identityPayload({ friendId: btn.dataset.id }),
          res => {
            if (!res?.ok) return localToast(res?.error || "Suppression impossible.");
            localToast("Ami supprimé.");
            refreshFriends();
          }
        );
      });
    });

    document.querySelectorAll(".invite-friend").forEach(btn => {
      btn.addEventListener("click", () => {
        const roomCode = (localStorage.getItem("petitbac_code") || "").trim();
        friendSocket.emit(
          "friends:invite",
          identityPayload({ friendId: btn.dataset.id, roomCode }),
          res => {
            if (!res?.ok) return localToast(res?.error || "Invitation impossible.");
            localToast(res.delivered ? "Invitation envoyée !" : "Ami hors ligne pour le moment.");
          }
        );
      });
    });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.('[data-nav="friends"]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    friendsState.activeTab = "friends";
    renderFriends();
    refreshFriends(true);
  }, true);

  document.addEventListener("ptitbac:identity-changed", () => {
    resetFriendsIdentityState();
    if (friendSocket.connected && identityPayload().walletToken) {
      bootstrap(true);
    }
    if (friendsOpen && document.querySelector(".friends-mobile")) {
      renderFriends();
    }
  });

  friendSocket.on("connect", () => bootstrap(true));

  friendSocket.on("friends:changed", () => {
    refreshFriends(false);
  });

  friendSocket.on("friends:presence", ({ userId, online } = {}) => {
    const friend = friendsState.friends.find(item => item.id === userId);
    if (friend) friend.online = Boolean(online);
    if (friendsOpen && document.querySelector(".friends-mobile") && friendsState.activeTab === "friends") renderFriends();
  });

  friendSocket.on("friends:room-invite", invitation);
  if(typeof socket!=="undefined"){
    socket.on("room:state",state=>{if(state&&state.phase!=="finished")closeInvite();});
    socket.on("disconnect",closeInvite);
  }

  // API légère réutilisable depuis le salon.
  window.PtitBacFriends = {
    open() {
      friendsState.activeTab="friends";renderFriends();refreshFriends();
    },
    openMessages(friend) {
      friendsState.activeTab="messages";
      window.PtitBacChat?.prepare?.(friend);
      renderFriends();
    },
    sendRequestByCode(friendCode, callback = () => {}) {
      const code = String(friendCode || "").trim().replace(/\D/g, "").slice(0, 5);
      if (!/^\d{5}$/.test(code)) {
        callback({ ok: false, error: "Code ami indisponible." });
        return;
      }

      friendSocket.emit("friends:send", identityPayload({ friendCode: code }), res => {
        if (res?.ok) refreshFriends(false);
        callback(res || { ok: false, error: "Demande impossible." });
      });
    },

    myProfile() {
      return friendsState.profile || null;
    }
  };

  if (friendSocket.connected) bootstrap(true);
})();
