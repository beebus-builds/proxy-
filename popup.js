// T35 VPN — popup v1.3 (failover + clear-cookies)
const $ = (id) => document.getElementById(id);
const hero=$("hero"), statusTitle=$("statusTitle"), statusSub=$("statusSub"),
  powerBtn=$("powerBtn"), netDot=$("netDot"), serverList=$("serverList"),
  locVal=$("locVal"), ipVal=$("ipVal"), timeVal=$("timeVal"),
  killEl=$("killSwitch"), autoEl=$("autoConn"), toast=$("toast"),
  fWebrtc=$("fWebrtc"), fAdblock=$("fAdblock"), fGeo=$("fGeo"), fReconnect=$("fReconnect"),
  fFailover=$("fFailover"), fClear=$("fClear");

const FLAGS = { server17: "🇩🇪" };
let timerInt = null, connectedSince = null, pingCache = {};
const send = (type, extra={}) => new Promise(r => chrome.runtime.sendMessage({type, ...extra}, r));
function say(t){ toast.textContent=t; toast.classList.add("show"); clearTimeout(say._t); say._t=setTimeout(()=>toast.classList.remove("show"),2600); }
function fmt(s){ s=Math.max(0,s|0); return `${String((s/60)|0).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }
function mb(b){ return (b/1048576).toFixed(b>1073741824?2:1)+" MB"; }
function startTimer(ts){ stopTimer(); connectedSince=ts||Date.now(); timerInt=setInterval(()=>timeVal.textContent=fmt((Date.now()-connectedSince)/1000),1000); }
function stopTimer(){ if(timerInt) clearInterval(timerInt); timerInt=null; }
async function measurePing(host){ const t0=performance.now(); try{ await fetch(`https://${host}/`,{mode:"no-cors",cache:"no-store"});}catch{} const ms=Math.max(8,Math.round(performance.now()-t0)); pingCache[host]=ms; return ms; }
async function refreshPing(servers){ for(const s of servers){ const el=document.querySelector(`[data-ping="${s.id}"]`); if(el){ el.textContent="…"; el.textContent=await measurePing(s.host)+" ms"; } } }
const selId = () => document.querySelector(".srv.sel .ping")?.dataset?.ping || null;

async function refresh(){
  const r = await send("GET_STATUS");
  if(!r?.ok){ statusTitle.textContent="Error"; statusSub.textContent=r?.error||"bg unreachable"; return; }
  const {state, servers, current, killRuleActive, features, usage} = r;

  serverList.innerHTML="";
  servers.forEach((s,i)=>{
    const b=document.createElement("button");
    b.className="srv"+(s.id===state.serverId?" sel":"");
    b.innerHTML=`<div class="flag">${FLAGS[s.id]||"🌐"}</div><div class="srv-info"><div class="srv-name">${s.name} ${i===0?'<span class="badge-fast">FASTEST</span>':""}</div><div class="srv-host">${s.host}:${s.port}</div><div class="load"><i style="width:${28+i*17}%"></i></div></div><div><div class="ping" data-ping="${s.id}">${pingCache[s.host]?pingCache[s.host]+" ms":"—"}</div><div style="display:flex;gap:2px;align-items:center"><div class="check">✓</div>${servers.length>1?`<span class="srv-del" data-del="${s.id}" title="remove">✕</span>`:""}</div></div>`;
    b.onclick=async(e)=>{
      const del=e.target?.dataset?.del;
      if(del){ if(confirm("Remove "+s.name+"?")){ const x=await send("REMOVE_SERVER",{serverId:del}); say(x?.ok?"Server removed":"Failed: "+x?.error); refresh(); } return; }
      say("Connecting…"); const c=await send("CONNECT",{serverId:s.id}); if(!c?.ok) say("Failed: "+c?.error); refresh();
    };
    serverList.appendChild(b);
  });
  refreshPing(servers);

  killEl.checked=!!state.killSwitch;
  fWebrtc.checked=features.webrtc!==false; fAdblock.checked=features.adblock!==false;
  fGeo.checked=!!features.geoSpoof; fReconnect.checked=features.autoReconnect!==false;
  fFailover.checked=features.failover!==false; fClear.checked=!!features.clearOnDisconnect;
  if(!$("bypass").matches(":focus")) $("bypass").value=features.splitBypass||"";
  chrome.storage.local.get("auto_connect", d=>{ autoEl.checked=!!d.auto_connect; });

  const k=new Date().toISOString().slice(0,10);
  $("dataSession").textContent=mb(usage.session||0);
  $("dataToday").textContent=mb(usage[k]||0);
  $("shieldVal").textContent=[features.webrtc!==false?"W":"",features.adblock!==false?"A":"",features.geoSpoof?"G":""].join("")||"off";

  locVal.textContent=current?current.name:"—";
  if(state.connected){
    hero.className="hero connected"; netDot.className="net-dot on";
    statusTitle.textContent="You're Protected"; statusSub.textContent=`Connected • ${current?.host||""}`;
    chrome.storage.local.get("connected_since", d=>startTimer(d.connected_since||Date.now()));
    fetchIP();
  } else if(killRuleActive||state.killSwitch){
    hero.className="hero blocked"; netDot.className="net-dot blocked";
    statusTitle.textContent="Kill-switch Active"; statusSub.textContent="Internet blocked • tap to connect";
    stopTimer(); timeVal.textContent="00:00"; ipVal.textContent="blocked";
  } else {
    hero.className="hero disconnected"; netDot.className="net-dot off";
    statusTitle.textContent="You're Unprotected"; statusSub.textContent="Tap to connect securely";
    stopTimer(); timeVal.textContent="00:00"; fetchIP();
  }
}
async function fetchIP(){ ipVal.textContent="…"; try{ const res=await fetch("https://api.ipify.org?format=json"); ipVal.textContent=(await res.json()).ip; }catch{ ipVal.textContent="offline"; } }

powerBtn.onclick=async()=>{
  const r=await send("GET_STATUS");
  if(r?.state?.connected){ const d=await send("DISCONNECT",{activateKill:killEl.checked}); say(d?.cleared?"Disconnected — cookies wiped 🍪":"Disconnected — kill-switch guarding"); }
  else { say("Connecting…"); const c=await send("CONNECT",{serverId:selId()||r?.state?.serverId}); if(!c?.ok) say("Failed: "+c?.error); else say("Connected • "+c.server.host); }
  refresh();
};
killEl.onchange=async()=>{ await send("SET_KILLSWITCH",{enabled:killEl.checked}); refresh(); };
autoEl.onchange=async()=>{ await chrome.storage.local.set({auto_connect:autoEl.checked}); say(autoEl.checked?"Auto-connect ON":"Auto-connect OFF"); };
fWebrtc.onchange=async()=>{ await send("SET_FEATURE",{key:"webrtc",value:fWebrtc.checked}); refresh(); };
fAdblock.onchange=async()=>{ await send("SET_FEATURE",{key:"adblock",value:fAdblock.checked}); refresh(); };
fGeo.onchange=async()=>{ await send("SET_FEATURE",{key:"geoSpoof",value:fGeo.checked}); say(fGeo.checked?"Spoof ON — reload tabs":"Spoof OFF"); refresh(); };
fReconnect.onchange=async()=>{ await send("SET_FEATURE",{key:"autoReconnect",value:fReconnect.checked}); refresh(); };
fFailover.onchange=async()=>{ await send("SET_FEATURE",{key:"failover",value:fFailover.checked}); say("Failover "+(fFailover.checked?"ON":"OFF")); };
fClear.onchange=async()=>{ await send("SET_FEATURE",{key:"clearOnDisconnect",value:fClear.checked}); say(fClear.checked?"Cookies will wipe on disconnect":"Cookie wipe OFF"); };
$("saveCreds").onclick=async()=>{ await send("SAVE_CREDS",{serverId:selId()||"server17",username:$("username").value.trim(),password:$("password").value}); say("Credentials saved"); };
$("saveBypass").onclick=async()=>{ await send("SET_FEATURE",{key:"splitBypass",value:$("bypass").value}); say("Bypass list saved"); };
$("pingAll").onclick=async()=>{ const r=await send("GET_STATUS"); if(r?.ok) refreshPing(r.servers); };
$("fastest").onclick=async()=>{
  const r=await send("GET_STATUS"); if(!r?.ok) return;
  say("Testing fastest…"); await refreshPing(r.servers);
  let best=r.servers[0], bm=1e9;
  for(const s of r.servers){ const ms=pingCache[s.host]??1e9; if(ms<bm){bm=ms;best=s;} }
  say("Fastest: "+best.name); await send("CONNECT",{serverId:best.id}); refresh();
};
$("addSrv").onclick=async()=>{
  const host=$("nsHost").value.trim(); if(!host){ say("Enter host"); return; }
  const x=await send("ADD_SERVER",{name:$("nsName").value.trim()||host, host, port:parseInt($("nsPort").value,10)||3128, username:$("nsUser").value.trim()||"frontend", password:$("nsPass").value});
  say(x?.ok?"Added "+x.server.host:"Failed: "+x?.error);
  $("nsHost").value=""; $("nsName").value=""; $("nsPass").value="";
  refresh();
};
$("checkIp").onclick=fetchIP;
$("newIp").onclick=async()=>{ say("Rotating IP…"); const c=await send("RECONNECT",{serverId:selId()}); say(c?.ok?"New session via "+c.server.host:"Failed: "+c?.error); refresh(); };
$("leakBtn").onclick=()=>chrome.tabs.create({url:"https://browserleaks.com/webrtc"});
$("speedBtn").onclick=()=>chrome.tabs.create({url:"https://fast.com"});
$("bypassThis").onclick=async()=>{
  let tabs=[];
  try{ tabs=await chrome.tabs.query({active:true,currentWindow:true}); }catch{ say("No tab access"); return; }
  const url=tabs?.[0]?.url||"";
  let host="";
  try{ host=new URL(url).hostname; }catch{ say("Not a web page"); return; }
  if(!host||host==="newtab"){ say("Not a web page"); return; }
  const r=await send("GET_STATUS"); if(!r?.ok) return;
  const cur=(r.features.splitBypass||"").split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
  if(cur.includes(host)){ say(host+" already bypassed"); return; }
  cur.push(host);
  await send("SET_FEATURE",{key:"splitBypass",value:cur.join("\n")});
  say("Bypassed: "+host); refresh();
};
$("exportCfg").onclick=async()=>{
  const r=await send("EXPORT_CONFIG"); if(!r?.ok){ say("Export failed"); return; }
  const blob=new Blob([JSON.stringify(r.config,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download="t35-vpn-backup.json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  say("Backup downloaded");
};
$("importBtn").onclick=()=>$("importFile").click();
$("importFile").onchange=async()=>{
  const f=$("importFile").files?.[0]; if(!f) return;
  try{
    const cfg=JSON.parse(await f.text());
    const x=await send("IMPORT_CONFIG",{config:cfg});
    say(x?.ok?`Restored ${x.count} servers. ${x.note}`:"Failed: "+x?.error);
    $("importFile").value=""; refresh();
  }catch(e){ say("Invalid file"); }
};

refresh();
setInterval(async()=>{ const r=await send("GET_STATUS"); if(r?.ok){ const k=new Date().toISOString().slice(0,10); $("dataSession").textContent=mb(r.usage.session||0); $("dataToday").textContent=mb(r.usage[k]||0); } },5000);
