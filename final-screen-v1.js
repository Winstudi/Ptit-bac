(() => {
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function avatar(p){
 const raw=String(p?.avatar||"");
 const image=window.PtitBacProfilePhoto?.isImageAvatar?.(raw)||/^data:image\//i.test(raw);
 return '<span class="fin-avatar">'+(image?'<img src="'+esc(raw)+'" alt="">':'<span>'+esc(raw||String(p?.name||"?").slice(0,1))+'</span>')+'</span>';
}
const points=p=>Number(p?.score)||0;
const pts=p=>points(p)+" pt"+(points(p)>1?"s":"");
function renderFinishedV2(){
 clearInterval(session.timerHandle);
 const state=session.state,user=me();
 if(!state||state.phase!=="finished")return;
 const ranked=[...(state.players||[])].sort((a,b)=>points(b)-points(a)||String(a.name||"").localeCompare(String(b.name||"")));
 const rank=p=>ranked.findIndex(x=>points(x)===points(p))+1;
 const winners=ranked.filter(p=>points(p)===points(ranked[0]));
 const title=winners.length>1?"Victoire partagée : "+winners.map(p=>p.name).join(" & "):winners.length?winners[0].name+" remporte la partie !":"Partie terminée";
 const top=ranked.slice(0,3), order=top.length>1?[top[1],top[0],...top.slice(2)]:top;
 const podium=order.map(p=>'<article class="fin-podium-card place-'+Math.min(rank(p),3)+'"><div class="fin-medal">'+rank(p)+'</div>'+(rank(p)===1?'<span class="fin-crown" aria-hidden="true">♛</span>':'')+avatar(p)+'<strong>'+esc(p.name)+'</strong>'+(p.id===session.playerId?'<small class="fin-you">Toi</small>':'')+'<b>'+pts(p)+'</b><div class="fin-pedestal" aria-hidden="true">'+rank(p)+'</div></article>').join("");
 const rows=ranked.map(p=>'<div class="fin-row '+(p.id===session.playerId?'is-me':'')+'"><span class="fin-rank place-'+Math.min(rank(p),4)+'">'+rank(p)+'</span><div class="fin-player">'+avatar(p)+'<strong>'+esc(p.name)+'</strong>'+(p.id===session.playerId?'<small class="fin-you">Toi</small>':'')+'</div><b>'+pts(p)+'</b></div>').join("");
 const rawDifficulty=String(state.categoryDifficulty||"").toLowerCase();
 const difficulty=["hard","difficile"].includes(rawDifficulty)?"Difficile":["medium","normal","moyen"].includes(rawDifficulty)?"Moyen":"Facile";
 const quick=state.mode==="quick";
 const gain=Math.max(0,Number(state.myReward??state.rewardsByPlayerId?.[session.playerId]??0)||0);

 setScreen('<main class="fsv1-screen final-mobile"><header class="fin-top"><img class="fin-brand" src="/ptitbac.logo.png" alt="P’tit Bac"><span></span></header>'+
 '<section class="fin-heading"><h1>Partie <span>terminée !</span></h1><p>'+esc(title)+'</p></section>'+
 '<section class="fin-podium" aria-label="Podium">'+podium+'</section>'+
 '<section class="fin-ranking">'+rows+'</section>'+
 '<section class="fin-stats">'+[
 ["/friends.png",ranked.length,"Joueurs"],["/lightning.png",Number(state.rounds)||1,"Manche"+(state.rounds>1?"s":"")],["/lobby-clock.png",(Number(state.duration)||0)+" s","Par manche"],["/difficulty.png",difficulty,"Niveau"]
 ].map(([img,value,label])=>'<div><img src="'+img+'" alt=""><strong>'+value+'</strong><small>'+label+'</small></div>').join("")+'</section>'+
 '<p class="fin-mode">'+(quick?'Partie rapide · +'+gain+' pièces':'Salon privé · Partie sans gain de pièces')+'</p>'+
 '<div class="fin-actions">'+(user?.isHost&&!quick?'<button id="finReplay" class="fin-primary">↻ Rejouer</button>':quick?'<button id="finQuick" class="fin-primary">↻ Rejouer</button>':'<p>L’hôte peut relancer une partie.</p>')+'<button id="finHome" class="fin-secondary">⌂ Retour à l’accueil</button></div></main>');

 const leave=()=>{socket.emit("room:leave",{code:state.code,playerId:session.playerId});clearSession();renderHome();};
 document.getElementById("finHome").onclick=leave;

 const replay=document.getElementById("finReplay");
 if(replay)replay.onclick=()=>{if(replay.disabled)return;replay.disabled=true;socket.emit("game:restart",{code:state.code,playerId:session.playerId});};

 const again=document.getElementById("finQuick");
 if(again)again.onclick=()=>{if(again.disabled)return;again.disabled=true;const profile={name:user?.name||"Joueur",icon:user?.avatar||"🙂"};leave();window.startQuickPlay?.(profile);};
}
window.renderFinished=renderFinishedV2;
try{renderFinished=renderFinishedV2;}catch{}
})();