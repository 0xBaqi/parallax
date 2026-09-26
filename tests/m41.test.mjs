import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {mapOhlcv,NansenAdapter} from '../server/adapter.mjs';
import {normalizeCandles} from '../server/normalize.mjs';
import {request,DAY} from '../server/contracts.mjs';
import {publicResponse} from '../server/public-output.mjs';
import {CuratedAdapter,Experience} from '../server/experience.mjs';
import {Service} from '../server/service.mjs';
import {Store} from '../server/store.mjs';
import {Budget} from '../server/costs.mjs';
import {createApp} from '../server/http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const q=request({chain:'solana',token:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',cutoff:'2024-02-24T00:00:00Z',windowDays:12});
const candle={interval_start:'2024-02-23T00:00:00Z',open:10,high:12,low:9,close:11,volume:null,volume_usd:null,market_cap:null};
const native=(data=[candle])=>({chain:q.chain,token_address:q.token,timeframe:'1d',data,truncated:false});
function store(t){const dir=mkdtempSync(join(tmpdir(),'parallax-m41-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return new Store(dir);}
function setup(t){const db=store(t),adapter=new CuratedAdapter(join(root,'fixtures')),service=new Service({adapter,store:db});return {db,adapter,service,experience:new Experience({service,timeMachine:service})};}
async function start(h){const {name,...input}=h.adapter.scenarios()[0];const offer=h.experience.quote({mode:'time-machine',input});return h.experience.start({quote:offer.quote});}
function assertDerived(value){
  const prohibited=new Set(['netUsd','walletCount','inflow','outflow','holders','close','open','high','low','volume','volume_usd','market_cap','netTokens','flowImbalance','baseline','raw']);
  function walk(v){if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){assert.ok(!prohibited.has(k),k);walk(x);}}walk(value);
}
test('M4.1 beta daily rows map explicit ends and allow nullable unused volume/market-cap',()=>{
  const result=normalizeCandles(mapOhlcv(native(),q),q);assert.equal(result.length,1);assert.equal(result[0].end,q.cutoff);assert.equal(result[0].close,11);
  assert.deepEqual(mapOhlcv({success:true,data:native()},q),mapOhlcv(native(),q));
});
test('M4.1 archived beta candles normalize under a completed daily boundary',()=>{
  const p=JSON.parse(readFileSync(join(root,'curated/before-0.json'),'utf8'));
  const from=p.data[0].interval_start,cutoff=new Date(Date.parse(p.data.at(-1).interval_start)+DAY).toISOString();
  const result=normalizeCandles(mapOhlcv(p,{chain:p.chain,token:p.token_address,from,cutoff}),{from,cutoff});
  assert.equal(p.data.length,13);assert.equal(result.length,13);
});
for(const field of ['open','high','low','close'])test(`M4.1 ${field} null/missing/string remains unavailable, never zero`,()=>{
  for(const value of [null,undefined,'11',Infinity])assert.equal(normalizeCandles(mapOhlcv(native([{...candle,[field]:value}]),q),q).length,0);
});
test('M4.1 wrong metadata and truncation fail closed; omitted default false is accepted',()=>{
  for(const patch of [{chain:'ethereum'},{token_address:'wrong'},{timeframe:'4h'},{truncated:true},{truncated:null},{truncated:'false'},{data:null}])assert.equal(mapOhlcv({...native(),...patch},q).candles.length,0);
  const p=native();delete p.truncated;assert.equal(mapOhlcv(p,q).candles.length,1);
  assert.equal(mapOhlcv({data:[{date:q.from,bucket_end:q.cutoff,is_complete:true}]},q).candles.length,0);
});
test('M4.1 cutoff, UTC alignment, duplicate and future rows cannot manufacture completed candles',()=>{
  assert.equal(normalizeCandles(mapOhlcv(native([candle,candle]),q),q).length,0);
  for(const at of ['2024-02-24T00:00:00Z','2024-02-23T12:00:00Z','invalid'])assert.equal(mapOhlcv(native([{...candle,interval_start:at}]),q).candles.length,0);
  assert.equal(mapOhlcv(native(),{...q,cutoff:'2024-02-23T23:59:59Z'}).candles.length,0);
});
test('M4.1 all dossier and reveal surfaces are derived-only and attributed; raw stays private',async t=>{
  const h=setup(t),raw=await start(h),before=publicResponse(raw);assertDerived(before);
  assert.ok(raw.details.segments.some(s=>s.netUsd!==null));assert.equal(before.details.segments[0].direction,'DISTRIBUTING');
  assert.equal(before.attribution,'Powered by Nansen');assert.ok(before.sealed.receipts.every(r=>r.source==='Powered by Nansen'));
  h.experience.decide({session:raw.session,decision:'PASS'});const after=publicResponse(await h.experience.reveal({session:raw.session}));assertDerived(after);
  assert.equal(after.trajectory[0].percent,0);assert.equal(after.horizons[2].percent,234.93);assert.equal(after.trajectory.length,8);
  assert.ok(!JSON.stringify(before).includes('234.93'));assert.ok(!JSON.stringify(before).includes('2024-03-02'));
});
test('M4.1 serializer drops unrecognized top-level and raw-detail keys',async t=>{
  const h=setup(t),r=await start(h);r.raw='M41_PRIVATE_SENTINEL';r.details.raw='M41_PRIVATE_SENTINEL';r.sealed.raw='M41_PRIVATE_SENTINEL';r.sealed.receipts[0].inputs.raw='M41_PRIVATE_SENTINEL';
  assert.ok(!JSON.stringify(publicResponse(r)).includes('M41_PRIVATE_SENTINEL'));
});
test('M4.1 assets have visible linked attribution and no credential or source-map material',()=>{
  const html=readFileSync(join(root,'public/index.html'),'utf8');assert.ok((html.match(/Powered by Nansen/g)??[]).length>=4);assert.match(html,/href="https:\/\/nansen.ai\/"/);
  for(const name of readdirSync(join(root,'public'))){assert.ok(!name.endsWith('.map'));const text=readFileSync(join(root,'public',name),'utf8');assert.doesNotMatch(text,/NANSEN_API_KEY|sourceMappingURL|api\.nansen\.ai|BEGIN (?:RSA |EC )?PRIVATE KEY|M41_SECRET/);}
});
test('M4.1 transient failures are not retained as 24-hour missing coverage',async t=>{
  const db=store(t);let calls=0;const adapter=new NansenAdapter({apiKey:'M41_SECRET',approved:true,budget:new Budget(db,{limit:33}),fetchImpl:async()=>{calls++;return new Response('M41_SECRET',{status:503});}});
  const service=new Service({adapter,store:db}),experience=new Experience({service,timeMachine:setup(t).service});
  const input={chain:q.chain,token:q.token,cutoff:q.cutoff,windowDays:q.windowDays};await service.investigate(input);
  const quote=experience.quote({mode:'investigate',input});assert.equal(quote.cached,false);assert.equal(quote.credits,11);assert.equal(calls,1);
});
test('M4.1 durable operator rate limit survives restart and ignores client identity',async t=>{
  const db=store(t),adapter={live:true};const a=new Service({adapter,store:db});a.rate('one');a.rate('two');a.rate('three');assert.throws(()=>new Service({adapter,store:db}).rate('spoofed'),/UNCACHED_RATE_LIMIT/);
});
test('M4.1 spot request uses as_of_date, billing is private, unexpected cost stops remaining calls',async t=>{
  const db=store(t),bodies=[];const adapter=new NansenAdapter({apiKey:'M41_SECRET',approved:true,budget:new Budget(db,{limit:22}),fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));return Response.json(url.endsWith('historical-token-ohlcv')?native():{data:[]},{headers:{'X-Nansen-Credits-Cost':'1','X-Nansen-Credits-Used':'1','X-Nansen-Credits-Remaining':'99'}});}});
  await adapter.before(q);assert.equal(bodies.length,3);assert.equal(bodies[2].as_of_date,q.cutoff);assert.ok(!('as_of_ts' in bodies[2]));assert.equal(db.read('usage','calls').length,3);assert.ok(!JSON.stringify(db.read('usage','calls')).includes('M41_SECRET'));
  let calls=0;adapter.fetch=async()=>{calls++;return Response.json({data:[]},{headers:{'X-Nansen-Credits-Cost':'999'}});};await adapter.before(q);assert.equal(calls,1);
});
test('M4.1 HTTPS origin is explicit; foreign hosts, origins and forwarded headers are denied',async t=>{
  const h=setup(t),options={service:h.service,experience:h.experience,publicDir:join(root,'public')};
  for(const publicOrigin of ['http://example.com','https://example.com/','https://user@example.com'])assert.throws(()=>createApp({...options,publicOrigin}),/INVALID_PUBLIC_ORIGIN/);
  const app=createApp({...options,publicOrigin:'https://parallax.example'});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{app.close(r);app.closeAllConnections();}));const url=`http://127.0.0.1:${app.address().port}`;
  const get=headers=>new Promise((resolve,reject)=>{const req=httpRequest(url,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(await get({host:'parallax.example',origin:'https://parallax.example'}),200);
  assert.equal(await get({host:'evil.example','x-forwarded-host':'parallax.example'}),403);
  assert.equal(await get({host:'parallax.example',origin:'https://evil.example'}),403);
});
