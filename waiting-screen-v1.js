(() => {
"use strict";
function esc(value=""){try{return escapeHtml(value);}catch{return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}}
function playerAvatar(player,index){const raw=String(player?.avatar||"");const isImage=Boolean(window.PtitBacProfilePhoto?.isImageAvatar?.(raw))||/^data:image\//i.test(raw);if(isImage)return `<div class="wsv1-avatar"><img src="${raw}" alt="" draggable="false"></div>`;const content=raw||String(player?.name||"?").slice(0,1).toUpperCase();return `<div class="wsv1-avatar"><span>${esc(content)}</span></div>`;}
function renderWaitingV1(){
 clearInterval(session.timerHandle);const state=session.state;if(!state||state.phase!=="round")return;
 const players=Array.isArray(state.players)?state.players:[];const readyCount=players.filter(p=>p.submitted).length;const total=players.length;const allReady=total>0&&readyCount===total;
 setScreen(`
 <main class="wsv1-screen">
   <header class="wsv1-brandbar">
     <button class="wsv1-exit" id="wsv1Exit" type="button" aria-label="Quitter la partie"><img src="/lobby-exit.png" alt=""></button>
     <img class="wsv1-brand" src="/ptitbac.logo.png" alt="P’tit Bac">
     <span aria-hidden="true"></span>
   </header>
   <section class="wsv1-main">
     <div class="wsv1-timer" id="wsv1TimerRing" style="--wsv1-progress:100%"><div><strong id="wsv1Timer">${Math.max(0,Number(state.duration||0))}</strong><span>secondes</span></div></div>
     <h1 id="wsv1Title">${allReady?"Tout le monde est prêt !":"En attente des autres joueurs…"}</h1>
     <p>Tes réponses sont enregistrées.</p>
   </section>
   <section class="wsv1-players">
     <div class="wsv1-players-head"><h2>Joueurs prêts <span>(${readyCount}/${total})</span></h2>${!allReady?`<small>${total-readyCount} restant${total-readyCount>1?"s":""}</small>`:""}</div>
     <div class="wsv1-player-list">${players.map((p,index)=>`<article class="wsv1-player ${p.submitted?"is-ready":"is-writing"}">${playerAvatar(p,index)}<strong>${esc(p.name)}</strong><span class="wsv1-state">${p.submitted?`<b class="wsv1-check">✓</b> Prêt`:`<i class="wsv1-spinner" aria-hidden="true"></i> En cours…`}</span></article>`).join("")}</div>
   </section>
 </main>`);
 document.getElementById("wsv1Exit")?.addEventListener("click",()=>gameExitModal(state,me(),"wsv1-exit"));
 const tick=()=>{const timer=document.getElementById("wsv1Timer"),ring=document.getElementById("wsv1TimerRing");if(!timer||!ring)return;const remainingMs=Math.max(0,Number(state.roundEndsAt||0)-Date.now());const seconds=Math.ceil(remainingMs/1000);timer.textContent=String(seconds);const durationMs=Math.max(1,Number(state.duration||0)*1000);const progress=Math.max(0,Math.min(100,(remainingMs/durationMs)*100));ring.style.setProperty("--wsv1-progress",`${progress}%`);ring.classList.toggle("is-danger",seconds<=10);if(seconds<=0)ring.classList.add("is-finished");};
 tick();session.timerHandle=setInterval(tick,100);
}
window.renderRoundWaiting=renderWaitingV1;try{renderRoundWaiting=renderWaitingV1;}catch{}
})();