import { DAY, finite } from './contracts.mjs';
import { normalizeCandles } from './normalize.mjs';
const pct=(a,b)=>{const n=(a/b-1)*100;return finite(n)?(Math.abs(n)>1e15?n:Math.round(n*1e8)/1e8):null;};
export function reveal(raw,q,base,sealed) {
  const horizon=new Date(Date.parse(q.cutoff)+7*DAY).toISOString();
  const candles=normalizeCandles(raw,{...q,from:q.cutoff,cutoff:horizon});
  const baseline=base?.end===q.cutoff?base.close:null;
  const at=days=>candles.find(c=>Date.parse(c.end)===Date.parse(q.cutoff)+days*DAY)?.close??null;
  const returns={return24hPct:baseline&&at(1)?pct(at(1),baseline):null,return3dPct:baseline&&at(3)?pct(at(3),baseline):null,return7dPct:baseline&&at(7)?pct(at(7),baseline):null};
  const full=candles.length>0 && candles[0].start===q.cutoff && candles.at(-1).end===horizon && candles.every((c,i)=>i===0 || c.start===candles[i-1].end);
  let maxGain=null,maxDrawdown=null;
  if(baseline && full) {
    maxGain=pct(Math.max(...candles.map(c=>c.high)),baseline);
    // Close-to-close peak-to-trough drawdown avoids inventing intrabar ordering.
    let peak=baseline,drawdown=0;
    for(const c of candles) {peak=Math.max(peak,c.close);drawdown=Math.min(drawdown,pct(c.close,peak));}
    maxDrawdown=drawdown;
  }
  const usable=Object.values(returns).some(x=>x!==null);
  const p=sealed.paths.find(p=>p.cohort==='smart_money');
  let relationship='EVIDENCE WAS INCONCLUSIVE';
  if(returns.return7dPct!==null && p?.coverage==='complete' && ['COHERENT ACCUMULATION','COHERENT DISTRIBUTION','FRAGILE ACCUMULATION','FRAGILE DISTRIBUTION'].includes(sealed.character) && returns.return7dPct!==0) {
    relationship=(p.direction==='ACCUMULATING'?1:-1)===Math.sign(returns.return7dPct)?'EVIDENCE ALIGNED WITH OUTCOME':'OUTCOME DIVERGED FROM PRE-CUTOFF EVIDENCE';
  }
  return {investigationId:sealed.id,revealed:true,provenance:'OUTCOME',cutoff:q.cutoff,horizon,
    status:usable?(full?'complete':'partial'):'unavailable',...returns,maxGain7dPct:maxGain,maxCloseDrawdown7dPct:maxDrawdown,
    relationship:usable?relationship:'UNAVAILABLE',methodology:'Exact completed horizon closes; baseline must end at cutoff. No nearest-price interpolation. Drawdown uses successive closes.',
    reason:usable?null:baseline===null?'NO_VALIDATED_CUTOFF_PRICE':'NO_VALIDATED_OUTCOME_CANDLES'};
}
