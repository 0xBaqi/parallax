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
function harness(t,{reduced=false,quoteCredits=null,revealCost=0}={}){
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
 const listeners={};let cursor=-1;const entries=[];
 const win={scrollY:0,scrollTo({top}){this.scrollY=top;},addEventListener:(name,fn)=>listeners[name]=fn,matchMedia:()=>({matches:reduced}),setTimeout:(fn,ms)=>timers.push({fn,ms})};
 win.history={replaceState(s){entries[cursor<0?++cursor:cursor]=s;},pushState(s){entries.splice(cursor+1);entries[++cursor]=s;},back(){if(cursor>0)listeners.popstate({state:entries[--cursor]});},forward(){if(cursor<entries.length-1)listeners.popstate({state:entries[++cursor]});}};
 const visibility=[];const quote=nodes.get('quote');let hidden=true;Object.defineProperty(quote,'hidden',{get:()=>hidden,set:v=>{hidden=v;visibility.push(v);}});
 const context=vm.createContext({document,Intl,console,window:win,fetch:async(path,options)=>{
  calls.push(path);const body=options?JSON.parse(options.body):null;let data;
  if(path==='/api/catalog')data={mode:'fixture',scenarios:adapter.scenarios()};
  else if(path==='/api/quote'){data=experience.quote(body);if(quoteCredits!==null)data.credits=quoteCredits;}
  else if(path==='/api/start')data=await experience.start(body);
  else if(path==='/api/decision')data=experience.decide(body);
  else if(path==='/api/break'){if(revealCost && body.approvedCredits!==revealCost)return {ok:true,json:async()=>({approvalRequired:true,credits:revealCost})};if(failReveal)return {ok:false,json:async()=>({error:'TEST_REVEAL_FAILURE'})};data=await experience.reveal(body);}
  else throw new Error('Unexpected request '+path);
  return {ok:true,json:async()=>publicResponse(data)};
 }});
 vm.runInContext(readFileSync(join(root,'public/app.js'),'utf8'),context);
 return {nodes,calls,timers,document,store,win,visibility,failReveal:()=>failReveal=true,allowReveal:()=>failReveal=false};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function dossier(t,options){const h=harness(t,options);await settle();h.nodes.get('choose-machine').onclick();await h.nodes.get('launch-machine').onclick();return h;}


test('M3.1 machine quote never becomes visible, including while starting',async t=>{
 const h=await dossier(t);assert.equal(h.visibility.includes(false),false);assert.equal(h.store.read('budget','ledger'),null);
 assert.match(h.nodes.get('firewall-copy').textContent,/What happened next remains sealed/);
});
for(const decision of ['TRUST','PASS'])test('M3.1 '+decision+' and AFTER survive back, forward, and reopening',async t=>{
 const h=await dossier(t,{reduced:true}),n=id=>h.nodes.get(id);
 await n(decision.toLowerCase()).onclick();await n('break').onclick();const calls=h.calls.length;
 h.win.scrollY=880;h.win.history.back();assert.equal(n('setup').hidden,false);assert.equal(n('workspace').hidden,true);
 n('back').onclick();assert.equal(n('entry').hidden,false);
 h.win.history.forward();h.win.history.forward();assert.equal(n('workspace').hidden,false);assert.equal(h.win.scrollY,880);
 assert.equal(n('outcome').hidden,false);assert.match(n('locked').textContent,new RegExp(decision));assert.equal(n('trust').disabled,true);assert.equal(n('pass').disabled,true);
 await n('trust').onclick();assert.equal(h.calls.length,calls);
 n('back').onclick();await n('launch-machine').onclick();assert.equal(h.calls.length,calls);assert.equal(n('outcome').hidden,false);
});
test('M3.1 receipt Back, Forward and Close retain evidence scroll and focus',async t=>{
 const h=await dossier(t),n=id=>h.nodes.get(id);h.win.scrollY=712;n('path-receipt').focus();n('path-receipt').onclick();
 h.win.history.back();assert.equal(n('receipt').open,false);assert.equal(h.win.scrollY,712);assert.equal(h.document.activeElement,n('path-receipt'));
 h.win.history.forward();assert.equal(n('receipt').open,true);n('close-receipt').onclick();assert.equal(n('receipt').open,false);assert.equal(h.win.scrollY,712);
});
test('M3.1 Investigate retains estimate and explicit execution, Back returns home',async t=>{
 const h=harness(t);await settle();const n=id=>h.nodes.get(id);n('choose-investigate').onclick();n('chain').value='ethereum';n('token').value='0x'+'b'.repeat(40);
 await n('investigate').onsubmit({preventDefault(){}});assert.equal(n('quote').hidden,false);assert.equal(h.calls.includes('/api/start'),false);
 n('back').onclick();assert.equal(n('entry').hidden,false);h.win.history.forward();assert.equal(n('investigate').hidden,false);assert.equal(n('token').value,'0x'+'b'.repeat(40));
});
test('M3.1 explicit reset invalidates old history without resurrecting AFTER',async t=>{
 const h=await dossier(t,{reduced:true}),n=id=>h.nodes.get(id);await n('pass').onclick();await n('break').onclick();n('restart').onclick();h.win.history.back();h.win.history.forward();
 assert.equal(n('entry').hidden,false);assert.equal(n('outcome').hidden,true);n('choose-machine').onclick();await n('launch-machine').onclick();assert.equal(n('trust').disabled,false);assert.equal(n('outcome').hidden,true);
});
test('M3.1 browser Back during reveal completes the lock without stealing navigation',async t=>{
 const h=await dossier(t),n=id=>h.nodes.get(id);await n('pass').onclick();const opening=n('break').onclick();await settle();h.win.history.back();h.timers[0].fn();await opening;
 assert.equal(n('setup').hidden,false);h.win.history.forward();assert.equal(n('outcome').hidden,false);assert.equal(n('pass').disabled,true);
});

test('M3.1 Time Machine refuses unexpected paid quote without executing',async t=>{
 const h=await dossier(t,{quoteCredits:1});assert.equal(h.calls.includes('/api/start'),false);assert.equal(h.visibility.includes(false),false);assert.match(h.nodes.get('status').textContent,/SAVED_DOSSIER_UNAVAILABLE/);
});
test('M3.1 revisiting an earlier session restores its lock and reveal after another investigation',async t=>{
 const h=await dossier(t,{reduced:true}),n=id=>h.nodes.get(id);await n('pass').onclick();await n('break').onclick();n('back').onclick();n('back').onclick();n('choose-investigate').onclick();
 n('chain').value='ethereum';n('token').value='0x'+'b'.repeat(40);await n('investigate').onsubmit({preventDefault(){}});await n('run').onclick();assert.equal(n('outcome').hidden,true);
 h.win.history.back();h.win.history.back();n('choose-machine').onclick();await n('launch-machine').onclick();
 assert.equal(n('outcome').hidden,false);assert.match(n('locked').textContent,/PASS/);assert.equal(n('break').disabled,true);assert.equal(n('trust').disabled,true);assert.match(n('horizons').textContent,/234.93%/);
});

 test('M4.2 reveal approval, visible failure, fresh approval and locked successful AFTER',async t=>{
 const h=await dossier(t,{reduced:true,revealCost:5}),n=id=>h.nodes.get(id);
 await n('pass').onclick();const before=n('coverage').textContent;
 await n('break').onclick();assert.match(n('break').textContent,/APPROVE 5/);assert.equal(n('outcome').hidden,true);
 h.failReveal();await n('break').onclick();assert.match(n('wall-instruction').textContent,/TEST_REVEAL_FAILURE/);assert.match(n('break').textContent,/RETRY/);assert.equal(n('outcome').hidden,true);assert.equal(n('pass').disabled,true);
 h.allowReveal();await n('break').onclick();assert.match(n('break').textContent,/APPROVE 5/);await n('break').onclick();assert.equal(n('outcome').hidden,false);assert.equal(n('coverage').textContent,before);assert.match(n('locked').textContent,/PASS/);
 });
