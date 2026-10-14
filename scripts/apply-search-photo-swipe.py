from pathlib import Path

def edit(path, old, new):
    p = Path(path)
    s = p.read_text()
    if s.count(old) != 1:
        raise RuntimeError(f'{path}: expected one anchor, got {s.count(old)}: {old[:90]}')
    p.write_text(s.replace(old, new, 1))

# Native ancestor listeners run before React's delegated stopPropagation.
# Leave media gestures to their own horizontal scroller, not the jobs/consign lane.
edit('src/components/JobSearchMapView.jsx',
     'ev.target.closest(".cb-lock-scroll, .cb-search-overlay")',
     'ev.target.closest(".cb-lock-scroll, .cb-search-overlay, .job-card-media-scroll")')
edit('src/components/JobSearchMapView.jsx',
     '<div ref={laneRootRef} style={{ overflowX:"hidden", touchAction:"pan-y" }}>',
     '<div ref={laneRootRef} style={{ overflowX:"hidden", touchAction:"pan-x pan-y pinch-zoom" }}>')
edit('src/components/JobSearchMapView.jsx',
     '// 始まったタッチは奪わない（パネル操作中に背後のレーンが切り替わる事故の防止）',
     '// 始まったタッチと写真カルーセルは奪わない。親のnative listenerはReactのstopPropagationより先に走る。')

edit('src/components/JobVideoCard.jsx',
     'onOpen, standalone = false }) {',
     'onOpen, standalone = false, swipeOnly = false }) {')
edit('src/components/JobVideoCard.jsx',
     '    {(count > 1 || hasVideo) && <div className="f-sans job-card-media-controls"',
     '    {!swipeOnly && (count > 1 || hasVideo) && <div className="f-sans job-card-media-controls"')
edit('src/components/JobVideoCard.jsx',
     '    {/* Controls never cover the YouTube player. Both media types remain discoverable. */}',
     '''    {/* Search photos use native swipe and keyboard navigation, without a visible counter/control row. */}
    {swipeOnly && count > 1 && <span className="job-card-media-status" role="status" aria-live="polite" aria-atomic="true">{mediaLabel} · {active + 1}/{count}</span>}
    {/* Controls never cover the YouTube player. Both media types remain discoverable. */}''')
edit('src/components/JobVideoCard.jsx',
     '      href={`#/work/job/${job.id}`} onOpen={onOpen} />',
     '      href={`#/work/job/${job.id}`} onOpen={onOpen} swipeOnly={videoPlacement === "below" && !videoId} />')

# Visually remove the count while preserving the current slide for screen readers.
p = Path('src/components/jobCardPhotoSummary.css')
p.write_text(p.read_text() + '''
/* Search photo count is assistive text only, never an extra row below the card. */
.job-card-media-status {
  position:absolute;
  width:1px;
  height:1px;
  padding:0;
  margin:-1px;
  overflow:hidden;
  clip:rect(0, 0, 0, 0);
  clip-path:inset(50%);
  white-space:nowrap;
  border:0;
}
.job-card-media-scroll::-webkit-scrollbar { display:none; }
''')

# Search is now swipe/keyboard-only; the other card/video variants keep their controls.
edit('scripts/job-video-facade.test.mjs',
     '''      card.querySelector('[aria-label="次の画像・動画"]').click();
      await until(()=>photos.scrollLeft===300,'search photo carousel still advances');''',
     '''      assert.equal(card.querySelector('.job-card-media-controls'),null,'search has no external arrows or visible photo counter');
      assert.equal(card.querySelector('[aria-label="次の画像・動画"]'),null);
      photos.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
      await until(()=>photos.scrollLeft===300,'search photo carousel still advances');''')

# Browser scrollTo changes geometry before the scroll event updates React state.
# Await both the snapped position and active slide before sending the next key.
edit('scripts/search-photo-swipe.browser.mjs',
     'return el && Math.abs(el.scrollLeft-el.clientWidth*index)<2;',
     'return el && Math.abs(el.scrollLeft-el.clientWidth*index)<2 && el.querySelectorAll(\'[data-media-type="photo"]\')[index]?.tabIndex===0;')
edit('scripts/search-photo-swipe.browser.mjs',
     "await strip(101).focus();await page.keyboard.press('Home');",
     "await strip(101).focus();")

p = Path('docs/search-photo-swipe-2026-10-14.md')
p.write_text('''# さがすページの写真スワイプ

変更日: 2026-10-14

複数写真の求人は写真上の左右スワイプで切り替える。さがすカード下の「写真1 · 1/4」などの数値と左右ボタンは表示しない。読み上げ用の現在位置とキーボードの左右キーは維持する。写真が1枚のカード、いいね、求人を開く通常タップ、下部の独立したYouTubeは既存の動作を維持する。

求人/委託を切り替える親のnative touch listenerから写真カルーセルを除外する。親のtouch-actionは横/縦スクロールとピンチを許可し、写真の横スクロールを妨げない。写真上の縦操作はページスクロールに譲る。

検証コマンド: `npm run build`、`node scripts/search-photo-swipe.browser.mjs`。追加ブラウザ試験は実際のJobSearchMapViewとJobCardを使用するが、サーバー通信は既存のテストクライアントに差し替え、実求人や認証情報は使用しない。Chromiumのタッチ入力で横/縦ジェスチャと求人/委託の競合を確認する。WebKitはレイアウト・イベント競合・キーボード・通常タップを検証する。iPhone実機の検証は別途必要。
''')
p = Path('PROGRESS.md')
s = p.read_text()
first, sep, rest = s.partition('\n')
p.write_text(first + sep + '\n## 2026-10-14 さがす写真の左右スワイプ\n\n- 求人/委託の親ジェスチャから写真カルーセルを除外し、横スクロールを許可。\n- さがすカード下の写真番号・枚数・左右ボタンを撤去。通常タップ、縦スクロール、他カード、YouTubeを維持。\n- 本番コードの変更はJobSearchMapView、JobVideoCard、写真概要CSSのみ。DB・認証・求人データは変更なし。\n- 検証: criticalテスト/ESLint/本番ビルドと実検索コンポーネントのブラウザ試験。実機iPhoneは未確認。\n\n' + rest)
print('Applied scoped search-photo changes with unique-anchor checks.')
