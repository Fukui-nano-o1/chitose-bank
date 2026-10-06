// Geometry/control-isolation checks using real components and browser engines.
// YouTube networking is mocked. These checks are not real iPhone/audio tests.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, webkit } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(root, '.video-safe-test-'));
const entry = path.join(temp, 'entry.jsx');
const result = [];
const fixture = `import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CSS} from '../src/appStyles';
import {JobPhotoGallery,JobWorkVideo,JobTopBar} from '../src/features/jobs/search/components/JobDetailPanel';
import {JobDetailBody} from '../src/components/JobDetailBody';
import '../src/features/jobs/create/listingFlow.css';
window.qaCSS=CSS;
const job={id:null,crop:'ブロッコリー',task:'収穫',photos:['/one.jpg','/two.jpg'],workVideoUrl:'https://youtu.be/aKydtOXW8mI'};
function Gallery({video=true}) {const ref=useRef(null);const [active,setActive]=useState(0);const j={...job,workVideoUrl:video?job.workVideoUrl:''};return <JobPhotoGallery job={j} activeSlide={active} photosLooped={false} scrollerRef={ref} onScroll={e=>setActive(Math.round(e.currentTarget.scrollLeft/e.currentTarget.clientWidth))}/>;}
function Fixture(){const mode=window.qaMode; if(mode==='review')return <div className='job-listing-flow'><header className='listing-header'>掲載内容の確認</header><div className='listing-scroll'><div className='listing-page listing-page-wide'><div><JobDetailBody job={job} employer={{}} trust={{}} noTabs/></div></div></div></div>;
if(mode==='boxed')return <div style={{padding:12}}><JobDetailBody job={job} employer={{}} trust={{}} noTabs/></div>;
if(mode==='inline')return <div style={{padding:12}}><JobWorkVideo job={job}/></div>;
return <main style={{maxWidth:1200,margin:'0 auto',padding:'0 12px'}}><div className='job-detail-body-mobile'><JobTopBar/><button className='job-float-back job-float-btn'>戻る</button><div className='job-float-right'><button className='job-float-btn'>共有</button></div><div className='job-hero'><Gallery video={mode!=='photo'}/></div><div className='job-detail-sheet' style={{minHeight:1800}}>求人の内容</div></div></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const replaceInsets = css => css.replace(/env\(safe-area-inset-(top|right|bottom|left)(?:,\s*[^)]+)?\)/g, (_,edge)=>`var(--qa-safe-${edge}, 0px)`);
const intersect = (a,b) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
try {
  await writeFile(entry, fixture);
  await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
    name:'video-safe-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/analytics/client.js');}
  },react()],build:{outDir:path.join(temp,'out'),lib:{entry,name:'SafeVideoQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const bundle=await readFile(path.join(temp,'out','fixture.iife.js'),'utf8');
  const cssFiles=(await readdir(path.join(temp,'out'))).filter(f=>f.endsWith('.css'));
  const componentCSS=(await Promise.all(cssFiles.map(f=>readFile(path.join(temp,'out',f),'utf8')))).join('\n');
  for (const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
    const browser=await type.launch({headless:true});
    try {
      const sizes=[{width:320,height:568,top:20,bottom:0},{width:390,height:844,top:59,bottom:34},{width:430,height:932,top:59,bottom:34},{width:740,height:390,top:0,bottom:21,left:44,right:44}];
      for (const size of sizes) for (const mode of ['detail','review','boxed','inline','photo']) {
        const context=await browser.newContext({viewport:{width:size.width,height:size.height},hasTouch:true,isMobile:true});
        const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',route=>{
          const u=new URL(route.request().url());
          if(u.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><div id='root'></div><script>window.qaMode=${JSON.stringify(mode)};window.qaCalls=[];</script>`});
          if(u.hostname==='www.youtube-nocookie.com')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#111;color:white}button{position:absolute;top:8px;right:8px}</style><button id="settings" onclick="this.textContent=\'設定を開いた\'">設定</button>'});
          if(/\.jpg$/.test(u.pathname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#b5cdb9"/></svg>'});
          return route.abort();
        });
        await page.goto('https://ui.test/fixture');await page.addScriptTag({content:bundle});
        const css=await page.evaluate(()=>window.qaCSS);
        await page.addStyleTag({content:replaceInsets(css+'\n'+componentCSS)+`\n:root{--qa-safe-top:${size.top}px;--qa-safe-bottom:${size.bottom}px;--qa-safe-left:${size.left||0}px;--qa-safe-right:${size.right||0}px}`});
        await page.waitForTimeout(180);
        if(mode==='photo'){
          const box=await page.locator('.job-hero .job-photo-slide').first().boundingBox();
          assert.ok(Math.abs(box.height-(size.height*.8+32))<1,'photo cover keeps its original height');
          assert.equal(await page.locator('iframe').count(),0);
          result.push({engine,mode,width:size.width,photoHeight:box.height});
        } else if(mode==='inline') {
          const frame=await page.locator('.job-work-video-frame').boundingBox();
          assert.ok(Math.abs(frame.height-frame.width*9/16)<1,'non-gallery video retains original 16:9 layout');
          result.push({engine,mode,width:size.width,frame});
        } else {
          const gallery=page.locator('.job-photo-carousel');const strip=gallery.locator('.carousel-scroll');
          await strip.evaluate(el=>{el.scrollTo({left:el.clientWidth*2,behavior:'instant'});el.dispatchEvent(new Event('scroll',{bubbles:true}));});
          await page.waitForTimeout(160);
          const player=gallery.locator('iframe');const frame=await player.boundingBox();
          const slide=await gallery.locator('.job-work-video-slide').boundingBox();
          assert.ok(frame && slide && frame.width>=200 && frame.height>=199.5,'player and standard controls retain minimum dimensions');
          assert.ok(frame.y>slide.y+15 && frame.y+frame.height<=slide.y+slide.height-79,'player is inset above and below, never fills the photo cover');
          assert.ok(frame.x>=slide.x+11&&frame.x+frame.width<=slide.x+slide.width-11,'horizontal safe padding is respected');
          if(mode==='detail'){
            for(const nav of await page.locator('.job-float-back,.job-float-right').all()){
              const nb=await nav.boundingBox();if(nb){assert.equal(intersect(frame,nb),0,'page navigation cannot overlay YouTube');assert.ok(frame.y>=nb.y+nb.height,'player is below page navigation');}
            }
            assert.ok(frame.y>=size.top+76,'player remains below device status area');
          }
          for(const arrow of await gallery.locator('.cb-carousel-arrow').all()){
            const ab=await arrow.boundingBox();if(ab)assert.equal(intersect(frame,ab),0,'carousel arrows cannot overlay YouTube');
          }
          await page.frameLocator('.job-photo-carousel iframe').locator('#settings').click();
          assert.equal(await page.frameLocator('.job-photo-carousel iframe').locator('#settings').textContent(),'設定を開いた','top-right player control is clickable');
          assert.equal(await gallery.locator('.job-work-video--gallery button').count(),0,'no custom sound/control overlay');
          if(engine==='chromium'&&mode==='detail'&&size.width===390)await page.screenshot({path:'/tmp/detail-video-safe-mobile.png'});
          result.push({engine,mode,width:size.width,frame,slide});
        }
        assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal page overflow');
        await context.close();
      }
    } finally {await browser.close();}
  }
  await writeFile('/tmp/detail-video-safe-results.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({cases:result.length,result:'passed',engines:['Chromium','WebKit'],safeArea:'emulated insets',YouTube:'mocked controls, not real playback',iPhoneHardware:'not tested'}));
} finally {await rm(temp,{recursive:true,force:true});}
