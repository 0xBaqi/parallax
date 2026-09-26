import { createHash } from 'node:crypto';
export const VERSION = 'm1.1';
export const DAY = 86400000;
export class AppError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,19) !== value.slice(0,19)) return null;
  return n;
}
export function request(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['chain','token','cutoff','windowDays'].includes(k))) throw new AppError('INVALID_REQUEST');
  const { chain } = input;
  if (!['ethereum','solana'].includes(chain)) throw new AppError('UNSUPPORTED_CHAIN',422);
  if (typeof input.token !== 'string') throw new AppError('INVALID_TOKEN');
  const token = chain === 'ethereum' ? input.token.toLowerCase() : input.token;
  if (!(chain === 'ethereum' ? /^0x[0-9a-f]{40}$/ : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/).test(token)) throw new AppError('INVALID_TOKEN');
  const dateOnly = typeof input.cutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.cutoff);
  const t = instant(dateOnly ? `${input.cutoff}T00:00:00Z` : input.cutoff);
  const boundary = t === null ? null : t + (dateOnly ? DAY : 0);
  if (boundary === null || boundary > now || boundary < Date.UTC(2009,0,1)) throw new AppError('INVALID_CUTOFF');
  const windowDays = input.windowDays ?? 12;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) throw new AppError('INVALID_WINDOW');
  return Object.freeze({chain,token,cutoff:new Date(boundary).toISOString(),windowDays,from:new Date((dateOnly?t:boundary)-windowDays*DAY).toISOString(),version:VERSION});
}
export const cacheKey = (q, namespace = 'fixture-v1') => digest({namespace,...q});
export function envelope(payload) {
  if (payload?.success === false) return null;
  if (payload?.success === true) return payload.data;
  return payload;
}
