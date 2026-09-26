import { fileURLToPath } from 'node:url';
import { join,resolve } from 'node:path';
import { Store } from './store.mjs';
import { Budget } from './costs.mjs';
import { FixtureAdapter,NansenAdapter } from './adapter.mjs';
import { Service } from './service.mjs';
import { createApp } from './http.mjs';
import { CuratedAdapter,Experience } from './experience.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const store=new Store(resolve(process.env.PARALLAX_DATA_DIR??'.data'));
const unlock=store.lock();
try {
  const mode=process.env.PARALLAX_MODE??'fixture';
  if(!['fixture','live'].includes(mode)) throw new Error('INVALID_MODE');
  const curated=new CuratedAdapter(join(root,'fixtures'));
  const adapter=mode==='live'?new NansenAdapter({apiKey:process.env.NANSEN_API_KEY,approved:process.env.PARALLAX_LIVE_APPROVED==='true',budget:new Budget(store,{limit:Number(process.env.PARALLAX_CREDIT_BUDGET??0),maxRequest:Number(process.env.PARALLAX_MAX_REQUEST_CREDITS??11)})}):curated;
  const service=new Service({adapter,store}),timeMachine=new Service({adapter:curated,store});
  const experience=new Experience({service,timeMachine});
  const app=createApp({service,experience,publicDir:join(root,'public'),adminToken:process.env.PARALLAX_ADMIN_TOKEN,publicOrigin:process.env.PARALLAX_PUBLIC_ORIGIN??null});
  app.listen(Number(process.env.PORT??3000),process.env.PARALLAX_PUBLIC_ORIGIN?'0.0.0.0':'127.0.0.1',()=>console.log(`Parallax M2 (${mode}) http://127.0.0.1:${app.address().port}`));
  let stopped=false;
  const stop=()=>{if(stopped)return;stopped=true;app.close(()=>{unlock();process.exit(0);});app.closeIdleConnections();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  app.on('error',()=>{unlock();console.error('SERVER_START_FAILED');process.exitCode=1;});
} catch(e) {unlock();console.error(e.code??'STARTUP_CONFIGURATION_ERROR');process.exitCode=1;}
