import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {createDatabase,root,s} from './database.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
export async function filesUnder(dir) {
 const entries=await readdir(new URL(dir+'/',root),{withFileTypes:true});
 const groups=await Promise.all(entries.filter(e=>!e.name.startsWith('.')).map(e=>
  e.isDirectory()?filesUnder(dir+'/'+e.name):[dir+'/'+e.name]));
 return groups.flat().sort();
}

// AST-based inventory includes literal and dynamic call targets. Dynamic builders
// are explicitly visible; changing a target/operation requires contract review.
export async function sourceOperations() {
 const files=(await Promise.all(['src','api','supabase/functions'].map(filesUnder))).flat();
 const operations=[];
 for(const file of files.filter(f=>/\.[cm]?[jt]sx?$/.test(f))){
  const text=await readFile(new URL(file,root),'utf8');
  const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true, file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const walk=node=>{
   if(ts.isCallExpression(node)){
    const e=node.expression;
    if(ts.isPropertyAccessExpression(e)){
     const method=e.name.text, receiver=e.expression.getText(ast);
     let kind;
     if(method==='from'&&!['Array','Buffer'].includes(receiver)&&!receiver.endsWith('Array'))kind=receiver.includes('storage')?'storage':'table';
     if(method==='rpc')kind='rpc';
     if(receiver.endsWith('.auth')||receiver.endsWith('.auth.admin'))kind='auth';
     if(receiver.endsWith('.functions')&&method==='invoke')kind='edge';
     if(method==='channel'&&/supabase|client/.test(receiver))kind='realtime-channel';
     if(method==='on'&&node.arguments[0]?.getText(ast).includes('postgres_changes')){
      const config=node.arguments[1];
      operations.push({kind:'realtime-subscription',file,target:config?.getText(ast)||'(none)',dynamic:true,methods:['subscribe']});
     }
     if(kind){
      const arg=node.arguments[0];
      const literal=arg&&(ts.isStringLiteralLike(arg));
      const target=kind==='auth'?method:literal?arg.text:arg?.getText(ast)||'(none)';
      const chain=[];let parent=node.parent;
      while(parent&&(ts.isPropertyAccessExpression(parent)||ts.isCallExpression(parent))){
       if(ts.isPropertyAccessExpression(parent))chain.push(parent.name.text);
       parent=parent.parent;
      }
      operations.push({kind,file,target,dynamic:kind!=='auth'&&!literal,methods:chain.filter(m=>['select','insert','upsert','update','delete','upload','remove','list','download','createSignedUrl','createSignedUrls','getPublicUrl'].includes(m))});
     }
    }
    if(ts.isIdentifier(e)&&e.text==='fetch'){
     const arg=node.arguments[0];const target=arg?.getText(ast)||'(none)';
     operations.push({kind:'fetch',file,target,dynamic:!arg||!ts.isStringLiteralLike(arg),methods:[]});
    }
   }
   ts.forEachChild(node,walk);
  };walk(ast);
 }
 return [...new Map(operations.map(o=>[JSON.stringify(o),o])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function databaseOperations(db) {
 const q=async sql=>(await db.query(sql)).rows;
 const tables=await q(`select n.nspname as schema,c.relname as name,c.relkind as kind,c.relrowsecurity as rls,c.reloptions as options from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','v') and c.relname not like 'qa_%' order by 1,2`);
 const policies=await q("select * from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname");
 const triggers=await q(`select n.nspname as schema,c.relname as table,t.tgname as name,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private','storage') order by 1,2,3`);
 const entries=[];
 for(const table of tables)for(const action of ['SELECT','INSERT','UPDATE','DELETE']){
  const resource=table.schema+'.'+table.name;
  const grants=(await db.query("select r,has_table_privilege(r,$1,$2) as allowed from unnest(array['anon','authenticated']) r",[resource,action])).rows;
  const columns=(await db.query("select grantee,column_name from information_schema.column_privileges where table_schema=$1 and table_name=$2 and privilege_type=$3 and grantee in ('anon','authenticated') order by grantee,column_name",[table.schema,table.name,action])).rows;
  entries.push({id:`${resource}:${action}`,kind:table.kind==='v'?'view':'table',resource,action,rls:table.rls,options:table.options||[],grants,columns,
   policies:policies.filter(p=>p.schemaname===table.schema&&p.tablename===table.name&&['ALL',action].includes(p.cmd)),
   triggers:triggers.filter(t=>t.schema===table.schema&&t.table===table.name)});
 }
 const functions=await q(`select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as args,pg_get_function_result(p.oid) as result,p.prosecdef as definer,pg_get_functiondef(p.oid) as definition,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1,2,3`);
 for(const f of functions.filter(f=>f.name!=='uuid_generate_v4'&&!f.name.startsWith('qa_'))){
  const {definition,...rest}=f;
  entries.push({id:`${f.schema}.${f.name}(${f.args})`,kind:f.result==='trigger'?'trigger-function':f.schema==='public'?'rpc':'internal-function',...rest,definitionSha256:hash(definition)});
 }
 return entries;
}

const cell=v=>String(v??'—').replaceAll('|','\\|').replaceAll('\n',' ');
export function renderMatrix(contract) {
 const lines=['# Chitose-bank 全操作の権限表','',
  '確認元：本番DB定義（2026-10-26 JST、個人データなし）＋このブランチの権限マイグレーション＋全ソースの呼び出し。',
  'この表は適用後の設計。生成だけでは本番に反映されない。権限の条件式・列権限・トリガーは同名の JSON に収録。',
  '表の掲載と挙動テストの合格は別。すべての業務の全入力組合せ・実環境JWT・Storage HTTPを網羅した保証ではない。',
  '', '## テーブル・ビュー：操作ごとの直接アクセス','',
  '| 操作 | 匿名のテーブル権限 | 会員のテーブル権限 | RLS条件（名前） | 追加の制約 |',
  '|---|---|---|---|---|'];
 for(const e of contract.database.filter(e=>['table','view'].includes(e.kind))){
  const permissions=['anon','authenticated'].map(r=>e.grants.find(g=>g.r===r)?.allowed?'あり（条件付き）':e.columns.some(c=>c.grantee===r)?'列限定':'なし');
  lines.push(`| ${cell(e.id)} | ${permissions[0]} | ${permissions[1]} | ${cell(e.policies.map(p=>p.policyname).join(' / ')||'なし')} | ${cell(e.triggers.map(t=>t.name).join(' / ')||'—')} |`);
 }
 lines.push('','## 関数：実行権限','',
  '実行権限「あり」は入口を呼べるという意味。関数内の当事者・管理者・状態・期限の判定で拒否される場合がある。内部関数はHTTP経由の公開を意味しない。',
  '', '| 関数 | 区分 | 匿名 EXECUTE | 会員 EXECUTE | 実行権限の主体 |','|---|---|---|---|---|');
 for(const e of contract.database.filter(e=>!['table','view'].includes(e.kind)))lines.push(`| ${cell(e.id)} | ${e.kind} | ${e.anon?'あり':'なし'} | ${e.authenticated?'あり':'なし'} | ${e.definer?'定義者（内部判定必須）':'呼出者'} |`);
 lines.push('','## ソースから呼び出す経路','',
  '動的な対象は式を明示。実行時の全分岐を列挙したという意味ではない。新規・変更呼び出しはCIの差分検査で止まる。',
  '', '| 種別 | 対象・式 | 操作 | 呼出元 |','|---|---|---|---|');
 for(const e of contract.source)lines.push(`| ${e.kind}${e.dynamic?'（動的）':''} | ${cell(e.target)} | ${cell(e.methods.join(', '))} | ${e.file} |`);
 lines.push('','## HTTP / Edge エントリポイント','', '| ファイル | 判定 |','|---|---|');
 for(const e of contract.http)lines.push(`| ${e.file} | ${e.rule} |`);
 lines.push('','## Storage バケット','', '| バケット | 匿名のURL公開 |','|---|---|');
 for(const b of contract.buckets)lines.push(`| ${b.id} | ${b.public?'公開（オブジェクトSELECTのRLSとは別）':'非公開（署名URL・RLS等で許可）'} |`);
 return lines.join('\n')+'\n';
}

export async function captureContract() {
 const db=await createDatabase();
 try {
  const httpFiles=(await Promise.all(['api','supabase/functions'].map(filesUnder))).flat().filter(f=>/\.[jt]s$/.test(f));
  const rules={
   'api/health.js':'GET/HEADのみ。サービス権限は疎通・件数確認。個別データを返さない。',
   'api/auth/send-otp.js':'廃止済み（410）。',
   'api/auth/verify-otp.js':'廃止済み（410）。',
   'api/sync-farmer.js':'廃止済み（410）。',
   'api/j/[num].js':'公開求人の共有用メタ情報。匿名権限で取得。',
   'supabase/functions/send-push/index.ts':'DBに保存したトリガー秘密値とヘッダーを照合してからサービス権限を使用。',
  };
  const http=[];
  for(const file of httpFiles){if(!rules[file])throw new Error('HTTP authorization rule missing: '+file);http.push({file,rule:rules[file],sha256:hash(await readFile(new URL(file,root)))});}
  return {version:1,baselineAt:s.time,database:await databaseOperations(db),source:await sourceOperations(),http,buckets:s.buckets};
 } finally {await db.close();}
}

if(process.argv.includes('--write')){
 const contract=await captureContract();
 await writeFile(new URL('security/authorization-contract.json',root),JSON.stringify(contract,null,2)+'\n');
 await writeFile(new URL('security/authorization-matrix.md',root),renderMatrix(contract));
 console.log(JSON.stringify({database:contract.database.length,source:contract.source.length,http:contract.http.length}));
}
