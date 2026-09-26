import { envelope, finite, instant } from './contracts.mjs';
export const SEGMENTS = Object.freeze(['smart_trader','fresh_wallets','whale','exchange','top_pnl','public_figure']);
const number = v => finite(v) ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const positive = v => finite(v) && v > 0 ? v : null;

// Raw envelopes and warnings never cross this allowlist. A summary is indivisible:
// if its query interval crosses the cutoff it cannot be truncated safely.
export function normalizeSummary(source,q) {
  const p=envelope(source?.payload);
  const from=instant(source?.from),to=instant(source?.to);
  const scoped=from!==null && to!==null && from>=Date.parse(q.from) && to<=Date.parse(q.cutoff) && from<to;
  const row=scoped && Array.isArray(p?.data) && p.data.length===1 ? p.data[0] : null;
  return SEGMENTS.map(segment => {
    const net=number(row?.[`${segment}_net_flow_usd`]);
    return {segment,netUsd:net,walletCount:net===null?null:count(row?.[`${segment}_wallet_count`]),status:net===null?'unavailable':'available',provenance:'PIT'};
  });
}

function boundedRows(rows,q) {
  if (!Array.isArray(rows)) return [];
  const from=Date.parse(q.from),to=Date.parse(q.cutoff);
  return rows.filter(r=> {
    const start=instant(r?.date),end=instant(r?.bucket_end);
    return start!==null && end!==null && start>=from && start<end && end<=to && r.is_complete===true;
  }).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
}
function withoutOverlaps(rows) {
  // Quarantine every conflicting bucket, independent of input ordering.
  return rows.filter((r,i)=>!rows.some((s,j)=>i!==j && Date.parse(r.date)<Date.parse(s.bucket_end) && Date.parse(s.date)<Date.parse(r.bucket_end)));
}
export function normalizePath(source,q) {
  const cohort=source?.cohort;
  if (!['smart_money','exchange'].includes(cohort)) return null;
  const p=envelope(source.payload);
  const rows=withoutOverlaps(boundedRows(p?.data,q)).map(r=> {
    const inflow=number(r.total_inflows_count),outflow=number(r.total_outflows_count);
    const net=inflow!==null && outflow!==null && inflow>=0 && outflow<=0 ? inflow+outflow : null;
    return {start:new Date(r.date).toISOString(),end:new Date(r.bucket_end).toISOString(),net:finite(net)?net:null,
      inflow:net===null?null:inflow,outflow:net===null?null:outflow,holders:count(r.holders_count),price:positive(r.price_usd)};
  });
  const contiguous=rows.length>0 && rows.every((r,i)=>!i || r.start===rows[i-1].end);
  const complete=p?.pagination?.is_last_page===true && contiguous && rows[0]?.start===q.from && rows.at(-1)?.end===q.cutoff && rows.every(r=>r.net!==null);
  return {cohort,rows,complete,provenance:'HISTORICAL'};
}

// Canonical candle contract at the adapter boundary. Unknown provider shapes fail closed.
// Historical OHLCV response shape is deliberately not guessed from TGM prices.
export function normalizeCandles(source,q) {
  return withoutOverlaps(boundedRows(source?.candles,q)).filter(r=>positive(r.open)!==null && positive(r.high)!==null && positive(r.low)!==null && positive(r.close)!==null && r.low<=Math.min(r.open,r.close) && r.high>=Math.max(r.open,r.close)).map(r=>({start:new Date(r.date).toISOString(),end:new Date(r.bucket_end).toISOString(),open:r.open,high:r.high,low:r.low,close:r.close}));
}
export function normalizeBefore(raw,q) {
  const paths=(Array.isArray(raw?.paths)?raw.paths:[]).map(p=>normalizePath(p,q)).filter(Boolean);
  // Duplicate cohorts are ambiguous, not additive.
  const unique=paths.filter(p=>paths.filter(x=>x.cohort===p.cohort).length===1).sort((a,b)=>a.cohort.localeCompare(b.cohort));
  return {segments:normalizeSummary(raw?.summary,q),paths:unique,candles:normalizeCandles(raw?.ohlcv,q)};
}
