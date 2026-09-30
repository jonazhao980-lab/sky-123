/* 会议听力训练：课程数据在 lessons/<id>/lesson.json，课程列表在 lessons/index.json */
const $=id=>document.getElementById(id);
const clean=s=>s.replace(/\[\[|\]\]/g,"");
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const dkey=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today=()=>dkey(new Date());
const norm=x=>x.trim().toLowerCase().replace(/[’']/g,"'").replace(/[-\s]+/g," ");
const GOAL=300, LS="listen-v3", CFG=window.LISTEN_CONFIG||{};

/* ---------- state ---------- */
let st={lesson:null,mode:"blind",days:{},listen:{},wrong:{},lessons:{},updatedAt:0,resetAt:0,syncKey:null};
try{Object.assign(st,JSON.parse(localStorage.getItem(LS)||"{}"))}catch(e){}
let INDEX=[],L=null,base="",ver="";
const ls=()=>st.lessons[L.id]||(st.lessons[L.id]={sec:0,done:{},last:-1});
function persist(){try{localStorage.setItem(LS,JSON.stringify(st))}catch(e){}}
function save(){st.updatedAt=Date.now();persist();schedulePush()}

/* ---------- lessons ---------- */
const url=f=>base+f+(ver?"?v="+ver:"");
async function getJSON(u){const r=await fetch(u);if(!r.ok)throw new Error(u+" "+r.status);return r.json()}
async function openLesson(id){
  stop();const e=INDEX.find(x=>x.id===id)||INDEX[0];
  base=`lessons/${e.id}/`;ver=e.v||"";
  L=await getJSON(url("lesson.json"));
  st.lesson=L.id;persist();curSrc=null;
  if(ls().sec>=L.sections.length)ls().sec=0;
  va.src=L.vocab&&L.vocab.audio?url(L.vocab.audio):"";
  renderHeader();render();setSrc();cacheLesson();
}
function spk(who){const s=(L.speakers||[]).find(x=>x.name===who);const c=s?s.color:"#5A6570";return `color-mix(in srgb, ${c} var(--spkmix), white)`}
function renderHeader(){
  document.title=`会议听力：${L.zhtitle||L.title}`;
  $("title").textContent=L.title;
  $("intro").textContent=(L.intro||"")+"每天点一下\"开始今天的练习\"就行：先盲听一节，听完自动进入填空。";
  $("note").textContent=L.note?"说明："+L.note:"";
  $("swatches").innerHTML=(L.speakers||[]).map(s=>`<div class="sw" style="background:${s.color}">${esc(s.name)}<small>${esc(s.role||"")}</small></div>`).join("");
  $("lessonSel").innerHTML=INDEX.map(x=>`<option value="${esc(x.id)}"${x.id===L.id?" selected":""}>${esc(x.date)}　${esc(x.zhtitle||x.title)}</option>`).join("");
}
$("lessonSel").onchange=e=>openLesson(e.target.value);

/* ---------- offline cache ---------- */
async function cacheLesson(){
  const box=$("offline");
  if(!("caches" in window)){box.textContent="此浏览器不支持离线";return}
  const files=["lesson.json",...L.sections.map(s=>s.audio),L.vocab&&L.vocab.audio,L.full].filter(Boolean);
  const want=new Set(files.map(f=>new URL(url(f),location.href).href));
  try{
    const c=await caches.open("lessons");
    for(const req of await c.keys())  // 同一课的旧版本文件清掉
      if(req.url.includes(`/lessons/${L.id}/`)&&!want.has(req.url))await c.delete(req);
    let miss=0,n=0;
    for(const u of want){
      if(!(await c.match(u))){try{const r=await fetch(u);if(r.ok)await c.put(u,r);else miss++}catch(e){miss++}}
      box.textContent=`正在下载离线版 ${++n}/${want.size}`;
    }
    box.textContent=miss?`离线版未下载完（${miss} 个文件），联网后会重试`:"本课已可离线使用";
  }catch(e){box.textContent="离线缓存失败"}
}
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

/* ---------- audio ---------- */
const au=$("au"),va=new Audio();
let stopAt=null,curSrc=null,flow=null,lastT=null,lastK=-2;
const secSrc=sec=>url(L.sections[sec].audio);
function meta(title){
  if(!("mediaSession" in navigator))return;
  try{navigator.mediaSession.metadata=new MediaMetadata({title,artist:L.zhtitle||L.title,album:"会议听力训练",
    artwork:[{src:"icon-512.png",sizes:"512x512",type:"image/png"}]})}catch(e){}
}
function load(src,title){if(curSrc!==src){au.src=src;curSrc=src}au.playbackRate=+$("rate").value;meta(title)}
function setSrc(sec=ls().sec){const s=L.sections[sec];load(secSrc(sec),s.ts+" "+s.name)}
function seekPlay(src,title,t,end){load(src,title);stopAt=end;
  // 手机浏览器常常不预加载，必须在点击里直接 play() 才会开始加载，拿到时长后再跳到句子位置
  if(au.readyState>=1)au.currentTime=Math.max(0,t);
  else{if(au.networkState===0||au.networkState===3)au.load();au.addEventListener("loadedmetadata",()=>{au.currentTime=Math.max(0,t)},{once:true})}
  au.play().catch(()=>{})}
function playSec(sec,t=0,end=null){const s=L.sections[sec];seekPlay(secSrc(sec),s.ts+" "+s.name,t,end)}
function stop(){au.pause();va.pause();stopAt=null;flow=null;hl(-1)}
const playFrom=k=>playSec(ls().sec,k<0?0:L.sections[ls().sec].lines[k].t[0]-.05);
function playLine(sec,k){const t=L.sections[sec].lines[k].t;playSec(sec,t[0]-.05,t[1]+.15)}
function hl(k){document.querySelectorAll(".line[id^=l]").forEach((e,i)=>e.classList.toggle("playing",i===k))}
au.addEventListener("play",()=>lastT=null);
au.addEventListener("timeupdate",()=>{const t=au.currentTime;
  if(lastT!==null&&!au.paused){const d=t-lastT;if(d>0&&d<1.5)addListen(d/au.playbackRate)}lastT=t;
  if(stopAt!==null&&t>=stopAt){au.pause();stopAt=null;hl(-1);lastK=-2;return}
  if(!L||curSrc!==secSrc(ls().sec)||!["blind","intensive","dictation"].includes(st.mode))return;
  const k=L.sections[ls().sec].lines.findIndex(x=>t>=x.t[0]-.05&&t<=x.t[1]+.6);
  if(k!==lastK){lastK=k;hl(k);const el=$("l"+k);if(el&&k>=0&&!document.hidden)el.scrollIntoView({block:"nearest",behavior:"smooth"})}});
au.addEventListener("ended",()=>{hl(-1);
  if(flow==="commute"){flow=null;return}
  if(flow==="today"){flow=null;st.mode="dictation";save();render();$("flowmsg").hidden=false;window.scrollTo({top:$("content").offsetTop-90,behavior:"smooth"});return}
  if(curSrc===secSrc(ls().sec)&&$("auto").checked&&ls().sec<L.sections.length-1){ls().sec++;save();render();playSec(ls().sec)}});
$("rate").addEventListener("change",()=>{au.playbackRate=+$("rate").value;va.playbackRate=1});
if("mediaSession" in navigator){const ms=navigator.mediaSession,h=(a,f)=>{try{ms.setActionHandler(a,f)}catch(e){}};
  h("play",()=>au.play());h("pause",()=>au.pause());
  h("seekbackward",()=>au.currentTime=Math.max(0,au.currentTime-10));h("seekforward",()=>au.currentTime+=10);
  h("previoustrack",()=>{if(flow==="commute"){au.currentTime=Math.max(0,au.currentTime-30);return}if(ls().sec>0){ls().sec--;save();render();playSec(ls().sec)}});
  h("nexttrack",()=>{if(flow==="commute"){au.currentTime+=30;return}if(ls().sec<L.sections.length-1){ls().sec++;save();render();playSec(ls().sec)}});}
let acc=0;function addListen(d){const k=today();st.listen[k]=(st.listen[k]||0)+d;acc+=d;
  if(st.listen[k]>=60)markDay();if(acc>5){acc=0;save();renderToday()}}
function markDay(){const k=today();if(!st.days[k]){st.days[k]=1;save();renderToday()}}
function speakVocab(i){stop();const t=L.vocab.items[i].t;va.currentTime=t[0];va.play().catch(()=>{});
  const chk=()=>{if(va.currentTime>=t[1]+.1)va.pause();else if(!va.paused)requestAnimationFrame(chk)};requestAnimationFrame(chk)}

/* ---------- today ---------- */
function streak(){let n=0;const d=new Date();if(!st.days[today()])d.setDate(d.getDate()-1);
  while(st.days[dkey(d)]){n++;d.setDate(d.getDate()-1)}return n}
function renderToday(){
  $("streakN").textContent=streak();
  const sec=Math.min(GOAL,st.listen[today()]||0);$("goalFill").style.width=(sec/GOAL*100)+"%";
  $("goalTxt").textContent=st.days[today()]?`今天已打卡，已听 ${Math.round((st.listen[today()]||0)/60*10)/10} 分钟`:`今天已听 ${Math.floor(sec/60)} 分 ${Math.floor(sec%60)} 秒，听满 1 分钟或做一次填空即打卡`;
  const dots=$("dots");dots.innerHTML="";const d=new Date();d.setDate(d.getDate()-13);
  for(let i=0;i<14;i++){const k=dkey(d);const s=document.createElement("span");s.className="dot"+(st.days[k]?" on":"")+(i===13?" now":"");s.title=k;dots.appendChild(s);d.setDate(d.getDate()+1)}
  const n=Object.keys(st.wrong).length;$("wrongBadge").textContent=n?` ${n}`:"";
  if(L)$("startToday").textContent=`开始今天的练习：第 ${nextSec()+1} 节`;
}
function nextSec(){const p=ls(),N=L.sections.length;for(let i=1;i<=N;i++){const s=(p.last+i)%N;if(!p.done[s])return s}return (p.last+1)%N}
$("startToday").onclick=()=>{const s=nextSec();stop();ls().sec=s;ls().last=s;st.mode="blind";save();render();flow="today";playSec(s)};
$("commute").onclick=()=>{stop();st.mode="blind";save();
  if(L.full){ls().sec=0;render();flow="commute";seekPlay(url(L.full),"整场连播",0,null)}
  else{ls().sec=0;$("auto").checked=true;render();playSec(0)}};

/* ---------- views ---------- */
const icoPlay='<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
const icoFrom='<svg viewBox="0 0 16 16"><path d="M2 3h2v10H2zM6 2.5v11l8-5.5z"/></svg>';
const blank=(w,key)=>`<input class="blank" data-a="${esc(w)}" data-key="${esc(key)}" size="${Math.max(4,w.length)}" aria-label="填空" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">`;
function renderNav(){const nav=$("nav");nav.innerHTML="";
  nav.style.display=["blind","intensive","dictation"].includes(st.mode)?"":"none";
  L.sections.forEach((s,i)=>{const b=document.createElement("button");b.setAttribute("aria-current",i===ls().sec);
    b.innerHTML=`<span class="ts">${esc(s.ts)}</span><span class="nm zh">${esc(s.zhname)}${ls().done[i]?' <span class="done">✓</span>':''}</span>`;
    b.onclick=()=>{stop();ls().sec=i;save();render();setSrc()};nav.appendChild(b)})}
function lineHTML(l,k,mode){const showZh=$("showZh").checked;let body;
  if(mode==="dictation"){let n=0;body=l.en.replace(/\[\[(.+?)\]\]/g,(_,w)=>blank(w,`${L.id}|${ls().sec}-${k}-${n++}`))}
  else body=esc(clean(l.en));
  return `<div class="line" id="l${k}"><div class="bar-c" style="background:${spk(l.who)}"></div>
  <div><div class="who" style="color:${spk(l.who)}">${esc(l.who)}</div>
  <div class="en${mode==="blind"?" hidden":""}" ${mode==="blind"?'title="点击显示原文" tabindex="0" role="button"':''}>${body}</div>
  ${showZh&&mode!=="dictation"?`<div class="zhline zh">${esc(l.zh)}</div>`:""}</div>
  <div class="lbtns"><button class="icon" aria-label="播放这一句" data-one="${k}">${icoPlay}</button>
  <button class="icon" aria-label="从这一句开始播放" data-from="${k}">${icoFrom}</button></div></div>`}
const HINTS={blind:"先不看原文听完整节，试着说出每个人的要点。听不懂的句子，点模糊的文字显示原文。",
  intensive:"逐句播放，跟读，一句不漏听懂再往下。可以打开中文对照。",
  dictation:"听句子，把空格里的关键词写出来。写错的词会自动进错词本。"};
function render(){
  if(!L)return;
  document.querySelectorAll(".modes button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mode===st.mode));
  renderNav();renderToday();const c=$("content");
  if(st.mode==="quiz")return renderQuiz(c);if(st.mode==="vocab")return renderVocab(c);if(st.mode==="wrong")return renderWrong(c);
  const sec=ls().sec,s=L.sections[sec],N=L.sections.length;
  c.innerHTML=`<div id="flowmsg" class="flow zh" hidden>这一节听完了。现在做填空巩固一下，做完今天的练习就完成了。</div>
  <div class="sectitle"><span class="ts">${esc(s.ts)}</span><h2>${esc(s.name)}</h2></div>
  <p class="hint zh">${esc(s.zhname)}。${HINTS[st.mode]}</p>
  ${s.lines.map((l,k)=>lineHTML(l,k,st.mode)).join("")}
  ${st.mode==="dictation"?`<button class="btn primary zh" id="check">检查答案</button><div class="score zh" id="score"></div>`:""}
  <div class="pn">${sec>0?`<button class="btn zh" id="prev">上一节</button>`:""}${sec<N-1?`<button class="btn zh" id="next">下一节</button>`:""}</div>`;
  c.querySelectorAll("[data-one]").forEach(b=>b.onclick=()=>{flow=null;playLine(ls().sec,+b.dataset.one)});
  c.querySelectorAll("[data-from]").forEach(b=>b.onclick=()=>{flow=null;playFrom(+b.dataset.from)});
  c.querySelectorAll(".en.hidden").forEach(e=>{const r=()=>e.classList.remove("hidden");e.onclick=r;e.onkeydown=ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();r()}}});
  const nv=d=>{stop();ls().sec+=d;save();render();setSrc();window.scrollTo({top:$("content").offsetTop-90})};
  $("prev")&&($("prev").onclick=()=>nv(-1));$("next")&&($("next").onclick=()=>nv(1));
  $("check")&&($("check").onclick=()=>{let ok=0,t=0;c.querySelectorAll(".ans").forEach(a=>a.remove());
    c.querySelectorAll(".blank").forEach(i=>{t++;const a=i.dataset.a,key=i.dataset.key;
      const [k,idx]=key.split("|")[1].split("-").slice(1).map(Number),l=s.lines[k];
      if(norm(i.value)===norm(a)){ok++;i.className="blank ok";if(st.wrong[key]){st.wrong[key].hits++;if(st.wrong[key].hits>=2)delete st.wrong[key]}}
      else{i.className="blank bad";i.insertAdjacentHTML("afterend",`<span class="ans">${esc(a)}</span>`);
        st.wrong[key]={w:a,lesson:L.id,lt:L.zhtitle||L.title,sec,k,idx,who:l.who,color:spk(l.who),en:l.en,zh:l.zh,ts:s.ts,src:secSrc(sec),t:l.t,hits:0}}});
    $("score").textContent=`答对 ${ok} / ${t}`+(ok<t?"，错的词已加入错词本":"");
    if(ok===t)ls().done[sec]=true;markDay();save();renderNav();renderToday()});
}
function renderWrong(c){const items=Object.entries(st.wrong);
  if(!items.length){c.innerHTML=`<div class="sectitle"><h2>错词本</h2></div><p class="hint zh">现在没有错词。做填空时写错的词会出现在这里，连续答对两次就会移出。</p>`;return}
  c.innerHTML=`<div class="sectitle"><h2>错词本</h2></div><p class="hint zh">所有课程的错词都在这里。听句子，补上空出的词，连续答对两次就移出。</p>`+
  items.map(([key,it])=>{let n=0;
    const body=it.en.replace(/\[\[(.+?)\]\]/g,(_,w)=>(n++===it.idx)?blank(w,key):esc(w));
    return `<div class="line"><div class="bar-c" style="background:${it.color}"></div><div><div class="who" style="color:${it.color}">${esc(it.who)}<span class="meta zh">　${esc(it.lt)} ${esc(it.ts)}　已对 ${it.hits}/2</span></div><div class="en">${body}</div><div class="zhline zh">${esc(it.zh)}</div></div>
    <div class="lbtns"><button class="icon" aria-label="播放这一句" data-wkey="${esc(key)}">${icoPlay}</button></div></div>`}).join("")+
  `<button class="btn primary zh" id="wcheck">检查答案</button><div class="score zh" id="wscore"></div>`;
  c.querySelectorAll("[data-wkey]").forEach(b=>b.onclick=()=>{flow=null;const it=st.wrong[b.dataset.wkey];if(it)seekPlay(it.src,it.lt+" "+it.ts,it.t[0]-.05,it.t[1]+.15)});
  $("wcheck").onclick=()=>{let ok=0,t=0,gone=0;c.querySelectorAll(".ans").forEach(a=>a.remove());
    c.querySelectorAll(".blank").forEach(i=>{t++;const key=i.dataset.key,a=i.dataset.a;if(!st.wrong[key])return;
      if(norm(i.value)===norm(a)){ok++;i.className="blank ok";st.wrong[key].hits++;if(st.wrong[key].hits>=2){delete st.wrong[key];gone++}}
      else{i.className="blank bad";st.wrong[key].hits=0;i.insertAdjacentHTML("afterend",`<span class="ans">${esc(a)}</span>`)}});
    markDay();save();renderToday();$("wscore").textContent=`答对 ${ok} / ${t}`+(gone?`，${gone} 个词已掌握并移出`:"")};
}
function renderQuiz(c){let right=0,answered=0;const Q=L.quiz||[];
  c.innerHTML=`<div class="sectitle"><h2>Comprehension check</h2></div><p class="hint zh">听完整场会议后再做。</p>`+
  Q.map((q,i)=>`<div class="q" data-q="${i}"><p>${i+1}. ${esc(q.q)}</p>${q.options.map((o,j)=>`<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}<div class="expl zh" hidden>${esc(q.explain||"")}</div></div>`).join("")+`<div class="score zh" id="qs"></div>`;
  c.querySelectorAll(".q").forEach(qe=>{const q=Q[+qe.dataset.q];qe.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{
    if(qe.dataset.done)return;qe.dataset.done=1;answered++;const j=+b.dataset.j;if(j===q.answer)right++;else b.classList.add("wrong");
    qe.querySelectorAll(".opt")[q.answer].classList.add("right");qe.querySelector(".expl").hidden=false;
    if(answered===Q.length){$("qs").textContent=`得分 ${right} / ${Q.length}`;markDay()}})})}
function renderVocab(c){const V=(L.vocab&&L.vocab.items)||[];
  c.innerHTML=`<div class="sectitle"><h2>Meeting vocabulary</h2></div><p class="hint zh">会议里出现的行业词汇。点播放听发音。</p>
  <div class="vwrap"><table class="vocab"><thead><tr><th>English</th><th class="zh">中文</th><th></th></tr></thead><tbody>
  ${V.map((v,i)=>`<tr><td>${esc(v.en)}</td><td class="zh">${esc(v.zh)}</td><td><button class="icon" aria-label="播放 ${esc(v.en)}" data-v="${i}">${icoPlay}</button></td></tr>`).join("")}</tbody></table></div>`;
  c.querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>speakVocab(+b.dataset.v))}
document.querySelectorAll(".modes button").forEach(b=>b.onclick=()=>{stop();st.mode=b.dataset.mode;save();render()});
$("playAll").onclick=()=>{flow=null;playFrom(-1)};$("stop").onclick=stop;
$("showZh").onchange=()=>{if(["blind","intensive"].includes(st.mode))render()};

/* ---------- sync（不用账号：同步码 + Supabase） ---------- */
let pushT=null,syncing=false;
const shared=()=>({days:st.days,listen:st.listen,wrong:st.wrong,lessons:st.lessons,lesson:st.lesson,updatedAt:st.updatedAt,resetAt:st.resetAt||0});
async function rpc(fn,args,keepalive=false){
  const r=await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`,{method:"POST",keepalive,
    headers:{apikey:CFG.supabaseKey,"Content-Type":"application/json"},body:JSON.stringify(args)});
  if(!r.ok)throw new Error(await r.text());const t=await r.text();return t?JSON.parse(t):null}
