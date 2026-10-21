// One-time, fail-closed extraction against the inspected source blob.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const file='src/features/jobs/create/LandingFlow.jsx';
let source=await readFile(file,'utf8');
const bytes=Buffer.from(source);
assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),'0fe96f9ef2c98380ed16c209da2313c27485d1de','source must equal inspected main');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(ast.parseDiagnostics.length,0);
const matches=[];
function visit(node){
  if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='div'&&node.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='data-step'&&a.initializer?.getText(ast)==='{step}'))matches.push(node);
  ts.forEachChild(node,visit);
}
visit(ast);assert.equal(matches.length,1,'only the shared body wrapper can change');
const target=matches[0];assert.ok(target.openingElement.getText(ast).includes('listing-page'));
const opening='<ListingPage key={step} step={step} isFarmer={isFarmer} embedded={embedded} stepAnim={stepAnim}\n          onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && stepAnim.startsWith("step-in")) setStepAnim(""); }}>';
const edits=[{start:target.openingElement.getStart(ast),end:target.openingElement.getEnd(),text:opening},{start:target.closingElement.getStart(ast),end:target.closingElement.getEnd(),text:'</ListingPage>'}];
for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
const anchor='import "./listingFlow.css";';assert.equal(source.split(anchor).length,2);
source=source.replace(anchor,'import { ListingPage } from "./components/ListingPage";\n'+anchor);
assert.equal(ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX).parseDiagnostics.length,0);
await writeFile(file,source);
const pkg=JSON.parse(await readFile('package.json','utf8'));
for(const test of ['scripts/listing-flow-foundation.test.mjs','scripts/listing-frame-ui.test.mjs']){
  assert.ok(!pkg.scripts['test:critical'].includes(test));pkg.scripts['test:critical']+=' '+test;
}
await writeFile('package.json',JSON.stringify(pkg,null,2)+'\n');
