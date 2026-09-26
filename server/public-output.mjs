// The only HTTP serialization boundary. Raw observations remain in private storage.
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
const direction=n=>typeof n!=='number'||!Number.isFinite(n)?'UNAVAILABLE':n>0?'ACCUMULATING':n<0?'DISTRIBUTING':'FLAT';
const pct=n=>typeof n==='number'&&Number.isFinite(n)?Math.round(n*100)/100:null;
const attribution='Powered by Nansen';
const breadth=b=>b?pick(b,['direction','observedFrom','observedTo']):null;
function path(p){return {...pick(p,['cohort','provenance','coverage','observedFrom','observedTo','buckets','direction','activeDays','persistence','persistenceLabel','reversalCount','reversalRatio','reversalLabel']),breadth:breadth(p.breadth)};}
function sealed(s){
  const result=pick(s,['id','schemaVersion','engineVersion','sealed','query','rules','coverage','segments','priceContext','conflict','character']);
  result.paths=s.paths.map(path);
  result.receipts=s.receipts.map(r=>({...pick(r,['id','claim','cutoff','window','version','provenance']),source:attribution,evidenceSource:r.claim.startsWith('segment.')||r.claim==='conflict'?'Nansen historical flow summary':r.claim==='priceContext'?'Nansen historical price history':r.claim==='character'?'Parallax deterministic methodology':'Nansen historical Smart Money movement',
    value:r.claim.endsWith('.breadth')?breadth(r.value):r.value,
    inputs:pick(r.inputs,['observedFrom','observedTo','buckets','coverage','activeDays','reversalCount','status','agreement','dominantDirection','directionalSegments','availableSegments','totalSegments','candles','path','conflict']),
    methodology:r.methodology+(r.claim.startsWith('segment.')?' Cohort windows differ: fresh wallets are a recent snapshot of 24-hour inflow; other cohorts follow the documented historical summary window.':r.provenance==='HISTORICAL'?' Historical movement does not establish that Smart Money membership was known at cutoff.':'')
  }));
  return {...result,attribution};
}
function details(d){return {
  segments:d.segments.map(s=>({...pick(s,['segment','status','provenance']),direction:direction(s.netUsd)})),
  timeline:d.timeline.map(r=>({...pick(r,['cohort','start','end']),direction:direction(r.inflow===null||r.outflow===null?null:r.inflow+r.outflow)})),
  context:d.context?{...pick(d.context,['summaryFrom','coverageStart']),baselineAvailable:!!d.context.baseline,source:attribution}:null
};}
export function publicResponse(data){
  if(data?.sealed && data?.details)return {session:data.session,sealed:sealed(data.sealed),details:details(data.details),attribution};
  if(data?.sealed===true)return sealed(data);
  if(Array.isArray(data?.horizons)){
    const base=data.trajectory?.[0]?.close;
    return {...pick(data,['status','decision','methodology','message','cutoff']),source:attribution,
      horizons:data.horizons.map(h=>({days:h.days,percent:pct(h.percent)})),
      trajectory:base>0?data.trajectory.map(p=>({at:p.at,percent:pct((p.close/base-1)*100)})):[]};
  }
  // Legacy diagnostic reveal has derived metrics only; use an explicit allowlist.
  if(data && 'return24hPct' in data)return {...pick(data,['status','return24hPct','return3dPct','return7dPct','methodology','cutoff','investigationId','revealed','provenance','horizon','maxGain7dPct','maxCloseDrawdown7dPct','relationship','reason']),attribution};
  // Control-plane responses have no provider-controlled fields.
  return pick(data,['error','mode','scenarios','quote','credits','cached','source','expiresInSeconds','decision','locked','approvalRequired']);
}
