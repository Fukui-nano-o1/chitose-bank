from pathlib import Path

p = Path('scripts/search-card-photo-summary.mjs')
s = p.read_text()
# A focused iframe can release scroll anchoring after the next render. Compare
# all positions within one browser task rather than mixing two snapshots.
anchor = 'return {summary:box(summary),heading:box('
assert s.count(anchor) == 1
s = s.replace(anchor, 'return {cover:box(el.querySelector(".job-card-media-scroll")||el.querySelector(".job-card-cover")),summary:box(summary),heading:box(')
start = s.index("            assert.equal(layout.display,'grid');")
end = s.index('            const overlap=', start)
s = s[:start] + '''            assert.equal(layout.display,'block','distributed grid is removed');
            assert.ok(Math.abs(layout.summary.y+layout.summary.height-layout.cover.y-layout.cover.height)<1,'summary is bottom-aligned inside the photograph: '+JSON.stringify(layout));
            const rows=[layout.heading,layout.region,layout.dates,layout.pay,layout.conditions].filter(Boolean);
            for(let row=1;row<rows.length;row++){
              assert.ok(rows[row].y>=rows[row-1].y+rows[row-1].height-.5,'text is grouped in consecutive vertical rows');
              assert.ok(Math.abs(rows[row].x-layout.heading.x)<1,'all summary rows share the original left alignment');
            }
            assert.ok(layout.heading.y>=layout.cover.y+31,'title has space above it instead of occupying the photo top');
            if(layout.conditions)assert.ok(Math.abs(layout.conditions.y+layout.conditions.height-layout.summary.y-layout.summary.height+14)<1,'conditions finish at the bottom padding');
            const alphas=[...layout.background.matchAll(/rgba\\([^)]*,\\s*([\\d.]+)\\)/g)].map(m=>Number(m[1]));
            assert.equal(alphas.length,5,'the backdrop uses five gradual stops');
            assert.equal(alphas[0],0,'the upper edge is transparent');
            for(let stop=1;stop<alphas.length;stop++)assert.ok(alphas[stop]>alphas[stop-1],'black becomes progressively darker toward the bottom');
            assert.ok(alphas.at(-1)>=.55&&alphas.at(-1)<=.60,'the darkest edge is capped at 60 percent, not the old 90 percent');
''' + s[end:]
s = s.replace("'distributed text fields never overlap'", "'grouped text fields never overlap'")
s = s.replace('geometry.distribution=layout;', 'geometry.bottomSummary=layout;')
assert "assert.equal(layout.display,'grid')" not in s
assert "the darkest edge is capped at 60 percent" in s
p.write_text(s)
print('Updated only photo-summary layout assertions. Existing interaction, safe-area and video checks retained.')
