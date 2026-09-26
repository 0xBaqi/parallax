import { digest, finite, VERSION } from './contracts.mjs';
import { COSTS } from './costs.mjs';

export const RULES=Object.freeze({version:VERSION,provisional:true,netToGrossNoise:0.01,dailyToGrossNoise:0.001,persistent:0.75,mixed:0.5,highReversal:0.8,coherentAgreement:0.8});
const rounded=n=>finite(n)?(Math.abs(n)>1e15?n:Math.round(n*1e8)/1e8):null;
const dir=n=>n>0?'ACCUMULATING':n<0?'DISTRIBUTING':'FLAT';
const sign=d=>d==='ACCUMULATING'?1:d==='DISTRIBUTING'?-1:0;
export function pathMetrics(path) {
  let rows=path.rows.filter(r=>r.net!==null);
  let net=rows.reduce((s,r)=>s+r.net,0),gross=rows.reduce((s,r)=>s+r.inflow-r.outflow,0);
  if(!finite(net) || !finite(gross)){rows=[];net=0;gross=0;}
  const direction=rows.length?dir(Math.abs(net)<=gross*RULES.netToGrossNoise?0:net):'UNAVAILABLE';
  // Daily UTC aggregates make persistence comparable across hourly/daily responses.
  const days=new Map();
  for(const r of rows) days.set(r.start.slice(0,10),(days.get(r.start.slice(0,10))??0)+r.net);
  const active=[...days.values()].filter(n=>Math.abs(n)>gross*RULES.dailyToGrossNoise);
  const matching=active.filter(n=>Math.sign(n)===sign(direction)).length;
  const persistence=sign(direction)&&active.length?matching/active.length:null;
  const pos=active.filter(n=>n>0),neg=active.filter(n=>n<0);
  const largestIn=pos.length?Math.max(...pos):0,largestOut=neg.length?Math.min(...neg):0;
  const ratio=largestIn && largestOut ? Math.min(largestIn,-largestOut)/Math.max(largestIn,-largestOut):0;
  const reversals=active.reduce((n,v,i)=>n+(i>0 && Math.sign(v)!==Math.sign(active[i-1])?1:0),0);
  const first=path.rows[0],last=path.rows.at(-1);
  const breadth=path.rows.length>=2 && first.holders!==null && last.holders!==null ? {
    direction:last.holders>first.holders?'EXPANDING':last.holders<first.holders?'CONTRACTING':'STABLE',
    change:last.holders-first.holders,changePct:first.holders?rounded((last.holders-first.holders)/first.holders*100):null,
    observedFrom:first.end,observedTo:last.end
  }:null;
  return {cohort:path.cohort,provenance:path.provenance,coverage:path.complete && rows.length?'complete':'partial',observedFrom:first?.start??null,observedTo:last?.end??null,
    buckets:rows.length,direction,netTokens:rows.length?rounded(net):null,flowImbalance:rows.length?rounded(gross?net/gross:0):null,
    activeDays:active.length,persistence:rounded(persistence),persistenceLabel:persistence===null?'UNAVAILABLE':persistence>=RULES.persistent?'PERSISTENT':persistence>=RULES.mixed?'MIXED':'FRAGILE',
    reversalCount:rows.length?reversals:null,reversalRatio:rows.length?rounded(ratio):null,reversalLabel:rows.length?(ratio>=RULES.highReversal?'HIGH':'LOW'):'UNAVAILABLE',
    breadth};
}
export function conflictMetrics(segments) {
  const available=segments.filter(s=>s.status==='available');
  // Exchange flows describe venue movement, not a bullish/bearish cohort vote.
  const votes=available.filter(s=>s.segment!=='exchange' && s.netUsd!==0).map(s=>Math.sign(s.netUsd));
  const positive=votes.filter(v=>v>0).length,negative=votes.length-positive;
  const agreement=votes.length?Math.max(positive,negative)/votes.length:null;
  return {status:votes.length<2?'INSUFFICIENT':agreement===1?'COHERENT':agreement>=RULES.coherentAgreement?'MIXED':'CONFLICTED',agreement:rounded(agreement),dominantDirection:positive===negative?'FLAT':positive>negative?'ACCUMULATING':'DISTRIBUTING',directionalSegments:votes.length,availableSegments:available.length,totalSegments:segments.length};
}
function priceMetrics(candles,q) {
  if(!candles.length) return {status:'unavailable'};
  const first=candles[0],last=candles.at(-1),high=Math.max(...candles.map(c=>c.high));
  const returns=candles.slice(1).map((c,i)=>Math.log(c.close/candles[i].close));
  const mean=returns.length?returns.reduce((s,n)=>s+n,0)/returns.length:0;
  const complete=first.start===q.from && last.end===q.cutoff && candles.every((c,i)=>!i || c.start===candles[i-1].end);
  return {status:'available',coverage:complete?'complete':'partial',provenance:'PIT',observedFrom:first.start,observedTo:last.end,
    windowReturnPct:rounded((last.close/first.open-1)*100),drawdownFromHighPct:rounded((last.close/high-1)*100),
    volatility:returns.length>=2?rounded(Math.sqrt(returns.reduce((s,n)=>s+(n-mean)**2,0)/returns.length)):null};
}
function character(paths,conflict) {
  if(conflict.status==='CONFLICTED') return 'CONFLICTED';
  const p=paths.find(p=>p.cohort==='smart_money');
  if(!p || p.coverage!=='complete' || p.direction==='UNAVAILABLE') return 'INSUFFICIENT EVIDENCE';
  if(p.direction==='FLAT') return 'NEUTRAL';
  if(['COHERENT','MIXED'].includes(conflict.status) && conflict.dominantDirection!==p.direction) return 'CONFLICTED';
  const contrary=p.direction==='ACCUMULATING'?p.breadth?.direction==='CONTRACTING':p.breadth?.direction==='EXPANDING';
  const fragile=contrary || p.persistenceLabel!=='PERSISTENT' || p.reversalLabel==='HIGH' || !p.breadth || conflict.status!=='COHERENT';
  return `${fragile?'FRAGILE':'COHERENT'} ${p.direction==='ACCUMULATING'?'ACCUMULATION':'DISTRIBUTION'}`;
}
export function evidence(normalized,q) {
  const paths=normalized.paths.map(pathMetrics),conflict=conflictMetrics(normalized.segments),price=priceMetrics(normalized.candles,q);
  const segments=normalized.segments.map(s=>({segment:s.segment,status:s.status,provenance:s.provenance,direction:s.netUsd===null?'UNAVAILABLE':dir(s.netUsd),breadthAvailable:s.walletCount!==null}));
  const evidenceCharacter=character(paths,conflict);
  const availableChannels=Number(conflict.availableSegments>0)+Number(paths.some(p=>p.buckets>0))+Number(price.status==='available');
  const coverage={status:availableChannels===0?'unsupported':availableChannels===3 && paths.every(p=>p.coverage==='complete') && conflict.availableSegments===6 && price.coverage==='complete'?'complete':'partial',availableChannels,totalChannels:3};
  const receipts=[];
  const add=(claim,value,endpoint,fields,methodology,inputs,provenance)=>{
    const body={claim,value,source:'Nansen',endpoint,fields,methodology,inputs,provenance,cutoff:q.cutoff,window:{from:q.from,to:q.cutoff},version:VERSION};
    receipts.push({id:digest(body),...body});
  };
  for(const p of paths) for(const metric of ['direction','breadth','persistence','reversalRatio']) add(`${p.cohort}.${metric}`,p[metric],COSTS['tgm-flows'].path,
    metric==='breadth'?['holders_count','date','bucket_end']:['total_inflows_count','total_outflows_count','date','bucket_end'],
    metric==='direction'?'Signed inflow + negative outflow; flat when |net| <= 1% of gross movement. No holdings denominator is assumed.':metric==='breadth'?'Last minus first observed holder count; not unique traders or current holders.':metric==='persistence'?'Share of active UTC days matching net direction; active threshold 0.1% of window gross movement.':'Ratio of smaller to larger opposing daily net extremes; sign changes exclude inactive days. No wallet-level round trip is claimed.',
    {observedFrom:p.observedFrom,observedTo:p.observedTo,buckets:p.buckets,coverage:p.coverage,netTokens:p.netTokens,flowImbalance:p.flowImbalance,activeDays:p.activeDays,reversalCount:p.reversalCount},'HISTORICAL');
  for(const s of segments) add(`segment.${s.segment}`,s.direction,COSTS['historical-token-flow-summary'].path,[`${s.segment}_net_flow_usd`],
    'Sign of available PIT net USD flow. NULL or invalid is unavailable, never flat.',{status:s.status},'PIT');
  add('conflict',conflict.status,COSTS['historical-token-flow-summary'].path,['*_net_flow_usd'],
    'Agreement among nonzero available participant segments; exchange excluded. Fewer than two directional segments is insufficient.',conflict,'DERIVED');
  add('priceContext',price,COSTS['historical-token-ohlcv'].path,['open','high','low','close','date','bucket_end'],
    'Completed pre-cutoff candles only. Return uses first open to last close; volatility is population standard deviation of log close returns.',{candles:normalized.candles.length},'PIT');
  add('character',evidenceCharacter,'Parallax deterministic engine',[],
    'Conflict takes precedence. Full Smart Money path required; weak persistence, opposing/missing breadth, high reversals or insufficient cohort agreement prevent coherent classification.',
    {path:paths.find(p=>p.cohort==='smart_money')?.direction??'UNAVAILABLE',conflict:conflict.status},'DERIVED');
  const body={schemaVersion:1,engineVersion:VERSION,sealed:true,query:q,rules:RULES,coverage,segments,paths,priceContext:price,conflict,character:evidenceCharacter,receipts};
  return {id:digest(body),...body};
}
