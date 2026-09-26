import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureAdapter } from './adapter.mjs';
import { request, cacheKey, AppError, DAY, finite, instant } from './contracts.mjs';
import { estimate, DEFAULT_PLAN } from './costs.mjs';

// Curated coordinates and THEN-only context. Outcomes load only at reveal.
export class CuratedAdapter extends FixtureAdapter {
  constructor(directory) {
    super(directory); this.directory=directory; this.namespace='curated-m2-v2';
    this.catalog=JSON.parse(readFileSync(join(directory,'../curated/scenarios.json'),'utf8'));
    for(const item of this.catalog) {
      const f=this.fixtures.find(f=>f.token===item.token && f.chain===item.chain);
      if(!f) throw new Error('MISSING_CURATED_FIXTURE');
      f.cutoff=item.cutoff;
      // Original daily end is exclusive midnight; scenario EOD is inclusive
      // at whole-second precision, as explicitly validated by the user.
      for(const p of f.paths??[]) for(const r of p.payload.data??[])
        if(Date.parse(r.bucket_end)===Date.parse(item.cutoff)+1000) r.bucket_end=item.cutoff;
    }
  }
  scenarios() {return this.catalog.map(({name,chain,token,cutoff,windowDays})=>({name,chain,token,cutoff,windowDays}));}
  async before(q) {
    const raw=await super.before(q),item=this.catalog.find(s=>s.chain===q.chain && s.token===q.token && s.cutoff===q.cutoff);
    if(item && raw.summary) raw.summary={...raw.summary,from:item.summaryFrom,to:item.cutoff};
    if(item) {
      const index=this.catalog.indexOf(item);
      const prices=JSON.parse(readFileSync(join(this.directory,`../curated/before-${index}.json`),'utf8'));
      raw.ohlcv={candles:prices.timeframe==='1d'?prices.data.map(r=>{
        const end=Date.parse(r.interval_start)+DAY;
        return {date:r.interval_start,bucket_end:new Date(end-1000===Date.parse(q.cutoff)?end-1000:end).toISOString(),
          is_complete:true,open:r.open,high:r.high,low:r.low,close:r.close};
      }):[]};
    }
    return raw;
  }
  context(q) {
    const item=this.catalog.find(s=>s.chain===q.chain && s.token===q.token && s.cutoff===q.cutoff);
    return item?structuredClone({baseline:{at:item.baseline.at,close:item.baseline.close},summaryFrom:item.summaryFrom,coverageStart:item.coverageStart,source:item.source}):null;
  }
  async closeOutcome(q) {
    const index=this.catalog.findIndex(s=>s.chain===q.chain && s.token===q.token && s.cutoff===q.cutoff);
    return index<0?[]:JSON.parse(readFileSync(join(this.directory,`../curated/outcome-${index}.json`),'utf8')).closes;
  }
}

export function closeReveal(closes,q,baseline) {
  const valid=Array.isArray(closes)?closes.filter(c=>instant(c.at)!==null && Date.parse(c.at)>Date.parse(q.cutoff) && Date.parse(c.at)<=Date.parse(q.cutoff)+7*DAY && finite(c.close) && c.close>0):[];
  const unique=valid.filter(c=>valid.filter(x=>x.at===c.at).length===1).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const base=baseline?.at===q.cutoff && finite(baseline.close) && baseline.close>0?baseline:null;
  const horizons=[1,3,7].map(days=>{
    const c=unique.find(c=>Date.parse(c.at)===Date.parse(q.cutoff)+days*DAY),result=base&&c?(c.close/base.close-1)*100:null;
    return {days,close:c?.close??null,percent:finite(result)?result:null};
  });
  const complete=base && [1,2,3,4,5,6,7].every(days=>unique.some(c=>Date.parse(c.at)===Date.parse(q.cutoff)+days*DAY));
  return {status:horizons.some(h=>h.percent!==null)?(complete?'complete':'partial'):'unavailable',horizons,
    trajectory:base?[{at:base.at,close:base.close},...unique.map(({at,close})=>({at,close}))]:[],
    methodology:complete?'Exact validated daily closes relative to the cutoff close. All seven daily closes are present. Connecting lines do not describe intraday prices.':'Exact validated daily closes relative to the cutoff close. Sparse observations only; connecting lines are not measured intermediate prices. Missing days remain unavailable.',
    message:horizons.some(h=>h.percent!==null)?'The evidence available then was conflicted and deteriorating. Later price performance does not mean Parallax predicted it.':'No validated outcome closes are available. Your evidence and decision remain intact.',
    source:'Nansen historical OHLCV · validated response',cutoff:q.cutoff};
}

