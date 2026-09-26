import { request, cacheKey, AppError, DAY } from './contracts.mjs';
import { normalizeBefore } from './normalize.mjs';
import { evidence } from './engine.mjs';
import { reveal } from './reveal.mjs';

export class Service {
  constructor({adapter,store,now=Date.now,ttlMs=86400000}) {this.adapter=adapter;this.store=store;this.now=now;this.ttlMs=ttlMs;this.pending=new Map();this.reveals=new Map();this.rates=new Map();}
  rate(client) {
    // A single operator budget: durable global quota, independent of proxy headers.
    const now=this.now(),recent=(this.store.read('rate','operator')?.times??[]).filter(t=>t>now-600000);
    if(recent.length>=3) throw new AppError('UNCACHED_RATE_LIMIT',429);
    recent.push(now);this.store.write('rate','operator',{times:recent});
    if(this.rates.size>10000) for(const [k,v] of this.rates) if(v.at(-1)<=now-600000) this.rates.delete(k);
  }
  async investigate(input,client='local') {
    const q=request(input,this.now()),key=cacheKey(q,this.adapter.namespace);
    const cached=this.store.read('cache',key);
    if(cached && cached.expires>this.now()) return cached.sealed;
    if(this.pending.has(key)) return this.pending.get(key);
    if(this.adapter.live) this.rate(client);
    const operation=(async()=> {
      const raw=await this.adapter.before(q);
      const normalized=normalizeBefore(raw,q);
      const sealed=evidence(normalized,q);
      const record={q,sealed,normalized,base:normalized.candles.at(-1)??null,namespace:this.adapter.namespace};
      this.store.write('investigations',sealed.id,record);
      // Transport failures must not masquerade as day-long missing coverage.
      if(!raw?.transientFailure)this.store.write('cache',key,{sealed,expires:this.now()+this.ttlMs});
      return sealed;
    })();
    this.pending.set(key,operation);
    try{return await operation;}finally{this.pending.delete(key);}
  }
  async reveal(input) {
    if(!input || Object.keys(input).length!==1 || typeof input.id!=='string' || !/^[a-f0-9]{64}$/.test(input.id)) throw new AppError('INVALID_REVEAL');
    const record=this.store.read('investigations',input.id);
    if(!record || record.namespace!==this.adapter.namespace) throw new AppError('INVESTIGATION_NOT_FOUND',404);
    const cached=this.store.read('reveals',input.id);
    if(cached) return cached;
    if(this.reveals.has(input.id)) return this.reveals.get(input.id);
    const operation=(async()=>{
      if(this.adapter.live && Date.parse(record.q.cutoff)+7*DAY>this.now()) throw new AppError('OUTCOME_WINDOW_NOT_COMPLETE',409);
      const raw=record.base?.end===record.q.cutoff?await this.adapter.after(record.q):{candles:[]};
      if(raw?.transientFailure)throw new AppError('OUTCOME_SOURCE_UNAVAILABLE',502);
      const result=reveal(raw,record.q,record.base,record.sealed);
      if(!raw?.transientFailure)this.store.write('reveals',input.id,result);return result;
    })();
    this.reveals.set(input.id,operation);
    try{return await operation;}finally{this.reveals.delete(input.id);}
  }
}

