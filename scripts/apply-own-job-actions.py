from pathlib import Path
import json

def once(s, old, new):
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one anchor, got {count}: {old[:100]}')
    return s.replace(old, new, 1)

def between(s, start, end, replacement):
    if s.count(start) != 1 or s.count(end) != 1:
        raise RuntimeError(f'Ambiguous section: {start[:60]}')
    a, b = s.index(start), s.index(end)
    if b <= a: raise RuntimeError('Section order changed')
    return s[:a] + replacement + s[b:]

p = Path('src/components/FarmerDashboard.jsx')
s = p.read_text()
s = once(s, 'import { OwnJobTile, ownJobState, ownJobPhoto, OWN_JOB_GRID_CLASS } from "./OwnJobTile";', 'import { OwnJobTile, ownJobState, ownJobPhoto, OWN_JOB_GRID_CLASS } from "./OwnJobTile";\nimport { OwnJobActionBar } from "./OwnJobActionBar";\nimport { useOwnJobSelection } from "../hooks/useOwnJobSelection.js";')
s = between(s, '  // ── 求人の操作ピル', '  const runJobAction = async (kind, num) => {', '  // Operations keep the existing owner-scoped APIs; the selected target is captured before execution.\n')
start = s.index('  const runJobAction = async (kind, num) => {')
end = s.index('  // ピルのタップ＝モード', start)
block = s[start:end]
block = block.replace('onResume(num); return;', 'onResume(num); return true;')
block = block.replace(')) return;', ')) return false;')
block = block.replace('; return; }', '; return false; }')
block = block.replace('      return;\n', '      return true;\n')
block = once(block, 'await copyJobToEdit(num);', 'return (await copyJobToEdit(num))?.ok === true;')
block = once(block, '"この求人（下書き）を削除しますか？元に戻せません"', '`求人 #${num}（下書き）を削除しますか？元に戻せません`')
block = once(block, '"この求人を一時非公開にしますか？（さがすに表示されなくなります。作業が始まっていない応募（応募中・面接中・採用済み）は見送りになります。あとから再掲載できます）"', '`求人 #${num} を一時非公開にしますか？（さがすに表示されなくなります。作業が始まっていない応募（応募中・面接中・採用済み）は見送りになります。あとから再掲載できます）`')
s = s[:start] + block + s[end:]
s = between(s, '  // ピルのタップ＝モード', '  // 「公開間近」（＝掲載申請済み', '''  const { selectedJob, actions: selectedJobActions, busy: jobActionBusy, error: jobActionError,
    selectJob, clearSelection, runSelectedAction } = useOwnJobSelection({
    rows: jobTab === "draft" ? dbDrafts : jobTab === "active" ? dbActive : jobTab === "expired" ? dbExpired : [],
    scope: jobTab, ownerId: me?.id, enabled: isOwnJobsTab, isEnded: isJobEnded, runAction: runJobAction,
  });
''')
s = once(s, 'actionLabel={armedAction ? ARMED_LABEL[armedAction] : resume ? "続きを入力" : undefined}', 'actionLabel={resume ? "続きを入力" : undefined}\n        selected={selectedJob?.job_number === d.job_number}\n        onActions={origin => selectJob(d.job_number, origin)}')
s = between(s, '        onOpen={() => armedAction ? handleArmedCardTap(d)', '        badge={qn > 0 ? (', '''        onOpen={() => {
          if (selectedJob) { clearSelection(); return; }
          if (nearPublish) setNearPublishInfo(true);
          else if (resume) onResume(d.job_number);
          else setPreviewJob({ num: d.job_number, draft: d.status === "draft", open: d.status === "open", published: !!d.opened_at });
        }}
''')
s = between(s, '      {/* ── 求人の操作ピル', '      {/* 「公開間近」の説明ボックス', '''      {/* The action bar is scoped to one currently visible job, never a global action mode. */}
      {isOwnJobsTab && selectedJob && (
        <OwnJobActionBar key={selectedJob.job_number} job={selectedJob} actions={selectedJobActions}
          busy={jobActionBusy} error={jobActionError} onAction={runSelectedAction} onClose={clearSelection} />
      )}

''')
s = once(s, '下書きを選ぶと、保存したところから再開できます。', 'タップで再開、長押しでコピー・削除などの操作ができます。')
s = once(s, '// 下書きはカードから直接再開。公開中は従来のプレビュー、操作モード中は選んだ操作を実行。', '// 通常タップは従来どおり。長押しは1件の選択だけを行い、操作は専用バーから実行する。')
assert 'armedAction' not in s and 'armJobAction' not in s and 'handleArmedCardTap' not in s
p.write_text(s)

p = Path('src/components/OwnJobTile.jsx')
s = p.read_text()
s = once(s, 'import { Avatar } from "./ui";', 'import { Avatar } from "./ui";\nimport { useJobCardPress } from "../hooks/useJobCardPress.js";\nimport "./OwnJobActions.css";')
s = once(s, 'dataGuide, actionLabel, actionHint, justSaved }) {', 'dataGuide, actionLabel, actionHint, justSaved, selected = false, onActions }) {\n  const press = useJobCardPress(onActions);')
s = once(s, '    <div role="button" tabIndex={0} onClick={onOpen} data-guide={dataGuide}', '''    <div className="cb-own-job-tile" data-own-job-number={jobNumber} data-selected={selected ? "true" : "false"}>
    <div {...press} role="button" tabIndex={0} onClick={onOpen} data-guide={dataGuide} data-job-card-main
      aria-expanded={onActions ? selected : undefined} aria-controls={selected ? "own-job-actions" : undefined}''')
s = once(s, 'onKeyDown={e => { if (e.key === "Enter"', 'onKeyDown={e => { if (press.onKeyDown(e)) return; if (e.key === "Enter"')
s = once(s, 'className="cb-btn-press" style={{ cursor: "pointer", minWidth: 0 }}>', 'className="cb-btn-press" style={{ cursor: "pointer", minWidth: 0, touchAction: onActions ? "pan-y pinch-zoom" : undefined, userSelect: onActions ? "none" : undefined, WebkitUserSelect: onActions ? "none" : undefined, WebkitTouchCallout: onActions ? "none" : undefined }}>')
s = once(s, '<div style={{ position: "relative", aspectRatio: "20 / 19"', '<div className="cb-own-job-photo" style={{ position: "relative", aspectRatio: "20 / 19"')
s = once(s, '<img src={photo} alt=""', '<img src={photo} alt="" draggable={false}')
s = once(s, '        {badge}\n', '        {badge}\n        {selected && <span className="cb-own-job-selected" aria-hidden="true">選択中</span>}\n')
s = once(s, '    </div>\n  );\n}\n', '''    </div>
    {onActions && <button type="button" className="cb-own-job-more" style={{ top: badge ? 48 : 10 }}
      aria-label={`求人 #${jobNumber} の操作を開く`} aria-expanded={selected} aria-controls={selected ? "own-job-actions" : undefined}
      onClick={event => { event.stopPropagation(); onActions(event.currentTarget); }}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
    </button>}
    </div>
  );
}
''')
p.write_text(s)

p = Path('package.json')
s = p.read_text()
old = json.loads(s)['scripts']['test:critical']
s = once(s, json.dumps(old), json.dumps(old + ' scripts/own-job-actions.test.mjs'))
p.write_text(s)
print('Patched FarmerDashboard, OwnJobTile and test:critical with unique-anchor checks.')
