import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Private expected values preserve the original assertions without publishing research data.
const privateExpected=JSON.parse(readFileSync(join(root,'curated/m5-test-expectations.json'),'utf8'));

const directory=mkdtempSync(join(tmpdir(),'parallax-packaged-'));
const child=spawn(process.execPath,['dist/server/main.mjs'],{cwd:root,env:{...process.env,PARALLAX_MODE:'fixture',PARALLAX_DATA_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
const checks=[];
try {
 const url=await new Promise((res,rej)=>{let out='';const timer=setTimeout(()=>rej(new Error('STARTUP_TIMEOUT')),15000);child.stdout.on('data',d=>{out+=d;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);res(match[0]);}});child.once('exit',c=>{clearTimeout(timer);rej(new Error(`EARLY_EXIT_${c}`));});});
 const post=async(path,body)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const path of ['/','/app.js','/style.css']){const r=await fetch(url+path);assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy'));}checks.push('packaged assets and security headers');
 const catalog=await (await fetch(url+'/api/catalog')).json(),{name,...input}=catalog.scenarios[0];
 const quote=await (await post('/api/quote',{mode:'time-machine',input})).json();assert.equal(quote.credits,0);
 const before=await (await post('/api/start',{quote:quote.quote})).json();assert.equal(before.sealed.character,'CONFLICTED');assert.equal(before.details.timeline.at(-1).direction,'DISTRIBUTING');assert.ok(!JSON.stringify(before).includes('"holders":'));checks.push('real PEPE reconstruction');
 for(const marker of ['2024-02-25','2024-02-27','2024-03-02',String(privateExpected.day7),'return7d'])assert.ok(!JSON.stringify(before).includes(marker));checks.push('pre-reveal isolation');
 assert.equal((await post('/api/break',{session:before.session})).status,409);
 assert.equal((await post('/api/decision',{session:before.session,decision:'PASS'})).status,200);
 assert.equal((await post('/api/decision',{session:before.session,decision:'TRUST'})).status,409);checks.push('decision gate and durable lock');
 const after=await (await post('/api/break',{session:before.session})).json();assert.deepEqual(after.horizons.map(h=>h.percent.toFixed(2)),['5.26','101.77','234.93']);assert.equal(after.trajectory.length,8);checks.push('validated reveal and complete daily trajectory');
 assert.deepEqual(await (await post('/api/break',{session:before.session})).json(),after);checks.push('cached repeat reveal');
 assert.equal((await post('/api/reveal',{id:before.sealed.id})).status,409);
 assert.equal((await fetch(url+'/curated/outcome-0.json')).status,404);checks.push('legacy bypass and private fixture blocked');
 const unknown={chain:'ethereum',token:'0x'+'b'.repeat(40),cutoff:'2024-02-24T23:59:59Z',windowDays:13};
 const q2=await (await post('/api/quote',{mode:'investigate',input:unknown})).json();
 const b2=await (await post('/api/start',{quote:q2.quote})).json();assert.equal(b2.sealed.coverage.status,'unsupported');
 await post('/api/decision',{session:b2.session,decision:'PASS'});assert.equal((await (await post('/api/break',{session:b2.session})).json()).status,'unavailable');checks.push('generic Investigate and unavailable reveal');
 const result={passed:true,checks,creditsConsumed:0,mode:'fixture',runtime:process.version};
 writeFileSync(join(root,'M4.1-SMOKE-RESULTS.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
 child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
 assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.includes('parallax-packaged-'));rmSync(directory,{recursive:true,force:true});
}

