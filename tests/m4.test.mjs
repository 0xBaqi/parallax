import test from 'node:test';
import { publicResponse } from '../server/public-output.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NansenAdapter } from '../server/adapter.mjs';
import { Budget } from '../server/costs.mjs';
import { Store } from '../server/store.mjs';
import { Service } from '../server/service.mjs';
import { CuratedAdapter, Experience } from '../server/experience.mjs';
import { createApp } from '../server/http.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const key='M4_SYNTHETIC_PROVIDER_SECRET_NOT_A_REAL_KEY';
const operator='M4-synthetic-operator-token-long-enough';
const wif=JSON.parse(readFileSync(join(root,'fixtures/wif.json'),'utf8'));
const input={chain:'solana',token:wif.token,cutoff:'2024-02-24T00:00:00Z',windowDays:12};
async function setup(t,fetchImpl) {
  const directory=mkdtempSync(join(tmpdir(),'parallax-m4-'));
  t.after(()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.includes('parallax-m4-'));rmSync(directory,{recursive:true,force:true});});
  const store=new Store(directory),calls=[];
  const adapter=new NansenAdapter({apiKey:key,approved:true,budget:new Budget(store,{limit:44,maxRequest:11}),fetchImpl:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    assert.equal(options.headers.apiKey,key);
    return fetchImpl(url,options);
  }});
  const service=new Service({adapter,store});
  const timeMachine=new Service({adapter:new CuratedAdapter(join(root,'fixtures')),store});
  const experience=new Experience({service,timeMachine});
  const app=createApp({service,experience,publicDir:join(root,'public'),adminToken:operator});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{app.close(r);app.closeAllConnections();}));
  const url=`http://127.0.0.1:${app.address().port}`;
  const post=async(path,body,auth=true)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${operator}`}:{})},body:JSON.stringify(body)});
  const start=async()=>{
    const quote=await (await post('/api/quote',{mode:'investigate',input})).json();
    const response=await post('/api/start',{quote:quote.quote,approvedCredits:quote.credits});
    assert.equal(response.status,200);
    return {quote,result:await response.json()};
  };
  return {store,service,timeMachine,experience,calls,url,post,start};
}

for(const status of [429,500])test(`M4 HTTP live transport ${status} produces incomplete evidence, redacts upstream body, and does not retry`,async t=>{
  const h=await setup(t,()=>new Response(JSON.stringify({error:key,raw:'UPSTREAM_PRIVATE_SENTINEL'}),{status}));
  const {result}=await h.start();
  assert.equal(result.sealed.coverage.status,'unsupported');
  assert.ok(result.sealed.segments.every(s=>s.direction==='UNAVAILABLE'));
  assert.equal(h.calls.length,1);
  assert.equal(h.store.read('budget','ledger').reserved,11);
  const payload=JSON.stringify(result);assert.ok(!payload.includes(key));assert.ok(!payload.includes('UPSTREAM_PRIVATE_SENTINEL'));
  assert.equal((await h.post('/api/decision',{session:result.session,decision:'PASS'})).status,200);
  const reveal=await (await h.post('/api/break',{session:result.session})).json();
  assert.equal(reveal.status,'unavailable');assert.equal(h.calls.length,1);
});

test('M4 malformed successful upstream JSON fails closed through the session API',async t=>{
  const h=await setup(t,()=>new Response('{invalid JSON '+key));
  const {result}=await h.start();assert.equal(result.sealed.coverage.status,'unsupported');
  assert.equal(h.calls.length,1);assert.ok(!JSON.stringify(result).includes(key));
});

test('M4 exact HTTP investigation repeat and service restart reuse cache without another transport call or reservation',async t=>{
  const h=await setup(t,url=>Response.json(url.endsWith('historical-token-ohlcv')?{chain:'solana',token_address:input.token,timeframe:'1d',data:[],truncated:false}:{data:[]}));
  const first=await h.start();assert.equal(first.quote.credits,11);assert.equal(h.calls.length,3);
  const second=await h.start();assert.equal(second.quote.cached,true);assert.equal(second.quote.credits,0);
  assert.deepEqual(first.result.sealed,second.result.sealed);assert.deepEqual(first.result.details,second.result.details);
  assert.equal(h.calls.length,3);assert.equal(h.store.read('budget','ledger').reserved,11);
  const rebootService=new Service({adapter:h.service.adapter,store:h.store});
  const reboot=new Experience({service:rebootService,timeMachine:h.timeMachine});
  const quote=reboot.quote({mode:'investigate',input});assert.equal(quote.cached,true);assert.equal(quote.credits,0);
  assert.deepEqual(publicResponse(await reboot.start({quote:quote.quote})).sealed,first.result.sealed);
  assert.equal(h.calls.length,3);assert.equal(h.store.read('budget','ledger').reserved,11);
});

test('M4 invalid input and unauthorized live access make no transport calls or budget reservation',async t=>{
  const h=await setup(t,()=>{throw new Error('must not fetch');});
  assert.equal((await h.post('/api/quote',{mode:'investigate',input},false)).status,401);
  for(const patch of [{token:'<script>alert(1)</script>'},{chain:'unsupported'},{cutoff:'bad-date'},{windowDays:31}]){
    const response=await h.post('/api/quote',{mode:'investigate',input:{...input,...patch}});
    assert.ok([400,422].includes(response.status));
  }
  assert.equal(h.calls.length,0);assert.equal(h.store.read('budget','ledger'),null);
});

test('M4 native OHLCV and future flow rows cannot cross the pre-reveal session boundary',async t=>{
  const h=await setup(t,url=>Response.json(url.endsWith('tgm/flows')?{data:[{date:'2024-02-25T00:00:00Z',bucket_end:'2024-02-26T00:00:00Z',is_complete:true,total_inflows_count:987654321,total_outflows_count:0,holders_count:87654321}],pagination:{is_last_page:true}}:url.endsWith('historical-token-ohlcv')?{chain:'solana',token_address:input.token,timeframe:'1d',data:[{interval_start:'2024-02-25T00:00:00Z',open:98765,high:98765,low:98765,close:98765,market_cap:{}}]}:{data:[{smart_trader_net_flow_usd:null,whale_net_flow_usd:null}]}));
  const {result}=await h.start();
  assert.equal(result.details.timeline.length,0);assert.equal(result.sealed.priceContext.status,'unavailable');
  assert.ok(result.details.segments.every(s=>s.direction==='UNAVAILABLE'));
  const text=JSON.stringify(result);
  for(const marker of ['98765','87654321','2024-02-25','2024-02-26','return7dPct','OUTCOME',key])assert.ok(!text.includes(marker),marker);
  assert.equal((await h.post('/api/break',{session:result.session})).status,409);assert.equal(h.calls.length,3);
});

test('M4 production route allowlist hides maps, settings, private fixtures and synthetic key',async t=>{
  const h=await setup(t,()=>Response.json({data:[]}));
  for(const path of ['/','/app.js','/style.css']){
    const response=await fetch(h.url+path);assert.equal(response.status,200);
    const text=await response.text();assert.ok(!text.includes(key));assert.ok(!text.includes('sourceMappingURL'));
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  for(const path of ['/.env','/app.js.map','/dist/manifest.json','/server/adapter.mjs','/fixtures/wif.json','/curated/outcome-0.json','/.data/budget/ledger.json'])assert.equal((await fetch(h.url+path)).status,404);
  assert.equal(h.calls.length,0);
});

const link={chain:'ethereum',token:'0x514910771AF9Ca656af840dff83E8264EcF986CA',cutoff:'2025-06-15T00:00:00Z',windowDays:12};
for(const failure of [null,'budget','upstream'])test('M4.2 LINK HTTP lifecycle '+(failure??'success')+' preserves consent, lock, receipts and firewall',async t=>{
 let outcome=false;
 const h=await setup(t,(url,options)=>{
  const b=JSON.parse(options.body);
  if(url.endsWith('historical-token-ohlcv')){
   outcome=b.date_from.startsWith('2025-06-15');
   if(outcome&&failure==='upstream')return new Response('private upstream detail',{status:500});
   const from=Date.parse(b.date_from),end=Date.parse(b.as_of_date);
   return Response.json({chain:b.chain,token_address:b.token_address,timeframe:'1d',data:Array.from({length:(end-from)/86400000},(_,i)=>({interval_start:new Date(from+i*86400000).toISOString(),open:100+i,high:110+i,low:90+i,close:105+i}))});
  }
  return Response.json({data:[]});
 });
 const quote=await (await h.post('/api/quote',{mode:'investigate',input:link})).json();
 const before=await (await h.post('/api/start',{quote:quote.quote,approvedCredits:11})).json();
 const sealed=JSON.stringify(before.sealed),session=before.session;
 assert.equal(h.calls.length,3);assert.equal(outcome,false);
 for(const forbidden of ['/api/v1','_net_flow_usd','total_inflows_count','total_outflows_count','holders_count','bucket_end','interval_start','token_address',key,operator,'private upstream detail','2025-06-16','return7dPct'])assert.ok(!JSON.stringify(before).includes(forbidden),forbidden);
 assert.ok(before.sealed.receipts.every(r=>r.evidenceSource&&r.methodology&&r.cutoff&&r.window&&!('fields' in r)&&!('endpoint' in r)));
 assert.equal((await h.post('/api/break',{session})).status,409);
 await h.post('/api/decision',{session,decision:'PASS'});
 assert.deepEqual(await (await h.post('/api/break',{session})).json(),{credits:5,approvalRequired:true});
 assert.equal(h.calls.length,3);
 assert.equal((await h.post('/api/break',{session,approvedCredits:5},false)).status,401);
 if(failure==='budget')h.service.adapter.budget.limit=11;
 const response=await h.post('/api/break',{session,approvedCredits:5}),after=await response.json();
 if(failure){assert.equal(response.status,failure==='budget'?429:502);assert.equal(after.error,failure==='budget'?'CREDIT_BUDGET_EXCEEDED':'OUTCOME_SOURCE_UNAVAILABLE');assert.equal(h.store.read('reveals',before.sealed.id),null);}
 else {assert.equal(response.status,200);assert.equal(after.decision,'PASS');assert.equal(after.horizons.length,3);assert.ok(after.horizons.every(h=>Number.isFinite(h.percent)));assert.deepEqual(await (await h.post('/api/break',{session})).json(),after);}
 assert.equal(h.calls.length,failure==='budget'?3:4);
 assert.equal((await h.post('/api/decision',{session,decision:'TRUST'})).status,409);
 assert.equal(JSON.stringify(publicResponse(h.store.read('investigations',before.sealed.id).sealed)),sealed);
});
