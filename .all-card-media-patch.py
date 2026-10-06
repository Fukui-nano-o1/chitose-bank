from pathlib import Path

def replace_once(path, old, new):
    p = Path(path)
    source = p.read_text()
    assert source.count(old) == 1, f'{path}: expected one replacement anchor'
    p.write_text(source.replace(old, new))

replace_once('src/components/JobCard.jsx', '''  const videoId = props.videoPreview && props.variant === "list" ? youtubeVideoId(props.job?.workVideoUrl) : "";
  if (videoId) return <JobVideoCard key={`${props.job.id}:${videoId}`} {...props} videoId={videoId} height={JOB_CARD_PHOTO_H}
    summary={<StaticJobCard {...props} hideMedia />} />;''', '''  const videoId = youtubeVideoId(props.job?.workVideoUrl);
  const images = (Array.isArray(props.job?.photos) ? props.job.photos : []).filter(photo => photoThumb(photo));
  const cardStyle = props.variant === "list"
    ? { display:"block", width:"100%", marginBottom:22, position:"relative" }
    : props.variant === "wide"
    ? { display:"block", width:"100%", position:"relative" }
    : { display:"block", flexShrink:0, ...JOB_CARD_RELATED_SIZE, position:"relative" };
  // Every variant shares the same carousel. A single photo needs no empty extra slides.
  if (videoId || images.length > 1) return <JobVideoCard key={JSON.stringify([props.job.id, videoId, images.map(photoThumb)])}
    {...props} videoId={videoId} height={JOB_CARD_PHOTO_H} cardStyle={cardStyle}
    summary={<StaticJobCard {...props} hideMedia />} />;''')
replace_once('src/components/JobCard.jsx', '      style={cardStyle}', '      style={hideMedia ? { ...cardStyle, width:"100%", maxWidth:"none", marginBottom:0 } : cardStyle}')
replace_once('src/components/JobSearchMapView.jsx', 'variant="list" videoPreview priority={index === 0}', 'variant="list" priority={index === 0}')
replace_once('scripts/fixtures/job-video/entry.jsx', 'variant="list" videoPreview={!job.noVideoPreview}', 'variant={job.variant || "list"}')
replace_once('scripts/job-video-facade.test.mjs', 'noVideoPreview: true', 'variant: "related"')
replace_once('scripts/job-video-facade.test.mjs', 'length === 2, \'video cards\'', 'length === 3, \'video cards across variants\'')
replace_once('scripts/job-video-facade.test.mjs', '    assert.match(search, /variant="list" videoPreview/);', '''    assert.match(search, /variant="list" priority=/);
    const cardSource = await readFile(path.join(root, 'src/components/JobCard.jsx'), 'utf8');
    assert.doesNotMatch(cardSource, /props\\.videoPreview|props\\.variant === "list" \\? youtubeVideoId/);

    // All list/wide/related/default variants: video+photos and photos-only.
    Object.defineProperty(w.document, 'hidden', { configurable:true, value:false });
    const variants = ['list', 'wide', 'related', ''];
    const jobs = variants.flatMap((variant, index) => [
      { id:9100+index*2, variant, crop:'野菜', task:'収穫', photos:['/first.jpg', { url:'/second.jpg', thumb:'/second-thumb.jpg' }] },
      { id:9101+index*2, variant, crop:'野菜', task:'選別', workVideoUrl:'https://youtu.be/aKydtOXW8mI', photos:['/first.jpg','/second.jpg'] },
    ]);
    jobs.push({ id:9190, crop:'ナス', task:'収穫', photos:['/single.jpg'] },
      { id:9191, crop:'ネギ', task:'選別', photos:null },
      { id:9192, crop:'米', task:'調整', workVideoUrl:'https://example.com/video', photos:[null, {}, '/valid-one.jpg','/valid-two.jpg'] });
    w.qaRender(jobs);
    await until(() => w.document.querySelectorAll('.job-media-card').length === 9, 'shared media for all variants');
    assert.equal(w.document.querySelectorAll('iframe').length, 0);
    for (let i=0; i<8; i++) {
      const card = w.document.querySelectorAll('.job-media-card')[i];
      const strip = card.querySelector('.job-card-media-scroll');
      Object.defineProperty(strip, 'clientWidth', { value:280 });
      assert.equal(strip.style.height, '220px');
      assert.equal(card.querySelectorAll('[data-media-type="photo"]').length,2);
      assert.equal(card.querySelectorAll('[data-media-type="youtube"]').length, i%2);
      assert.equal(card.querySelector('a[href="#/work/job/'+jobs[i].id+'"]').getAttribute('href'), '#/work/job/'+jobs[i].id);
      const oldOpened = w.qaOpened;
      card.querySelector('[aria-label="次の画像・動画"]').click();
      await until(() => strip.scrollLeft === 280, 'next item in variant');
      await until(() => card.querySelector('[aria-live]').textContent.includes(i%2 ? '写真1' : '写真2'), 'correct media counter');
      assert.equal(w.qaOpened,oldOpened,'arrow never opens a job');
      card.querySelector('[aria-label="前の画像・動画"]').click();
      await until(() => strip.scrollLeft === 0, 'return to first item');
      strip.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true,cancelable:true}));
      await until(() => strip.scrollLeft === 280, 'keyboard navigation');
      assert.equal(w.qaOpened,oldOpened);
      if (i%2) {
        assert.equal(card.querySelectorAll('.job-card-media-types button').length,2);
        card.querySelector('.job-card-media-types button').click();
        await until(() => strip.scrollLeft === 0, 'YouTube type selector');
        assert.equal(card.querySelectorAll('iframe').length,0,'selecting YouTube alone never downloads its player');
      } else {
        assert.equal(card.querySelector('.job-card-media-types'),null,'no blank YouTube tab');
        assert.equal(card.querySelector('.job-video-facade'),null);
      }
    }
    const photoCard = w.document.querySelector('.job-photo-card');
    const strip = photoCard.querySelector('.job-card-media-scroll');
    const photoLink = photoCard.querySelector('.job-card-photo-link');
    const openedBeforeSwipe = w.qaOpened;
    strip.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,clientX:220,clientY:100}));
    strip.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:30,clientY:101}));
    strip.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientX:30,clientY:101}));
    photoLink.click();
    assert.equal(w.qaOpened,openedBeforeSwipe,'synthetic click after a swipe cannot open the job');
    strip.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,clientX:50,clientY:50}));
    strip.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientX:50,clientY:50}));
    photoLink.click();
    assert.equal(w.qaOpened,openedBeforeSwipe+1,'ordinary photo tap still opens the job');
    const relatedCard = [...w.document.querySelectorAll('.job-media-card')][4];
    assert.equal(relatedCard.style.maxWidth,'280px');
    assert.equal(relatedCard.querySelector('a:last-child').style.maxWidth,'none');
    assert.equal(w.document.querySelector('[href="#/work/job/9190"]').querySelector('img').getAttribute('src'),'/single.jpg');
    assert.ok(w.document.querySelector('[href="#/work/job/9191"]'),'empty media keeps the existing fallback link');
    w.qaRender([{...jobs[1],photos:['/short.jpg']}]);
    await until(() => w.document.querySelectorAll('[data-media-type="photo"]').length === 1,'changed photos reset media');
    assert.match(w.document.querySelector('[aria-live]').textContent,/YouTube.*1\\/2/);
    assert.deepEqual(errors,[]);
    assert.equal(w.qaCalls.length,0);
''')
print('Shared card changes applied. Database and listing form logic unchanged.')
