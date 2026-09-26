import { cpSync,mkdirSync,readdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
process.chdir((await import('node:url')).fileURLToPath(new URL('../',import.meta.url)));
const files=[];
function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())scan(p);else files.push(p);}}
scan('server');scan('public');scan('fixtures');scan('curated');
for(const p of files.filter(p=>/\.(mjs|js)$/.test(p)))execFileSync(process.execPath,['--check',p],{stdio:'inherit'});
const text=files.filter(p=>p.startsWith('public')).map(p=>readFileSync(p,'utf8')).join('\n');
if(/NANSEN_API_KEY|api\.nansen\.ai|historical-token|return7dPct/.test(text))throw new Error('SERVER_BOUNDARY_VIOLATION');
mkdirSync('dist',{recursive:true});
for(const dir of ['server','public','fixtures','curated'])cpSync(dir,join('dist',dir),{recursive:true});
writeFileSync('dist/package.json',JSON.stringify({private:true,type:'module',engines:{node:'>=24'}}));
writeFileSync('dist/manifest.json',JSON.stringify(files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),null,2));
console.log(`Production build passed: ${files.length} files; server, private fixtures and public assets separated; no runtime dependencies.`);

