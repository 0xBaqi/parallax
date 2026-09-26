import { mkdirSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync,fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './contracts.mjs';
const heldLocks=new Set();
export class Store {
  constructor(directory) { this.directory=directory; mkdirSync(directory,{recursive:true}); }
  path(kind,key) {
    if (!/^[a-z-]+$/.test(kind) || !/^[a-zA-Z0-9-]+$/.test(key)) throw new AppError('INVALID_STORAGE_KEY');
    const dir=join(this.directory,kind);mkdirSync(dir,{recursive:true});return join(dir,`${key}.json`);
  }
  read(kind,key) {
    try { return JSON.parse(readFileSync(this.path(kind,key),'utf8')); }
    catch(e) { if(e.code==='ENOENT') return null; throw new AppError('STORAGE_UNAVAILABLE',503); }
  }
  write(kind,key,value) {
    const dest=this.path(kind,key),tmp=`${dest}.${randomUUID()}.tmp`;
    const fd=openSync(tmp,'wx',0o600);
    try { writeFileSync(fd,JSON.stringify(value));fsyncSync(fd); } finally {closeSync(fd);}
    renameSync(tmp,dest);
  }
  lock() {
    const file=join(this.directory,'server.lock');
    if(heldLocks.has(file))throw new AppError('DATA_DIRECTORY_ALREADY_LOCKED',503);
    try { const fd=openSync(file,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd); }
    catch(e) {
      if(e.code!=='EEXIST')throw new AppError('DATA_DIRECTORY_ALREADY_LOCKED',503);
      const owner=Number(readFileSync(file,'utf8'));
      if(!Number.isSafeInteger(owner)||owner<=0)throw new AppError('DATA_DIRECTORY_ALREADY_LOCKED',503);
      // A leftover PID equal to this fresh process cannot own an earlier lock.
      if(owner!==process.pid){try{process.kill(owner,0);throw new AppError('DATA_DIRECTORY_ALREADY_LOCKED',503);}catch(err){if(err.code!=='ESRCH')throw new AppError('DATA_DIRECTORY_ALREADY_LOCKED',503);}}
      unlinkSync(file);
      try{const fd=openSync(file,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);}catch{throw new AppError('DATA_DIRECTORY_ALREADY_LOCKED',503);}
    }
    heldLocks.add(file);
    return () => {unlinkSync(file);heldLocks.delete(file);};
  }
}
