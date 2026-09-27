const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const show=(id,visible)=>{$(id).hidden=!visible;};
const compact=n=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:2}).format(n);
const money=n=>n===null?'UNAVAILABLE':`${n<0?'−':'+'}$${compact(Math.abs(n))}`;
const label=s=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const day=s=>s?.slice(0,10)??'Unavailable';
const dateLabel=s=>new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).toUpperCase();
let receiptTrigger=null;
let mode='time-machine',catalog=[],offer=null,current=null,busy=false,revealCredits=null;
async function post(path,body){const headers={'Content-Type':'application/json'};const r=await fetch(path,{method:'POST',headers,body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??'REQUEST_FAILED');return data;}
function failure(error){const messages={OUTCOME_SOURCE_UNAVAILABLE:'Nansen outcome history could not be validated. The firewall remains sealed. Try again later; another attempt requires fresh approval.',PUBLIC_RATE_LIMIT:'Too many requests. Wait a minute before trying again.',UNAUTHORIZED:'Public Investigate is not enabled on this server.',QUOTE_EXPIRED:'The estimate expired. Check availability & cost again.',CREDIT_BUDGET_EXCEEDED:'The server credit budget does not allow this request. No automatic retry.',UNSUPPORTED_CHAIN:'This chain is not supported.',INVALID_TOKEN:'Check the contract address for the selected chain.',INVALID_CUTOFF:'Choose a valid historical UTC cutoff.',DECISION_LOCKED:'Your decision is already locked.',UNCACHED_RATE_LIMIT:'Too many uncached reconstructions. Wait before trying again.'};$('status').textContent=messages[error.message]??`Could not complete this step: ${error.message}. You can retry explicitly.`;}
function reset(){if(busy)return;epoch++;sessions.clear();machineSession=null;current=null;offer=null;revealCredits=null;show('outcome',false);$('horizons').replaceChildren();$('trajectory').replaceChildren();$('outcome-story').textContent='';$('outcome-method').textContent='';for(const id of ['setup','workspace','quote','stages'])show(id,false);show('entry',true);$('choose-machine').focus();$('status').textContent='';window.scrollTo({top:0});navigate({screen:'home',mode},true);}
function configure(next){if(busy)return;mode=next;offer=null;show('entry',false);show('setup',true);show('workspace',false);show('quote',false);show('curated-choice',false);show('machine-brief',mode==='time-machine');show('investigate',mode==='investigate');show('custom-inputs',mode==='investigate');for(const id of ['chain','token','cutoff','window'])$(id).disabled=mode==='time-machine';$('token').required=mode==='investigate';$('setup-mode').textContent=mode==='time-machine'?'01 / TIME MACHINE':'02 / INVESTIGATE';$('setup-title').textContent=mode==='time-machine'?'PEPE. Before you knew.':'Reconstruct a moment.';$('setup-copy').textContent=mode==='time-machine'?'PEPE on Ethereum. End of day, February 24, 2024. Follow the evidence before you see what came next.':'Enter a token and a historical cutoff. Missing history remains unavailable; it is never treated as zero.';$('status').textContent='';$('setup-title').focus();}
function choose(next){if(busy)return;navigate({screen:'setup',mode:next});}
$('choose-machine').onclick=()=>choose('time-machine');$('choose-investigate').onclick=()=>choose('investigate');$('home').onclick=reset;$('restart').onclick=reset;
// History describes views; decisions and AFTER records belong to sessions and never rewind.
const sessions=new Map();let machineSession=null,epoch=0,sequence=0;
let view={screen:'home',mode,epoch,key:++sequence},pendingView=null,receiptParent=null,closingReceipt=false;
const positions=new Map();
function savePosition(){positions.set(view.key,{y:window.scrollY??0,focus:document.activeElement});}
function historyState(v){return {parallax:true,...v};}
function navigate(next,replace=false){
 savePosition();view={...next,epoch,key:++sequence};
 window.history?.[replace?'replaceState':'pushState'](historyState(view),'','#'+view.screen);
 applyView(view);
}
function applyView(next){
 if(busy){pendingView=next;return;}
 if(next.epoch!==epoch){next={screen:'home',mode,epoch,key:++sequence};window.history?.replaceState(historyState(next),'','#home');}
 view=next;const receiptOpen=$('receipt').open;
 if(receiptOpen&&view.screen!=='receipt'){closingReceipt=true;$('receipt').close();}
 if(view.screen==='home'){show('entry',true);show('setup',false);show('workspace',false);}
 else if(view.screen==='setup')configure(view.mode);
 else {
  const session=sessions.get(view.session);
  if(!session){navigate({screen:'home',mode},true);return;}
  mode=view.mode;
  if(current!==session){current=session;render(current);if(current.decision)renderDecision(current.decision);if(current.after)renderOutcome(current.after);}
  show('entry',false);show('setup',false);show('workspace',true);
  if(view.screen==='receipt'&&!receiptOpen)openReceipt(view.claim,view.extra,false);
 }
 show('back',view.screen!=='home');show('stages',false);$('status').textContent='';
 const saved=positions.get(view.key);
 if(view.screen!=='receipt'){
  const target=saved?.focus??$(view.screen==='home'?'choose-machine':view.screen==='setup'?'setup-title':'case-title');
  target?.focus({preventScroll:true});window.scrollTo({top:saved?.y??0,behavior:'instant'});
 }
}
function finishNavigation(){busy=false;if(pendingView){const next=pendingView;pendingView=null;applyView(next);}}
function back(){if(busy)return;if(window.history)window.history.back();else applyView(view.screen==='receipt'?receiptParent:{screen:view.screen==='dossier'?'setup':'home',mode,session:current?.session,epoch,key:++sequence});}
$('back').onclick=back;
$('brand').onclick=e=>{e.preventDefault();if(!busy)navigate({screen:'home',mode});};
if(window.history){
 window.history.scrollRestoration='manual';window.history.replaceState(historyState(view),'','#home');
 window.addEventListener('popstate',e=>{if(!e.state?.parallax)return;savePosition();applyView(e.state);});
}

fetch('/api/catalog').then(r=>{if(!r.ok)throw new Error('CATALOG_UNAVAILABLE');return r.json();}).then(data=>{catalog=data.scenarios;for(const [i,s] of catalog.entries()){const o=el('option',`${s.name} · ${label(s.chain)} · ${day(s.cutoff)}`);o.value=i;$('scenario').append(o);}if(data.mode!=='live')$('setup-copy').dataset.offline='true';}).catch(failure);
function input(){if(mode==='time-machine'){const s=catalog[Number($('scenario').value)];if(!s)throw new Error('SCENARIOS_NOT_READY');return {chain:s.chain,token:s.token,cutoff:s.cutoff,windowDays:s.windowDays};}return {chain:$('chain').value,token:$('token').value.trim(),cutoff:$('cutoff').value+($('cutoff').value.length===16?':00Z':'Z'),windowDays:Number($('window').value)};}
$('investigate').oninput=()=>{offer=null;show('quote',false);};
$('investigate').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('estimate').disabled=true;$('status').textContent='Checking local cache and execution cost…';try{const requested=input();const candidate=await post('/api/quote',{mode,input:requested});if(JSON.stringify(requested)!==JSON.stringify(input()))throw new Error('INPUT_CHANGED');offer=candidate;$('quote-copy').textContent=`${offer.cached?'Cached evidence':'Uncached reconstruction'} · ${offer.source==='local fixture'?'Saved Nansen observations':offer.source} · ${offer.credits} estimated Nansen credits.${offer.source==='local fixture'?' This connection contains saved observations only. Other tokens may have no recoverable historical coverage.':''}`;$('run').textContent=offer.credits?`Approve up to ${offer.credits} credits & reconstruct →`:'Reconstruct THEN · 0 credits →';show('quote',true);$('status').textContent='Estimate ready. No evidence calls have been made.';}catch(err){failure(err);}finally{finishNavigation();$('estimate').disabled=false;}};
function stage(index){show('stages',true);[...$('stages').children].forEach((n,i)=>n.classList.toggle('active',i===index));}
$('run').onclick=async()=>{if(busy||!offer)return;busy=true;$('run').disabled=true;stage(0);$('status').textContent='Cutoff validated. Reconstructing completed historical evidence…';try{stage(1);current=await post('/api/start',{quote:offer.quote,approvedCredits:offer.credits});stage(2);sessions.set(current.session,current);if(mode==='time-machine')machineSession=current.session;render(current);busy=false;if(!pendingView)navigate({screen:'dossier',mode,session:current.session});$('status').textContent=mode==='time-machine'?'The dossier is open. What happened next remains sealed.':'THEN sealed. Future data has not been requested.';}catch(err){failure(err);offer=null;show('quote',false);show('stages',false);}finally{finishNavigation();$('run').disabled=false;}};
// Native modal dialog provides focus containment and Escape dismissal.
function openReceipt(claim,extra,push=true){
 if(push){receiptTrigger=document.activeElement;receiptParent=view;savePosition();view={screen:'receipt',mode,session:current.session,claim,extra,epoch,key:++sequence};window.history?.pushState(historyState(view),'','#receipt');}
 show('back',true);
 const r=current.sealed.receipts.find(r=>r.claim===claim);
 $('receipt-content').replaceChildren();
 if(r){
  $('receipt-content').append(el('h3',label(r.claim.replaceAll('.',' / '))),el('p',r.methodology));
  const dl=el('dl');
  const coverage=r.inputs?.coverage??r.inputs?.status??r.value?.coverage??current.sealed.coverage.status;
  const facts=[['Source',r.source+' / '+r.provenance],['Cutoff',r.cutoff],['Requested window',r.window.from+' → '+r.window.to],['Temporal coverage',String(coverage).toUpperCase()],['Evidence source',r.evidenceSource]];
  const observedFrom=r.inputs?.observedFrom??(Array.isArray(extra)?extra[0]?.start:null)??(claim.startsWith('segment.')?current.details.context?.summaryFrom:null);
  const observedTo=r.inputs?.observedTo??(Array.isArray(extra)?extra.at(-1)?.end:null)??(claim.startsWith('segment.')?r.cutoff:null);
  if(observedFrom&&observedTo)facts.splice(3,0,['Observed window',observedFrom+' → '+observedTo]);
  for(const [name,value] of facts)dl.append(el('dt',name),el('dd',value));
  $('receipt-content').append(dl);
  const details=el('details');details.append(el('summary','Inspect methodology & derived evidence'),el('pre',JSON.stringify({value:r.value,inputs:r.inputs,classifications:extra??null,receiptId:r.id,engine:r.version},null,2)));
  $('receipt-content').append(details);
 }else $('receipt-content').append(el('p','No receipt is available for this channel.'));
 $('receipt').showModal();
}
$('close-receipt').onclick=()=>{if(window.history)back();else $('receipt').close();};
$('receipt').oncancel=e=>{e.preventDefault();$('close-receipt').onclick();};
$('receipt').onclose=()=>{receiptTrigger?.focus({preventScroll:true});if(closingReceipt){closingReceipt=false;return;}if(view.screen==='receipt')back();};
$('launch-machine').onclick=async()=>{
 if(busy)return;
 if(machineSession){navigate({screen:'dossier',mode:'time-machine',session:machineSession});return;}
 busy=true;$('launch-machine').disabled=true;show('quote',false);$('status').textContent='Opening the sealed dossier…';
 try{
  const candidate=await post('/api/quote',{mode,input:input()});
  // Time Machine is saved history. Never silently consent to a paid reconstruction.
  if(candidate.credits!==0)throw new Error('SAVED_DOSSIER_UNAVAILABLE');
  offer=candidate;busy=false;await $('run').onclick();
 }catch(err){failure(err);}finally{finishNavigation();$('launch-machine').disabled=false;}
};
function receiptButton(text,claim,extra){const b=el('button',`${text} ↗`,'quiet');b.onclick=()=>openReceipt(claim,extra);return b;}
function render({sealed:s,details:d}){
 $('case-mode').textContent=mode==='time-machine'?'TIME MACHINE / DOSSIER 001':'INVESTIGATE / HISTORICAL RECONSTRUCTION';const scenario=catalog.find(c=>c.token===s.query.token&&c.cutoff===s.query.cutoff);$('case-title').classList.toggle('token-title',!scenario);$('case-title').textContent=(scenario?'PEPE / Ethereum':null)??`${s.query.token.slice(0,8)}…${s.query.token.slice(-6)}`;$('case-cutoff').textContent=`${label(s.query.chain)} · ${dateLabel(s.query.cutoff)} · ${s.query.cutoff.slice(11,19)} UTC\nExact cutoff: ${s.query.cutoff}\n${s.query.token}`;$('character').replaceChildren(receiptButton(s.character,'character'));$('coverage').textContent=`${s.coverage.status==='complete'?'RECONSTRUCTION COMPLETE':'TEMPORAL RECONSTRUCTION INCOMPLETE'} · ${s.coverage.status.toUpperCase()} COVERAGE · ${s.coverage.availableChannels}/${s.coverage.totalChannels} evidence channels recovered. ${s.conflict.availableSegments} of ${s.conflict.totalSegments} participant segments available. Missing history is not neutral. Recovered: ${[s.conflict.availableSegments?'participant flows':null,s.paths.some(p=>p.buckets>0)?'movement history':null,s.priceContext.status==='available'?'historical prices':null].filter(Boolean).join(', ')||'none'}.`;
 $('state').replaceChildren(el('h3',dateLabel(s.query.cutoff)+' / At the cutoff'));
 const missing=el('details',undefined,'missing-channels');missing.append(el('summary','UNAVAILABLE / '+s.segments.filter(x=>x.status!=='available').length+' historically unresolved segments'));
 for(const segment of s.segments){const observed=d.segments.find(x=>x.segment===segment.segment),row=el('div',undefined,'state-row');row.append(receiptButton(segment.segment==='smart_trader'?'Smart Traders':label(segment.segment),`segment.${segment.segment}`,observed),el('strong',observed?.status==='available'?observed.direction:'UNAVAILABLE',observed?.status==='available'?'':'unavailable'));row.append(el('small',observed?.status==='available'?'Derived participant direction':d.context?.coverageStart?`Temporal label history starts ${d.context.coverageStart}; this cutoff is not covered.`:'NOT HISTORICALLY RESOLVABLE. No validated temporal coverage for this segment.'));if(observed?.status==='available')$('state').append(row);else missing.append(row);}
 if(s.segments.some(x=>x.status!=='available'))$('state').append(missing);
 if(d.context?.baselineAvailable)$('state').append(el('p','Validated cutoff baseline retained server-side.','hint'));
 if(s.priceContext.status==='available')$('state').append(receiptButton('Price context','priceContext'));
 const path=s.paths.find(p=>p.cohort==='smart_money');$('path-summary').textContent=path?`${path.coverage.toUpperCase()} HISTORY / ${path.buckets} completed observations. Inflow and outflow describe token movement, not trading intent.`:'Path unavailable. No completed historical movement buckets were recovered.';
 $('path-receipt').onclick=()=>openReceipt('smart_money.reversalRatio',d.timeline);$('path-receipt').disabled=!path;
 $('timeline').replaceChildren();$('all-observations').replaceChildren();
 for(const row of d.timeline){
  const active=!['FLAT','UNAVAILABLE'].includes(row.direction);
  const makeRow=()=>{const li=el('li');li.append(el('time',dateLabel(row.start)+' / '+label(row.cohort)));
   const unit=scenario?' PEPE':'';
   const movement=label(row.direction)+' movement';
   li.append(el('p',movement,active?'movement':'flat'),el('small','Parallax classification · completed historical bucket'));
   return li;};
  $('all-observations').append(makeRow());
  if(active){const li=makeRow();li.append(receiptButton('Inspect observation',row.cohort+'.direction',[row]));$('timeline').append(li);}
 }
 if(!d.timeline.length)$('timeline').append(el('li','UNAVAILABLE / No completed movement observations.'));
 if(path?.breadth){const b=path.breadth,li=el('li');li.append(el('time',dateLabel(b.observedTo)+' / HOLDER BREADTH'),el('p',label(b.direction)+' holder base','movement'),el('small','Derived holder breadth across the observed window'),receiptButton('Inspect holder evidence','smart_money.breadth',d.timeline));$('timeline').append(li);}
 $('conflict').replaceChildren(el('h3','Where the evidence disagrees.'),receiptButton(s.conflict.status,'conflict'),el('p',`${s.conflict.availableSegments} of ${s.conflict.totalSegments} segments available; ${s.conflict.directionalSegments} directional participant segments. Unavailable cohorts do not vote.`),receiptButton('Holder breadth','smart_money.breadth',d.timeline));
 for(const id of ['trust','pass']){$(id).disabled=false;$(id).classList.remove('selected');}show('break',false);$('wall-state').textContent='TEMPORAL FIREWALL / ACTIVE';$('locked').classList.remove('locked');$('wall-instruction').textContent='Read THEN. Lock a decision. The future can wait.';$('break').disabled=true;$('break').textContent='BREAK THE FIREWALL ↓';$('locked').textContent='Your decision will lock.';$('firewall-title').textContent='Future classified.';$('firewall-copy').textContent=mode==='time-machine'?'What happened next remains sealed. Make your call from the evidence available then.':'Later prices have not been requested. Make a call from the evidence available here.';$('firewall').classList.remove('breached','breaching','decision-ready');show('outcome',false);$('horizons').replaceChildren();$('trajectory').replaceChildren();revealCredits=null;
}
function renderDecision(decision){$('trust').disabled=true;$('pass').disabled=true;$('locked').textContent=`DECISION LOCKED / ${decision} · This choice cannot be changed.`;$('locked').classList.add('locked');$(decision.toLowerCase()).classList.add('selected');$('firewall').classList.add('decision-ready');$('wall-instruction').textContent=mode==='time-machine'?'Your call is sealed. Cross the firewall to see what followed.':'Decision recorded. The next step requests the separate AFTER record.';show('break',true);$('break').disabled=false;}
async function decide(decision){if(busy||!current||current.decision)return;busy=true;$('trust').disabled=true;$('pass').disabled=true;try{const r=await post('/api/decision',{session:current.session,decision});current.decision=r.decision;renderDecision(r.decision);$('break').focus();$('status').textContent='Decision locked. You can now explicitly request the future.';}catch(err){failure(err);$('trust').disabled=false;$('pass').disabled=false;}finally{finishNavigation();}}
$('trust').onclick=()=>decide('TRUST');$('pass').onclick=()=>decide('PASS');
function trajectory(points){$('trajectory').replaceChildren();if(!points.length)return;$('trajectory').append(el('h3','Relative price performance · cutoff = 0%'));const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 700 230');svg.setAttribute('class','trajectory-chart');svg.setAttribute('role','img');svg.setAttribute('aria-label','Derived daily returns relative to the cutoff.');const lo=Math.min(...points.map(p=>p.percent)),hi=Math.max(...points.map(p=>p.percent)),t0=Date.parse(points[0].at),t1=Date.parse(points.at(-1).at);const coords=points.map(p=>[35+(Date.parse(p.at)-t0)/(t1-t0||1)*610,180-(p.percent-lo)/(hi-lo||1)*150]);const line=document.createElementNS(ns,'polyline');line.setAttribute('points',coords.map(x=>x.join(',')).join(' '));svg.append(line);coords.forEach(([x,y],i)=>{const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',4);const text=document.createElementNS(ns,'text');text.setAttribute('x',x);text.setAttribute('y',210);text.setAttribute('text-anchor','middle');text.textContent=day(points[i].at).slice(5);svg.append(dot,text);});$('trajectory').append(svg);const table=el('table',undefined,'trajectory-table'),head=el('tr');head.append(el('th','UTC day'),el('th','Return from cutoff'));table.append(head);for(const p of points){const row=el('tr');row.append(el('td',day(p.at)),el('td',p.percent.toFixed(2)+'%'));table.append(row);}const detail=el('details');detail.append(el('summary','Inspect daily relative returns'),table);$('trajectory').append(detail);}
function renderOutcome(r){$('break').disabled=true;$('firewall').classList.remove('breaching');$('firewall').classList.add('breached');$('wall-state').textContent='TEMPORAL FIREWALL / OPEN';$('wall-instruction').textContent='AFTER is now available below. Your decision remains locked.';$('firewall-title').textContent='Firewall opened.';$('firewall-copy').textContent='Your original evidence and locked decision are preserved above.';$('outcome-title').textContent=r.status==='unavailable'?'The record ends here.':'Knowing changes the view.';$('outcome-story').textContent=r.message;$('horizons').replaceChildren();for(const h of r.horizons){const item=el('div',undefined,'horizon');item.append(el('small',(h.days===1?'+24H':`+${h.days}D`)+' / '+dateLabel(new Date(Date.parse(r.cutoff)+h.days*86400000).toISOString())),el('strong',h.percent===null?'UNAVAILABLE':`${h.percent>=0?'+':''}${h.percent.toFixed(2)}%`),el('small',h.percent===null?'Validated return unavailable':'Return from validated cutoff baseline'));$('horizons').append(item);}trajectory(r.trajectory);$('outcome-method').textContent=`${r.status.toUpperCase()} OUTCOME COVERAGE · ${r.methodology} Source: ${r.source}. Cutoff: ${r.cutoff}.`;$('break').textContent='FIREWALL OPENED';show('outcome',true);}
$('break').onclick=async()=>{if(busy||!current||!current.decision||current.after)return;busy=true;$('break').disabled=true;$('status').textContent='Requesting the separate AFTER record…';$('wall-instruction').textContent='Requesting the separate AFTER record…';try{const r=await post('/api/break',{session:current.session,...(revealCredits?{approvedCredits:revealCredits}:{})});if(r.approvalRequired){revealCredits=r.credits;$('break').textContent=`APPROVE ${r.credits} CREDITS & REVEAL`;$('break').disabled=false;$('status').textContent=`The uncached reveal is estimated at ${r.credits} Nansen credits. Approve explicitly to continue.`;return;}$('firewall').classList.add('breaching');$('break').textContent='OPENING THE FIREWALL…';$('status').textContent='Opening the temporal boundary…';await revealMotion();current.after=r;renderOutcome(r);$('outcome').focus();$('status').textContent=`AFTER ${r.status==='unavailable'?'unavailable':'revealed'}. Your decision remains locked.`;}catch(err){failure(err);$('wall-instruction').textContent=$('status').textContent;$('break').textContent='RETRY REVEAL ↓';revealCredits=null;$('firewall').classList.remove('breaching');$('break').disabled=false;}finally{finishNavigation();}};







// The response exists only after explicit /api/break. Nothing is preloaded for motion.
async function revealMotion(){
 if(!window.setTimeout||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
 await new Promise(resolve=>window.setTimeout(resolve,1800));
}
