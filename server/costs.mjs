import { AppError } from './contracts.mjs';
export const COSTS = Object.freeze({
  'historical-token-flow-summary': Object.freeze({credits:5,path:'/api/v1beta1/tgm/historical-token-flow-summary',basis:'research CLI + observed 5',deep:false}),
  'historical-token-ohlcv': Object.freeze({credits:5,path:'/api/v1beta1/tgm/historical-token-ohlcv',basis:'research CLI stated 5',deep:false}),
  'tgm-flows': Object.freeze({credits:1,path:'/api/v1/tgm/flows',basis:'observed approximately 1; verify before deployment',deep:false}),
  'historical-smart-money-balances': Object.freeze({credits:25,path:'/api/v1beta1/smart-money/historical-token-balances',basis:'research CLI stated 25',deep:true}),
  'historical-top-holders': Object.freeze({credits:25,path:'/api/v1beta1/tgm/historical-top-holders',basis:'research CLI stated 25',deep:true})
});
export const DEFAULT_PLAN = Object.freeze(['historical-token-flow-summary','tgm-flows','historical-token-ohlcv']);
export function estimate(plan, allowDeep = false) {
  if (!Array.isArray(plan) || !plan.length) throw new AppError('INVALID_PLAN');
  return plan.reduce((sum,id) => {
    if (!Object.hasOwn(COSTS,id)) throw new AppError('UNREGISTERED_ENDPOINT');
    if (COSTS[id].deep && !allowDeep) throw new AppError('DEEP_EVIDENCE_DISABLED',403);
    return sum+COSTS[id].credits;
  },0);
}
export class Budget {
  constructor(store,{limit=0,maxRequest=11}={}) {
    if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(maxRequest) || maxRequest < 0) throw new AppError('INVALID_BUDGET');
    this.store=store;this.limit=limit;this.maxRequest=maxRequest;
  }
  reserve(plan) {
    const credits=estimate(plan);
    const ledger=this.store.read('budget','ledger');
    const spent=ledger===null?0:ledger.reserved;
    if(!Number.isSafeInteger(spent) || spent<0) throw new AppError('INVALID_CREDIT_LEDGER',503);
    if (credits>this.maxRequest || spent+credits>this.limit) throw new AppError('CREDIT_BUDGET_EXCEEDED',429);
    // Synchronous durable reservation precedes any request. Failed/uncertain calls are not refunded.
    this.store.write('budget','ledger',{reserved:spent+credits});
    return credits;
  }
}
