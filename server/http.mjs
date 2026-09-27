import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from './contracts.mjs';
import { publicResponse } from './public-output.mjs';
function authorized(value,token) {
  const a=Buffer.from(value??''),b=Buffer.from(`Bearer ${token}`);
  return a.length===b.length && timingSafeEqual(a,b);
}
async function body(req) {
  let text='';
  for await(const chunk of req) {text+=chunk;if(Buffer.byteLength(text)>4096) throw new AppError('REQUEST_TOO_LARGE',413);}
  try{return JSON.parse(text);}catch{throw new AppError('INVALID_JSON');}
}
export function createApp({service,publicDir,adminToken=null,experience=null,publicOrigin=null,publicDemo=false}) {
  if(service.adapter.live && (!adminToken || adminToken.length<24)) throw new AppError('ADMIN_TOKEN_REQUIRED',503);
  let origin=null;
  if(publicOrigin!==null){
    try{const u=new URL(publicOrigin);if(u.protocol!=='https:' || u.origin!==publicOrigin || u.username || u.password)throw new Error();origin=u.origin;}catch{throw new AppError('INVALID_PUBLIC_ORIGIN',503);}
  }
  const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
  const app=createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(publicResponse(data)));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      // Local diagnostic server only. Host checking also blocks DNS rebinding.
      if(origin?req.headers.host!==new URL(origin).host:!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host??'')) throw new AppError('INVALID_HOST',403);
      if(req.headers.origin && req.headers.origin!==(origin??`http://${req.headers.host}`)) throw new AppError('CROSS_ORIGIN_DENIED',403);
      const url=new URL(req.url,'http://localhost');
      if(url.search) throw new AppError('QUERY_NOT_SUPPORTED');
      if(req.method==='GET' && assets.has(url.pathname)) {
        const [file,type]=assets.get(url.pathname);res.writeHead(200,{'Content-Type':type});res.end(readFileSync(join(publicDir,file)));return;
      }
      if(req.method==='GET' && url.pathname==='/api/scenarios') return send(200,{mode:service.adapter.live?'live':'fixture',scenarios:service.adapter.scenarios()});
      if(experience && req.method==='GET' && url.pathname==='/api/catalog') return send(200,{mode:service.adapter.live?'live':'fixture',scenarios:experience.timeMachine.adapter.scenarios()});
      if(experience && req.method==='POST' && ['/api/quote','/api/start','/api/decision','/api/break'].includes(url.pathname)) {
        // Durable aggregate limit: cannot be evaded with spoofed proxy headers,
        // new sessions, or a process restart. Paid work has a stricter limit below.
        if(publicDemo===true) {
          const now=service.now(),recent=(service.store.read('rate','public-workflow')?.times??[]).filter(t=>t>now-60000);
          if(recent.length>=120)throw new AppError('PUBLIC_RATE_LIMIT',429);
          service.store.write('rate','public-workflow',{times:[...recent,now]});
        }
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')) throw new AppError('JSON_REQUIRED',415);
        const input=await body(req);
        if(!input || typeof input!=='object' || Array.isArray(input))throw new AppError('INVALID_REQUEST');
        const keys={'/api/quote':['mode','input'],'/api/start':['quote','approvedCredits'],'/api/decision':['session','decision'],'/api/break':['session','approvedCredits']}[url.pathname];
        if(Object.keys(input).some(k=>!keys.includes(k)))throw new AppError('INVALID_REQUEST');
        const mode=url.pathname==='/api/quote'?input.mode:url.pathname==='/api/start'?experience.quotes.get(input.quote)?.mode:experience.get(input.session).mode;
        if(service.adapter.live && mode!=='time-machine' && publicDemo!==true && !authorized(req.headers.authorization,adminToken))throw new AppError('UNAUTHORIZED',401);
        const result=url.pathname==='/api/quote'?experience.quote(input):url.pathname==='/api/start'?await experience.start(input,req.socket.remoteAddress):url.pathname==='/api/decision'?experience.decide(input):await experience.reveal(input);
        return send(200,result);
      }
      if(req.method==='POST' && ['/api/investigate','/api/reveal'].includes(url.pathname)) {
        // Production M2 cannot bypass per-execution cost consent or decision gate.
        if(experience)throw new AppError('USE_SESSION_WORKFLOW',409);
        if(service.adapter.live && !authorized(req.headers.authorization,adminToken)) throw new AppError('UNAUTHORIZED',401);
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')) throw new AppError('JSON_REQUIRED',415);
        const input=await body(req);
        return send(200,url.pathname==='/api/investigate'?await service.investigate(input,req.socket.remoteAddress):await service.reveal(input));
      }
      throw new AppError('NOT_FOUND',404);
    } catch(e) {send(e instanceof AppError?e.status:500,{error:e instanceof AppError?e.code:'INTERNAL_ERROR'});}
  });
  app.requestTimeout=20000;app.headersTimeout=10000;return app;
}
