import test from 'node:test';
import {publicResponse} from '../server/public-output.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CuratedAdapter,Experience} from '../server/experience.mjs';
import {Service} from '../server/service.mjs';
import {Store} from '../server/store.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
// A minimal client harness: real M2 services, controlled motion clock, no network.
function harness(t,{reduced=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'parallax-m3-'));
 t.after(()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(dir.includes('parallax-m3-'));rmSync(dir,{recursive:true,force:true});});
 const adapter=new CuratedAdapter(join(root,'fixtures')),store=new Store(dir);
 const service=new Service({adapter,store}),experience=new Experience({service,timeMachine:service});
 const document={activeElement:null};
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this._text='';this.hidden=false;this.disabled=false;this.value='';this.dataset={};this.attributes={};const classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),toggle:(x,on)=>on?classes.add(x):classes.delete(x),contains:x=>classes.has(x)};}
  set textContent(s){this._text=String(s);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=nodes;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;nodes.get('close-receipt').focus();}
  close(){this.open=false;this.onclose?.();}
 }
 const nodes=new Map();
 for(const match of readFileSync(join(root,'public/index.html'),'utf8').matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){const n=new Element();n.hidden=/\bhidden\b/.test(match[0]);n.disabled=/\bdisabled\b/.test(match[0]);n.value=match[0].match(/value="([^"]+)"/)?.[1]??'';nodes.set(match[1],n);}
 nodes.get('scenario').value='0';nodes.get('stages').children=[new Element(),new Element(),new Element()];
 document.getElementById=id=>{assert.ok(nodes.has(id),id);return nodes.get(id);};document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);
 const calls=[],timers=[];let failReveal=false;
 const context=vm.createContext({document,Intl,console,window:{scrollTo(){},matchMedia:()=>({matches:reduced}),setTimeout:(fn,ms)=>{timers.push({fn,ms});}},fetch:async(path,options)=>{
  calls.push(path);const body=options?JSON.parse(options.body):null;let data;
  if(path==='/api/catalog')data={mode:'fixture',scenarios:adapter.scenarios()};
  else if(path==='/api/quote')data=experience.quote(body);
  else if(path==='/api/start')data=await experience.start(body);
  else if(path==='/api/decision')data=experience.decide(body);
  else if(path==='/api/break'){if(failReveal)return {ok:false,json:async()=>({error:'TEST_REVEAL_FAILURE'})};data=await experience.reveal(body);}
  else throw new Error('Unexpected request '+path);
  return {ok:true,json:async()=>publicResponse(data)};
 }});
 vm.runInContext(readFileSync(join(root,'public/app.js'),'utf8'),context);
 return {nodes,calls,timers,document,store,failReveal:()=>failReveal=true,allowReveal:()=>failReveal=false};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function dossier(t,options){const h=harness(t,options);await settle();h.nodes.get('choose-machine').onclick();await h.nodes.get('launch-machine').onclick();return h;}

test('M3 dossier opens from the narrative entry without a paid call or future request',async t=>{
 const h=await dossier(t),n=id=>h.nodes.get(id);
 assert.equal(n('workspace').hidden,false);assert.equal(n('investigate').hidden,true);
 assert.equal(n('break').hidden,true);assert.equal(n('outcome').hidden,true);
 assert.deepEqual(h.calls,['/api/catalog','/api/quote','/api/start']);
 assert.equal(h.store.read('budget','ledger'),null);
 assert.match(n('timeline').textContent,/ACCUMULATING movement/);assert.match(n('timeline').textContent,/DISTRIBUTING movement/);
 assert.match(n('coverage').textContent,/Recovered: participant flows, movement history, historical prices/);
});
test('M3 locked decision exposes the reveal control and moves focus without fetching AFTER',async t=>{
 const h=await dossier(t),n=id=>h.nodes.get(id);await n('pass').onclick();
 assert.equal(n('trust').disabled,true);assert.equal(n('pass').disabled,true);assert.equal(n('break').hidden,false);
 assert.match(n('locked').textContent,/DECISION LOCKED \/ PASS/);assert.equal(h.document.activeElement,n('break'));
 assert.equal(h.calls.includes('/api/break'),false);assert.equal(n('outcome').hidden,true);
});
test('M3 motion keeps outcome absent for 1800ms after explicit reveal and prevents a second request',async t=>{
 const h=await dossier(t),n=id=>h.nodes.get(id);await n('trust').onclick();
 const opening=n('break').onclick();await settle();
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,1800);assert.equal(n('outcome').hidden,true);
 assert.equal(n('horizons').textContent,'');assert.equal(n('firewall').classList.contains('breaching'),true);
 await n('break').onclick();assert.equal(h.calls.filter(p=>p==='/api/break').length,1);
 h.timers[0].fn();await opening;
 assert.equal(n('outcome').hidden,false);assert.equal(h.document.activeElement,n('outcome'));
 assert.match(n('horizons').textContent,/234.93%/);assert.equal(n('pass').disabled,true);
});
test('M3 reduced motion reveals immediately without a timer while preserving the decision gate',async t=>{
 const h=await dossier(t,{reduced:true}),n=id=>h.nodes.get(id);await n('pass').onclick();await n('break').onclick();
 assert.equal(h.timers.length,0);assert.equal(n('outcome').hidden,false);assert.equal(h.calls.filter(p=>p==='/api/break').length,1);
});
test('M3 receipt restores trigger focus and distinguishes requested from observed windows',async t=>{
 const h=await dossier(t),n=id=>h.nodes.get(id);n('path-receipt').focus();n('path-receipt').onclick();
 assert.equal(n('receipt').open,true);assert.match(n('receipt-content').textContent,/Requested window/);assert.match(n('receipt-content').textContent,/Observed window/);
 assert.match(n('receipt-content').textContent,/Temporal coverage PARTIAL/);assert.doesNotMatch(n('receipt-content').textContent,/129852477302/);assert.match(n('receipt-content').textContent,/classifications/);
 n('close-receipt').onclick();assert.equal(h.document.activeElement,n('path-receipt'));assert.equal(h.calls.includes('/api/break'),false);
});
test('M3 failed reveal remains locked, shows no outcome and allows an explicit retry',async t=>{
 const h=await dossier(t,{reduced:true}),n=id=>h.nodes.get(id);await n('pass').onclick();h.failReveal();await n('break').onclick();
 assert.equal(n('outcome').hidden,true);assert.equal(n('break').disabled,false);assert.equal(n('trust').disabled,true);
 assert.match(n('status').textContent,/Could not complete/);h.allowReveal();await n('break').onclick();assert.equal(n('outcome').hidden,false);
});
test('M3 start again clears revealed values before another sealed dossier',async t=>{
 const h=await dossier(t,{reduced:true}),n=id=>h.nodes.get(id);await n('trust').onclick();await n('break').onclick();n('home').onclick();
 assert.equal(n('outcome').hidden,true);assert.equal(n('horizons').textContent,'');assert.equal(n('trajectory').textContent,'');
 n('choose-machine').onclick();await n('launch-machine').onclick();assert.equal(n('break').hidden,true);assert.equal(n('pass').disabled,false);
 assert.equal(n('firewall').classList.contains('breached'),false);assert.equal(n('locked').textContent,'Your decision will lock.');
});
