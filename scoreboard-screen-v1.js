(() => {
"use strict";
const fallback = window.renderScoreboard;
let viewKey = "", selected = 0;
const reports = new Map();
function categoryIconSafe(category) {
 try { return categoryIcon(category); } catch { return "✨"; }
}
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function avatar(p){
 const raw=String(p.avatar||"");
 if(window.PtitBacProfilePhoto?.isImageAvatar?.(raw)||/^data:image\//i.test(raw)) return '<img src="'+esc(raw)+'" alt="">';
 return '<span>'+esc(raw||String(p.name||"?").slice(0,1))+'</span>';
}
function render(){
 const state=session.state, user=me();
 if(!state||state.phase!=="scoreboard") return fallback?.();
 const results=state.lastRoundResults||{}, categories=results.categories?.length?results.categories:(state.categories||[]);
 const round=Number(results.roundIndex??state.roundIndex??0);
 const key=JSON.stringify([state.code,state.gameSessionId,round]);
 if(key!==viewKey){viewKey=key;selected=0;reports.clear();}
 selected=Math.min(selected,Math.max(0,categories.length-1));
 const category=categories[selected], players=state.players||[], scores=state.lastRoundScores||{};
 const best=Math.max(0,...players.map(p=>Number(scores[p.id]||0)));
 const winners=players.filter(p=>Number(scores[p.id]||0)===best);
 const letter=String(results.letter||state.currentLetter||"?").slice(0,1).toUpperCase();
 const mine=results.byPlayer?.[session.playerId]?.[category];
 const reportKey=JSON.stringify([key,session.playerId,category]);
 const reportState=reports.get(reportKey);
 const eligible=!!(mine?.answer && mine.status==="invalid" && mine.reportable);
 const reported=mine?.reported||reportState==="sent";
 const pending=reportState==="pending";
 const rows=players.map(p=>{
   const r=results.byPlayer?.[p.id]?.[category]||{};
   const status=!String(r.answer||"").trim()?"empty":r.status==="valid"?"valid":r.status==="duplicate"?"duplicate":"invalid";
   const symbol={empty:"—",valid:"✓",duplicate:"=",invalid:"×"}[status];
   const reason=status==="invalid"?(r.correction||"Réponse refusée"):status==="duplicate"?(r.correction||"Réponse partagée"):"";
   return '<article class="res-row '+status+'"><div class="res-player"><div class="res-avatar">'+avatar(p)+'</div><strong>'+esc(p.name||"Joueur")+'</strong>'+(p.id===session.playerId?'<small>Toi</small>':'')+'</div><div class="res-answer"><strong>'+esc(status==="empty"?"Aucune réponse":r.answer)+'</strong>'+(reason?'<small>'+esc(reason)+'</small>':'')+'</div><div class="res-score"><b aria-label="'+({empty:"Sans réponse",valid:"Valide",duplicate:"Doublon",invalid:"Refusée"}[status])+'">'+symbol+'</b><span>'+(status==="valid"?"+1 pt":"0 pt")+'</span></div></article>';
 }).join("");
 const last=round+1>=Number(state.rounds||1);
 setScreen('<main class="ssv1-screen results-screen"><header class="res-top"><button id="resExit" class="res-exit" aria-label="Quitter la partie"><img src="/lobby-exit.png" alt=""></button><img class="res-brand" src="/ptitbac.logo.png" alt="P’tit Bac"><span class="res-pill">Manche '+(round+1)+'/'+Number(state.rounds||1)+'</span></header>'+
 '<div class="res-heading"><h1>Résultats <span>de la manche</span></h1><span class="res-pill">Lettre '+esc(letter)+'</span></div>'+
 '<section class="res-winner"><img class="res-trophy" src="/scoreboard-trophy.png" alt=""><div class="res-winner-copy"><small>'+(winners.length>1?"Égalité sur la manche":"Vainqueur de la manche")+'</small><div>'+(winners.length===1?'<span class="res-avatar">'+avatar(winners[0])+'</span>':'')+'<strong>'+esc(winners.map(p=>p.name).join(" & ")||"Aucun joueur")+'</strong></div></div><b>'+best+' pts</b></section>'+
 '<section class="res-panel"><div class="res-panel-title"><h2>Les réponses</h2><span id="resPosition">'+(categories.length?selected+1:0)+' / '+categories.length+'</span></div>'+
 '<div class="res-nav" id="resSwipe" tabindex="0" aria-label="Choisir une catégorie"><button id="resPrev" aria-label="Catégorie précédente" '+(selected===0?'disabled':'')+'>‹</button><div class="res-category" aria-live="polite"><span aria-hidden="true">'+(category?categoryIconSafe(category):"")+'</span><strong>'+esc(category||"Aucune catégorie")+'</strong></div><button id="resNext" aria-label="Catégorie suivante" '+(selected>=categories.length-1?'disabled':'')+'>›</button></div>'+
 '<p class="res-swipe-hint">Glisse pour changer de catégorie</p><div class="res-dots">'+categories.map((c,i)=>'<button data-res-index="'+i+'" aria-label="'+esc(c)+'" '+(i===selected?'aria-current="true"':'')+'></button>').join("")+'</div>'+
 '<div class="res-rows">'+rows+'</div>'+
 '<button class="res-report" id="resReport" '+(!eligible||reported||pending?'disabled':'')+'>ⓘ '+(reported?'Signalé ✓':pending?'Envoi…':'Signaler une correction')+'</button>'+
 '<p class="res-legend"><span>✓ Valide</span><span>— Sans réponse</span><span>× Refusée</span><span>= Doublon</span></p></section>'+
 ((user?.isHost||state.mode==="quick")?'<button id="resContinue" class="res-continue">'+(last?'Afficher le classement':'Prochaine manche')+' →</button>':'<p class="res-wait">En attente de l’hôte pour continuer</p>')+'</main>');
 const navigate=index=>{
  selected=Math.max(0,Math.min(categories.length-1,index));
  render();
  document.getElementById("resSwipe")?.focus({preventScroll:true});
 };
 document.getElementById("resExit").onclick=()=>gameExitModal(state,user,"ssv1");
 document.getElementById("resPrev").onclick=()=>navigate(selected-1);
 document.getElementById("resNext").onclick=()=>navigate(selected+1);
 document.querySelectorAll("[data-res-index]").forEach(b=>b.onclick=()=>navigate(Number(b.dataset.resIndex)));
 const swipe=document.getElementById("resSwipe");
 let start=null;
 swipe.addEventListener("pointerdown",e=>{if(e.isPrimary!==false)start={x:e.clientX,y:e.clientY};});
 swipe.addEventListener("pointerup",e=>{if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5)navigate(selected+(dx<0?1:-1));});
 swipe.addEventListener("pointercancel",()=>{start=null;});
 swipe.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();navigate(selected+(e.key==="ArrowRight"?1:-1));}});
 const next=document.getElementById("resContinue");
 if(next)next.onclick=()=>{if(next.disabled)return;next.disabled=true;socket.emit("game:nextRound",{code:state.code,playerId:session.playerId});};
 document.getElementById("resReport").onclick=()=>{
  if(!eligible||reported||reports.get(reportKey)==="pending")return;
  reports.set(reportKey,"pending");
  const playerId=session.playerId;
  render();
  socket.emit("answer:report",{code:state.code,playerId,roundIndex:round,category},res=>{
    if(viewKey!==key)return;
    reports.set(reportKey,res?.ok?"sent":"error");
    if(session.state?.phase==="scoreboard")render();
    toast(res?.ok?"Signalement envoyé.":res?.error||"Impossible d’envoyer le signalement.");
  });
 };
}
window.renderScoreboard=render;
try{renderScoreboard=render;}catch{}
})();
