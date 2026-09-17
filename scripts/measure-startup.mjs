import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
// npm run measure:startup -- /tmp/startup.json
// raw/gzipはentryと静的依存の合計。実機の描画時間とは区別して扱う。
const report = process.argv[2];
const root = fileURLToPath(new URL('../', import.meta.url));
await build({root,plugins:[{name:'measure-startup',generateBundle(_,bundle){
  const chunks=Object.values(bundle).filter(v=>v.type==='chunk');
  const graph=Object.fromEntries(chunks.map(c=>[c.fileName,{entry:c.isEntry,imports:c.imports,dynamicImports:c.dynamicImports,bytes:Buffer.byteLength(c.code),gzip:gzipSync(c.code).length,modules:Object.entries(c.modules).map(([id,m])=>({id,bytes:m.renderedLength})).sort((a,b)=>b.bytes-a.bytes)}]));
  const seen=new Set();function visit(f){if(seen.has(f)||!graph[f])return;seen.add(f);graph[f].imports.forEach(visit);}
  chunks.filter(c=>c.isEntry).forEach(c=>visit(c.fileName));
  const initial=[...seen];
  const metrics = {initial,bytes:initial.reduce((s,f)=>s+graph[f].bytes,0),gzip:initial.reduce((s,f)=>s+graph[f].gzip,0),graph};
  if (report) writeFileSync(report, JSON.stringify(metrics, null, 2));
  console.log('Startup JS:', JSON.stringify({ bytes:metrics.bytes, gzip:metrics.gzip, files:initial.length }));
  if (metrics.bytes > 850000 || metrics.gzip > 250000) throw new Error('Startup JS budget exceeded (850KB raw / 250KB gzip)');
}}]});