function clearProgress(at){Object.assign(st,{days:{},listen:{},wrong:{},lessons:{},updatedAt:at,resetAt:at})}
function merge(r){if(!r)return;
  // 任何一台设备清空过进度：比清空时间更早的记录一律作废，不再合并回来
  if((r.resetAt||0)>(st.resetAt||0))clearProgress(r.resetAt);
  else if((st.resetAt||0)>(r.resetAt||0))return;
  const newer=(r.updatedAt||0)>(st.updatedAt||0);
  const days={...(r.days||{}),...st.days},listen={...(r.listen||{})};
  for(const[k,v]of Object.entries(st.listen))listen[k]=Math.max(v,listen[k]||0);
  const lessons={};
  for(const id of new Set([...Object.keys(r.lessons||{}),...Object.keys(st.lessons)])){
    const a=st.lessons[id],b=(r.lessons||{})[id];
    lessons[id]={...(newer?{...a,...b}:{...b,...a}),done:{...(b&&b.done),...(a&&a.done)}}}
  Object.assign(st,{days,listen,lessons,wrong:newer?(r.wrong||{}):st.wrong,updatedAt:Math.max(r.updatedAt||0,st.updatedAt||0)});
  persist()}
async function pull(){if(!st.syncKey||syncing)return;syncing=true;
  try{merge(await rpc("listening_get",{k:st.syncKey}));await rpc("listening_put",{k:st.syncKey,d:shared()});
    syncMsg(`已同步 ${new Date().toLocaleTimeString()}`);render()}
  catch(e){syncMsg(/PGRST202|listening_(get|put)/.test(e.message)?"同步服务还没开通：需要先在 Supabase 运行 supabase_listening_sync.sql":"同步失败（可能没网），稍后自动重试")}finally{syncing=false}}