export class Experience {
  constructor({service,timeMachine}) {if(timeMachine.adapter.live)throw new AppError('TIME_MACHINE_MUST_BE_OFFLINE');this.service=service;this.timeMachine=timeMachine;this.store=service.store;this.quotes=new Map();}
  serviceFor(mode) {if(!['time-machine','investigate'].includes(mode))throw new AppError('INVALID_MODE');return mode==='time-machine'?this.timeMachine:this.service;}
  quote({mode,input}) {
    const service=this.serviceFor(mode),q=request(input),key=cacheKey(q,service.adapter.namespace);
    if(mode==='time-machine' && !service.adapter.scenarios().some(s=>s.chain===q.chain && s.token===q.token && s.cutoff===q.cutoff && s.windowDays===q.windowDays))throw new AppError('UNKNOWN_SCENARIO');
    const cached=service.store.read('cache',key),hit=!!cached && cached.expires>service.now();
    const credits=service.adapter.live&&!hit?estimate(DEFAULT_PLAN):0,id=randomUUID();
    if(this.quotes.size>1000) for(const [k,v] of this.quotes) if(v.expires<Date.now())this.quotes.delete(k);
    if(this.quotes.size>1000)throw new AppError('TOO_MANY_QUOTES',429);
    this.quotes.set(id,{mode,input,credits,expires:Date.now()+120000});
    return {quote:id,credits,cached:hit,source:service.adapter.live?'Nansen live':'local fixture',expiresInSeconds:120};
  }
  async start({quote,approvedCredits},client) {
    const offer=this.quotes.get(quote);
    if(!offer || offer.expires<Date.now())throw new AppError('QUOTE_EXPIRED',409);
    if(offer.credits>0 && approvedCredits!==offer.credits)throw new AppError('CREDIT_APPROVAL_REQUIRED',409);
    this.quotes.delete(quote);
    const service=this.serviceFor(offer.mode),q=request(offer.input),cached=service.store.read('cache',cacheKey(q,service.adapter.namespace));
    if(service.adapter.live && offer.credits===0 && (!cached || cached.expires<=service.now()))throw new AppError('QUOTE_EXPIRED',409);
    const sealed=await service.investigate(offer.input,client),record=service.store.read('investigations',sealed.id),n=record.normalized;
    const context=service.adapter.context?.(q)??null;
    const details={segments:n?.segments??[],timeline:(n?.paths??[]).flatMap(p=>p.rows.map(({start,end,inflow,outflow,holders})=>({cohort:p.cohort,start,end,inflow,outflow,holders}))).sort((a,b)=>a.start.localeCompare(b.start)),context};
    const session=randomUUID();this.store.write('sessions',session,{mode:offer.mode,id:sealed.id,decision:null,q,context});
    return {session,sealed,details};
  }
  get(session) {
    if(typeof session!=='string' || !/^[0-9a-f-]{36}$/.test(session))throw new AppError('INVALID_SESSION');
    const record=this.store.read('sessions',session);if(!record)throw new AppError('SESSION_NOT_FOUND',404);return record;
  }
  decide({session,decision}) {
    if(!['TRUST','PASS'].includes(decision))throw new AppError('INVALID_DECISION');
    const s=this.get(session);if(s.decision && s.decision!==decision)throw new AppError('DECISION_LOCKED',409);
    this.store.write('sessions',session,{...s,decision});return {decision,locked:true};
  }
  async reveal({session,approvedCredits}) {
    const s=this.get(session);if(!s.decision)throw new AppError('DECISION_REQUIRED',409);
    const service=this.serviceFor(s.mode);
    if(service.adapter.closeOutcome && s.context?.baseline) {
      let result=this.store.read('session-reveals',session);
      if(!result) {result=closeReveal(await service.adapter.closeOutcome(s.q),s.q,s.context.baseline);this.store.write('session-reveals',session,result);}
      return {...result,decision:s.decision};
    }
    const record=service.store.read('investigations',s.id),cached=service.store.read('reveals',s.id);
    const credits=service.adapter.live && !cached && record?.base?.end===s.q.cutoff?5:0;
    if(credits && approvedCredits!==credits)return {approvalRequired:true,credits};
    const result=await service.reveal({id:s.id});
    return {status:result.status,decision:s.decision,horizons:[1,3,7].map((days,i)=>({days,percent:result[['return24hPct','return3dPct','return7dPct'][i]],close:null})),trajectory:[],methodology:result.methodology,message:result.status==='unavailable'?'No validated cutoff price or outcome candles are available. Your evidence and decision remain intact.':'Later performance does not establish predictive ability.',source:'Nansen',cutoff:s.q.cutoff};
  }
}


