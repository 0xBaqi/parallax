import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, DAY, envelope, request, digest, instant } from './contracts.mjs';
import { COSTS, DEFAULT_PLAN } from './costs.mjs';

export class FixtureAdapter {
  constructor(directory) {
    this.fixtures=readdirSync(directory).filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(readFileSync(join(directory,f),'utf8')));
    this.namespace='research-fixtures-v1';this.live=false;
  }
  scenarios() { return this.fixtures.map(({name,chain,token,cutoff})=>({name,chain,token,cutoff})); }
  find(q) { return this.fixtures.find(f=>f.chain===q.chain && f.token===q.token && request({chain:f.chain,token:f.token,cutoff:f.cutoff}).cutoff===q.cutoff); }
  async before(q) {
    const f=this.find(q);
    if(!f) return {summary:null,paths:[],ohlcv:null};
    const fixtureQuery=request({chain:f.chain,token:f.token,cutoff:f.cutoff});
    return structuredClone({summary:f.summary?{payload:f.summary,from:fixtureQuery.from,to:fixtureQuery.cutoff}:null,paths:f.paths,ohlcv:f.ohlcv});
  }
  async after(q) { return structuredClone(this.find(q)?.outcome??{candles:[]}); }
}

// This is a server-side adapter contract, not a general-purpose Nansen proxy.
// Unknown OHLCV field names are not inferred: the result remains unavailable.
export function mapOhlcv(payload,q) {
  const p=envelope(payload);
  // Native beta contract only. Fixtures use their separate canonical adapter.
  if(!q || p?.chain!==q.chain || p?.token_address!==q.token || p?.timeframe!=='1d' || !Array.isArray(p.data) || (p.truncated!==undefined && p.truncated!==false)) return {candles:[],transientFailure:true};
  const candles=p.data.flatMap(r=>{
    const start=instant(r?.interval_start);
    if(start===null || start%DAY!==0) return [];
    const end=start+DAY;
    if(start<Date.parse(q.from) || end>Date.parse(q.cutoff)) return [];
    return [{date:new Date(start).toISOString(),bucket_end:new Date(end).toISOString(),is_complete:true,open:r.open,high:r.high,low:r.low,close:r.close}];
  });
  return {candles};
}
export class NansenAdapter {
  #key;
  constructor({apiKey,approved=false,budget,fetchImpl=fetch}) {
    if(!approved || typeof apiKey!=='string' || !apiKey.trim() || !budget) throw new AppError('LIVE_NOT_CONFIGURED',503);
    this.#key=apiKey;this.budget=budget;this.fetch=fetchImpl;this.namespace='nansen-contract-m41';this.live=true;
  }
  scenarios() { return []; }
  async call(id,body) {
    const entry=COSTS[id];
    if(!entry || entry.deep) throw new AppError('ENDPOINT_NOT_ALLOWED',403);
    try {
      const response=await this.fetch(`https://api.nansen.ai${entry.path}`,{
        method:'POST',headers:{'Content-Type':'application/json','apiKey':this.#key},body:JSON.stringify(body),
        signal:AbortSignal.timeout(15000),redirect:'error'
      });
      const numericHeader=name=>{const value=response.headers?.get(name);return value!==null && value!==undefined && /^\d+$/.test(value)?Number(value):null;};
      const usage={endpoint:id,httpStatus:response.status??null,cost:numericHeader('X-Nansen-Credits-Cost'),used:numericHeader('X-Nansen-Credits-Used'),remaining:numericHeader('X-Nansen-Credits-Remaining')};
      // Numeric billing diagnostics stay private, without headers, bodies or credentials.
      const journal=this.budget.store.read('usage','calls')??[];
      this.budget.store.write('usage','calls',[...journal,usage]);
      if(usage.cost!==null && usage.cost>entry.credits)return null;
      // Never echo provider errors, headers or raw response bodies to the browser.
      if(!response.ok) return null;
      const text=await response.text();
      if(text.length>5_000_000) return null;
      return JSON.parse(text);
    } catch { return null; }
  }
  async before(q) {
    this.budget.reserve(DEFAULT_PLAN);
    const common={chain:q.chain,token_address:q.token};
    // Summary is date-granular. At intraday cutoffs use only completed UTC days.
    const endDay=new Date(Date.parse(q.cutoff)-1).toISOString().slice(0,10);
    const summaryEnd=new Date(`${endDay}T00:00:00.000Z`).getTime()+DAY;
    const safeDay=summaryEnd<=Date.parse(q.cutoff)?endDay:new Date(Date.parse(q.cutoff)-DAY).toISOString().slice(0,10);
    const summaryTo=new Date(Date.parse(`${safeDay}T00:00:00Z`)+DAY).toISOString();
    const fromDay=new Date(Math.ceil(Date.parse(q.from)/DAY)*DAY).toISOString().slice(0,10);
    const stopped={summary:null,paths:[],ohlcv:null,transientFailure:true};
    const summary=await this.call('historical-token-flow-summary',{...common,date_range:{from:fromDay,to:safeDay}});
    if(!Array.isArray(envelope(summary)?.data) || envelope(summary).data.length>1)return stopped;
    const path=await this.call('tgm-flows',{...common,date:{from:q.from,to:new Date(Date.parse(q.cutoff)-1).toISOString()},label:'smart_money',pagination:{page:1,per_page:100},order_by:[{field:'date',direction:'ASC'}]});
    if(!Array.isArray(envelope(path)?.data))return stopped;
    const ohlcv=await this.call('historical-token-ohlcv',{...common,date_from:q.from,as_of_date:q.cutoff,timeframe:'1d'});
    const mapped=mapOhlcv(ohlcv,q);
    return {summary:{payload:summary,from:`${fromDay}T00:00:00.000Z`,to:summaryTo},paths:[{cohort:'smart_money',payload:path}],ohlcv:mapped,transientFailure:!!mapped.transientFailure};
  }
  async after(q) {
    this.budget.reserve(['historical-token-ohlcv']);
    const cutoff=new Date(Date.parse(q.cutoff)+7*DAY).toISOString();
    return mapOhlcv(await this.call('historical-token-ohlcv',{
      chain:q.chain,token_address:q.token,date_from:q.cutoff,as_of_date:cutoff,timeframe:'1d'
    }),{...q,from:q.cutoff,cutoff});
  }
}