function schedulePush(){if(!st.syncKey)return;clearTimeout(pushT);pushT=setTimeout(()=>rpc("listening_put",{k:st.syncKey,d:shared()}).then(()=>syncMsg(`已同步 ${new Date().toLocaleTimeString()}`)).catch(()=>{}),3000)}
document.addEventListener("visibilitychange",()=>{if(!st.syncKey)return;
  if(document.hidden){clearTimeout(pushT);rpc("listening_put",{k:st.syncKey,d:shared()},true).catch(()=>{})}else pull()});
function syncMsg(t){$("syncMsg").textContent=t;$("syncBtn").textContent=st.syncKey?"同步：已开启":"同步：未开启"}
function newKey(){const A="abcdefghjkmnpqrstuvwxyz23456789",b=crypto.getRandomValues(new Uint8Array(20));
  return [...b].map(x=>A[x%A.length]).join("").match(/.{4}/g).join("-")}
function fmtKey(s){const k=s.toLowerCase().replace(/[^a-z0-9]/g,"");return k.length===20?k.match(/.{4}/g).join("-"):null}
function syncView(){$("syncOff").hidden=!!st.syncKey;$("syncOn").hidden=!st.syncKey;$("syncCode").textContent=st.syncKey||"";syncMsg($("syncMsg").textContent)}
$("syncBtn").onclick=()=>{syncView();$("syncDlg").showModal()};
$("syncNew").onclick=()=>{st.syncKey=newKey();persist();syncView();pull()};
$("syncJoin").onclick=()=>{const k=fmtKey($("syncIn").value);if(!k){alert("同步码应该是 20 位字母数字");return}st.syncKey=k;persist();syncView();pull()};
$("syncCopy").onclick=()=>navigator.clipboard.writeText(st.syncKey).then(()=>syncMsg("已复制")).catch(()=>{});
$("syncNow").onclick=pull;
$("resetBtn").onclick=()=>{if(!confirm("清空所有打卡、听力时长、填空进度和错词本？开了同步的其他设备也会一起清空，无法恢复。"))return;
  stop();clearProgress(Date.now());persist();render();
  if(st.syncKey)rpc("listening_put",{k:st.syncKey,d:shared()}).then(()=>syncMsg("已清空，其他设备下次打开时同步清空")).catch(()=>syncMsg("本机已清空，联网后会同步到其他设备"));
  else syncMsg("已清空")};
$("syncOffBtn").onclick=()=>{if(confirm("在本设备关闭同步？进度仍保留在本设备。")){st.syncKey=null;persist();syncView()}};

/* ---------- start ---------- */
(async()=>{
  syncMsg("");
  try{INDEX=await getJSON("lessons/index.json")}catch(e){$("content").innerHTML='<p class="hint zh">课程列表加载失败，请联网后刷新。</p>';return}
  INDEX.sort((a,b)=>b.date.localeCompare(a.date));
  await openLesson(st.lesson&&INDEX.some(x=>x.id===st.lesson)?st.lesson:INDEX[0].id);
  pull();
})();
