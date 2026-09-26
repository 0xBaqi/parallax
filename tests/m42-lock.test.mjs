import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
for(const owner of [process.pid,2147483647])test('M4.2 recover stale process lock '+owner,t=>{const dir=mkdtempSync(join(tmpdir(),'parallax-lock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'server.lock'),String(owner));const release=new Store(dir).lock();assert.throws(()=>new Store(dir).lock(),/DATA_DIRECTORY_ALREADY_LOCKED/);release();});
test('M4.2 refuse malformed lock owner',t=>{const dir=mkdtempSync(join(tmpdir(),'parallax-lock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'server.lock'),'unknown');assert.throws(()=>new Store(dir).lock(),/DATA_DIRECTORY_ALREADY_LOCKED/);});
