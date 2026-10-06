from pathlib import Path

p = Path('src/components/JobCard.jsx')
s = p.read_text()
replacements = [
    ('<div style={{ display:"flex", alignItems:"baseline", gap:6 }}>', '<div className="job-card-heading" style={{ display:"flex", alignItems:"baseline", gap:6 }}>'),
    ('{job.region && (\n          <p className="f-sans"', '{job.region && (\n          <p className="f-sans job-card-region"'),
    ('{job.dateStartRaw && (\n          <p className="f-sans"', '{job.dateStartRaw && (\n          <p className="f-sans job-card-dates"'),
    ('<p className="f-mono" style={{ fontSize: isList?15:14', '<p className="f-mono job-card-pay" style={{ fontSize: isList?15:14'),
    ('<div style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap" }}>', '<div className="job-card-conditions" style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap" }}>'),
    ('<div style={{ position:"absolute", top:0, left:0, right:0, height:photoHeight', '<div className="job-card-end-label" style={{ position:"absolute", top:0, left:0, right:0, height:photoHeight'),
]
for before, after in replacements:
    assert s.count(before) == 1, ('unexpected source anchor', before, s.count(before))
    s = s.replace(before, after)
p.write_text(s)

# Extend the existing real-browser regression suite with distribution and overlap checks.
p = Path('scripts/search-card-photo-summary.mjs')
s = p.read_text()
s = s.replace("['multiple','single','no-photo','no-video','invalid','hourly','no-pay','closed']", "['multiple','single','no-photo','no-video','invalid','hourly','no-pay','closed','single-filled','long','no-region','no-date']")
a = "console.log(JSON.stringify({engine,width,kind}));"
b = """if(kind==='single-filled'){job.photos=['/one.jpg'];job.filled=true;}
            if(kind==='long'){job.region='徳島県吉野川市山川町の長い地域名も表示する確認';job.task='収穫・調整・出荷準備';job.pay=1250000;}
            if(kind==='no-region')job.region='';
            if(kind==='no-date')job.dateStartRaw='';
            job.isNew=kind==='single';
            console.log(JSON.stringify({engine,width,kind}));"""
assert s.count(a) == 1
s = s.replace(a, b)
a = "if(!job.closed){await card.locator"
b = "if(!job.closed&&!job.filled){await card.locator"
assert s.count(a) == 1
s = s.replace(a, b)
s = s.replace("kind==='hourly'?'時給1,250円':'日給10,000円'", "kind==='hourly'?'時給1,250円':kind==='long'?'日給1,250,000円':'日給10,000円'")
a = "assert.equal(geometry.color,'rgb(255, 255, 255)');"
b = """assert.equal(geometry.color,'rgb(255, 255, 255)');
            const layout=await card.evaluate(el=>{
              const box=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
              const summary=el.querySelector('.job-card-summary');
              return {summary:box(summary),heading:box(el.querySelector('.job-card-heading')),region:box(el.querySelector('.job-card-region')),dates:box(el.querySelector('.job-card-dates')),pay:box(el.querySelector('.job-card-pay')),conditions:box(el.querySelector('.job-card-conditions')),heart:box(el.querySelector('[aria-label=\"いいね\"]')),end:box(el.querySelector('.job-card-end-label')),background:getComputedStyle(summary).backgroundImage,display:getComputedStyle(summary).display};
            });
            assert.equal(layout.display,'grid');
            assert.ok(layout.summary.height>=219,'summary is spread over the photo height');
            assert.ok(layout.heading.y-layout.summary.y<70,'title stays in the upper region');
            if(layout.region&&layout.dates){assert.ok(layout.dates.x>layout.region.x,'location and dates use opposite sides');assert.ok(layout.region.y>=layout.heading.y+layout.heading.height,'facts follow the title');}
            if(layout.pay){assert.ok(layout.pay.y>layout.heading.y+layout.heading.height,'pay is separated from the title');assert.ok(layout.pay.x+layout.pay.width>=layout.summary.x+layout.summary.width-15,'pay uses the right side');}
            const alphas=[...layout.background.matchAll(/rgba\\([^)]*,\\s*([\\d.]+)\\)/g)].map(m=>Number(m[1]));
            assert.ok(alphas.length>=2&&Math.max(...alphas)<=.28,'large-area black shading is at most 28 percent');
            const overlap=(a,b)=>a&&b&&Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.5&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.5;
            const fields=[layout.heading,layout.region,layout.dates,layout.pay,layout.conditions].filter(Boolean);
            for(let a=0;a<fields.length;a++)for(let b=a+1;b<fields.length;b++)assert.equal(overlap(fields[a],fields[b]),false,'distributed text fields never overlap');
            for(const field of fields){assert.equal(!!overlap(field,layout.heart),false,'text avoids the like control');assert.equal(!!overlap(field,layout.end),false,'closed label remains separate');}
            assert.equal(!!layout.region,!!job.region);assert.equal(!!layout.dates,!!job.dateStartRaw);
            geometry.distribution=layout;"""
assert s.count(a) == 1
s = s.replace(a, b)
p.write_text(s)
print('Applied search-only spacing and lighter photo shading. No pay values, navigation, video behavior or database changes.')
