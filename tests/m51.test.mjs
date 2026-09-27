import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../server/store.mjs';
import {Budget} from '../server/costs.mjs';
import {NansenAdapter} from '../server/adapter.mjs';
import {Service} from '../server/service.mjs';
import {CuratedAdapter,Experience} from '../server/experience.mjs';
import {createApp} from '../server/http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const key='SYNTHETIC_M51_PROVIDER_SECRET',admin='SYNTHETIC_M51_ADMIN_SECRET_LONG_ENOUGH';
const input={chain:'ethereum',token:'0x'+'a'.repeat(40),cutoff:'2025-06-15T00:00:00Z',windowDays:12};
async function setup(t,{publicDemo=true,legacy=false,future=false}={}){
 const directory=mkdtempSync(join(tmpdir(),'parallax-m51-'));
 const store=new Store(directory),calls=[];
 const adapter=new NansenAdapter({apiKey:key,approved:true,budget:new Budget(store,{limit:30,maxRequest:11}),fetchImpl:async(url,options)=>{
  const b=JSON.parse(options.body);calls.push(b);
  if(url.endsWith('historical-token-ohlcv')){
   const from=Date.parse(b.date_from),end=Date.parse(b.as_of_date);
   return Response.json({chain:b.chain,token_address:b.token_address,timeframe:'1d',data:future?[{interval_start:'2025-06-16T00:00:00Z',open:98765,high:98765,low:98765,close:98765}]:Array.from({length:(end-from)/86400000},(_,i)=>({interval_start:new Date(from+i*86400000).toISOString(),open:100+i,high:110+i,low:90+i,close:105+i}))});
  }
  return Response.json({data:[]});
 }});
 const service=new Service({store,adapter}),timeMachine=new Service({store,adapter:new CuratedAdapter(join(root,'fixtures'))});
 const experience=new Experience({service,timeMachine});
 const app=createApp({service,experience:legacy?null:experience,publicDir:join(root,'public'),adminToken:admin,publicDemo});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>{app.close(r);app.closeAllConnections();});rmSync(directory,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${app.address().port}`;
 const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const quote=async(q=input)=>(await post('/api/quote',{mode:'investigate',input:q})).json();
 const start=async()=>{const q=await quote();return (await post('/api/start',{quote:q.quote,approvedCredits:q.credits})).json();};
 return {store,service,timeMachine,experience,calls,url,post,quote,start,directory};
}
test('M5.1 anonymous lifecycle retains consent, decision lock, derived output and cached reveal',async t=>{
 const h=await setup(t),q=await h.quote();assert.equal(q.credits,11);assert.equal(h.calls.length,0);
 assert.equal((await h.post('/api/start',{quote:q.quote})).status,409);
 const r=await h.post('/api/start',{quote:q.quote,approvedCredits:11});assert.equal(r.status,200);const before=await r.json();
 assert.equal(h.calls.length,3);assert.equal((await h.post('/api/break',{session:before.session})).status,409);
 assert.equal((await h.post('/api/decision',{session:before.session,decision:'PASS'})).status,200);
 assert.equal((await h.post('/api/decision',{session:before.session,decision:'TRUST'})).status,409);
 assert.deepEqual(await (await h.post('/api/break',{session:before.session})).json(),{credits:5,approvalRequired:true});assert.equal(h.calls.length,3);
 const after=await (await h.post('/api/break',{session:before.session,approvedCredits:5})).json();assert.equal(after.status,'complete');assert.equal(h.calls.length,4);
 assert.deepEqual(await (await h.post('/api/break',{session:before.session})).json(),after);assert.equal(h.calls.length,4);
 for(const marker of [key,admin,'2025-06-16','return7dPct','token_address','interval_start','/api/v1'])assert.ok(!JSON.stringify(before).includes(marker),marker);
 for(const data of [q,before,after])for(const secret of [key,admin])assert.ok(!JSON.stringify(data).includes(secret));
});
for(const guard of ['max','budget'])test('M5.1 anonymous '+guard+' guard blocks before transport',async t=>{
 const h=await setup(t);if(guard==='max')h.service.adapter.budget.maxRequest=10;else h.store.write('budget','ledger',{reserved:30});
 const q=await h.quote(),r=await h.post('/api/start',{quote:q.quote,approvedCredits:11});assert.equal(r.status,429);assert.equal((await r.json()).error,'CREDIT_BUDGET_EXCEEDED');assert.equal(h.calls.length,0);
});
test('M5.1 durable uncached limiter survives new service; cache remains free at exhausted budget',async t=>{
 const h=await setup(t),first=await h.start();h.store.write('budget','ledger',{reserved:30});h.store.write('rate','operator',{times:Array(3).fill(Date.now())});
 const q=await h.quote();assert.equal(q.cached,true);assert.equal(q.credits,0);const again=await h.start();assert.deepEqual(again.sealed,first.sealed);assert.equal(h.calls.length,3);
 const reboot=new Service({adapter:h.service.adapter,store:h.store});await assert.rejects(()=>reboot.investigate({...input,token:'0x'+'b'.repeat(40)}),{code:'UNCACHED_RATE_LIMIT'});assert.equal(h.calls.length,3);
});
test('M5.1 public request limit is durable and ignores spoofed forwarded addresses',async t=>{
 const h=await setup(t);h.store.write('rate','public-workflow',{times:Array(119).fill(Date.now())});assert.equal((await h.post('/api/quote',{mode:'investigate',input})).status,200);
 for(const path of ['/api/quote','/api/start','/api/decision','/api/break']){const r=await h.post(path,{}, {'X-Forwarded-For':'203.0.113.9'});assert.equal(r.status,429);assert.equal((await r.json()).error,'PUBLIC_RATE_LIMIT');}
 assert.equal(h.store.read('rate','public-workflow').times.length,120);assert.equal(h.calls.length,0);
 const rebootService=new Service({store:new Store(h.directory),adapter:h.service.adapter});
 const reboot=createApp({service:rebootService,experience:h.experience,publicDir:join(root,'public'),adminToken:admin,publicDemo:true});
 await new Promise(r=>reboot.listen(0,'127.0.0.1',r));
 try {
  const r=await fetch(`http://127.0.0.1:${reboot.address().port}/api/quote`,{method:'POST',headers:{'Content-Type':'application/json','Forwarded':'for=198.51.100.1','X-Real-IP':'198.51.100.2'},body:JSON.stringify({mode:'investigate',input})});
  assert.equal(r.status,429);assert.equal((await r.json()).error,'PUBLIC_RATE_LIMIT');
  rebootService.now=()=>Date.now()+61000;
  const recovered=await fetch(`http://127.0.0.1:${reboot.address().port}/api/quote`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'investigate',input})});
  assert.equal(recovered.status,200);assert.equal(h.calls.length,0);
 } finally {await new Promise(r=>{reboot.close(r);reboot.closeAllConnections();});}
});
test('M5.1 demo must be boolean true and disabled mode protects every Investigate stage',async t=>{
 for(const publicDemo of [false,'true']){
  const h=await setup(t,{publicDemo}),auth={Authorization:`Bearer ${admin}`};
  const q=await (await h.post('/api/quote',{mode:'investigate',input},auth)).json();
  assert.equal((await h.post('/api/start',{quote:q.quote,approvedCredits:11})).status,401);
  const before=await (await h.post('/api/start',{quote:q.quote,approvedCredits:11},auth)).json();
  for(const path of ['/api/decision','/api/break'])assert.equal((await h.post(path,{session:before.session})).status,401);
  assert.equal(h.calls.length,3);
 }
});
test('M5.1 future candles remain unavailable before decision',async t=>{
 const h=await setup(t,{future:true}),before=await h.start();assert.equal(before.sealed.priceContext.status,'unavailable');for(const marker of ['98765','2025-06-16'])assert.ok(!JSON.stringify(before).includes(marker));assert.equal((await h.post('/api/break',{session:before.session})).status,409);
});
test('M5.1 public assets remove token entry and private routes remain hidden',async t=>{
 const h=await setup(t);for(const path of ['/','/app.js','/style.css']){const r=await fetch(h.url+path);assert.equal(r.status,200);const text=await r.text();for(const marker of [key,admin,'Operator access token','local operator access token','auth-label','headers.Authorization'])assert.ok(!text.includes(marker),marker);}
 for(const path of ['/.env','/server/main.mjs','/.data/budget/ledger.json','/fixtures/wif.json'])assert.equal((await fetch(h.url+path)).status,404);
 for(const path of ['/api/investigate','/api/reveal'])assert.equal((await h.post(path,{})).status,409);
 assert.equal((await h.post('/api/quote',{mode:'investigate',input},{Origin:'https://attacker.invalid'})).status,403);assert.equal(h.calls.length,0);
});
test('M5.1 disabled demo and standalone legacy API still require admin authorization',async t=>{
 const h=await setup(t,{publicDemo:false});assert.equal((await h.post('/api/quote',{mode:'investigate',input})).status,401);
 const legacy=await setup(t,{legacy:true});for(const path of ['/api/investigate','/api/reveal'])assert.equal((await legacy.post(path,{})).status,401);assert.equal(legacy.calls.length,0);
});

