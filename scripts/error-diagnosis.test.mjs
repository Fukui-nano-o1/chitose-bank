import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseError, browserLabel, errorCategoryKey, errorSignature, groupAppErrors, buildErrorReport, explainError } from '../src/lib/errorCatalog.js';

// Technical fields only; no production user/session identifiers.
const sample = {
  id: 'translation', message: 'La', source: 'unhandledrejection', component: 'global',
  action: 'promise_rejection', status: 'open', identity_verified: true,
  created_at: '2026-10-27T12:44:19Z', url: 'https://www.chitose-bank.com/#/search',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/151.0.7922.57 Mobile/15E148 Safari/604.1',
  stack: '@https://www.chitose-bank.com/:518:344\nLi@https://www.chitose-bank.com/:196:221\n@https://www.chitose-bank.com/:197:338',
};
test('the recorded three-frame fingerprint identifies the Google translation handler, without claiming why the network failed or that the page stopped', () => {
  const d = diagnoseError(sample);
  assert.equal(d.key, 'chrome_ios_translate_request');
  assert.equal(d.category, 'browser');
  assert.match(d.confidence, /コード照合済み/);
  assert.match(d.origin, /Google翻訳/);
  assert.match(d.cause, /通信失敗の詳細.*確認できません/);
  assert.equal(d.impact, '画面の表示停止は確認できません');
  assert.match(d.reference, /^https:\/\/translate.googleapis.com\//);
});
test('La alone, another browser, another script, wrong frame name and altered coordinates cannot be promoted to a matched cause', () => {
  for (const changed of [
    { stack: '' }, { user_agent: 'Mozilla/5.0 (iPhone) Version/27.0 Safari/604.1' },
    { user_agent: 'Mozilla/5.0 Chrome/151.0' }, { url: 'invalid' },
    { stack: sample.stack.replaceAll('chitose-bank.com/', 'chitose-bank.com/assets/app.js') },
    { stack: sample.stack.replace('Li@', 'saveApplication@') },
    { stack: sample.stack.replace('518:344', '519:344') },
    { stack: sample.stack + '\n@https://www.chitose-bank.com/:200:1' },
    { source: 'error_boundary' }, { message: 'la' },
  ]) assert.notEqual(diagnoseError({ ...sample, ...changed }).key, 'chrome_ios_translate_request', JSON.stringify(changed));
  const candidate = diagnoseError({ ...sample, stack: sample.stack.replace('518:344', '519:344') });
  assert.equal(candidate.key, 'chrome_ios_translate_candidate');
  assert.match(candidate.confidence, /未確定/);
});
test('failure classes and observed rendering impact remain separate, including missing and numeric codes', () => {
  const rows = [
    [{ source: 'error_boundary', message: 'Unexpected error' }, 'render'],
    [{ source: 'window.onerror', message: 'x is not a function' }, 'runtime'],
    [{ source: 'unhandledrejection', message: 'Rejected' }, 'async'],
    [{ message: 'Unexpected failure', error_code: 500 }, 'other'],
    [{ message: 'Unable to preload CSS for /assets/view.css', source: 'unhandledrejection' }, 'deploy'],
    [{ message: 'Failed to fetch dynamically imported module' }, 'deploy'],
    [{ message: 'Failed to fetch' }, 'network'],
    [{ error_code: 42501 }, 'db'], [{ error_code: '23505' }, 'db'], [{ error_code: '57014' }, 'db'],
    [{ component: 'LoginScreen', message: 'otp_disabled' }, 'auth'],
    [{ message: 'Rejected', stack: 'serviceWorker.register\nhttps://example.test/registerSW.js:1:98' }, 'browser'],
  ];
  for (const [row, expected] of rows) assert.equal(errorCategoryKey(row), expected, JSON.stringify(row));
  const renderResource = diagnoseError({ source: 'error_boundary', message: 'Unable to preload CSS for /assets/view.css' });
  assert.equal(renderResource.category, 'render');
  assert.equal(renderResource.key, 'css_resource');
  assert.match(renderResource.impact, /描画失敗を検知/);
  assert.match(diagnoseError({ source: 'window.onerror', message: 'RangeError' }).impact, /確認できません/);
});
test('a matched translation error and unrelated La errors are not grouped or bulk-resolved together; database notification signatures stay compatible', () => {
  const unrelated = { ...sample, id: 'application', stack: 'save@https://www.chitose-bank.com/assets/app.js:1:1' };
  const candidate = { ...sample, id: 'candidate', stack: sample.stack.replace('518:344', '519:344') };
  assert.equal(errorSignature(sample), errorSignature(unrelated));
  assert.equal(errorSignature(sample), 'global|unhandledrejection|La');
  const groups = groupAppErrors([sample, unrelated, candidate]).flatMap(c => c.groups);
  assert.equal(groups.length, 3);
  for (const group of groups) assert.equal(group.openIds.length, 1);
  assert.equal(new Set(groups.map(g => g.sig)).size, 3);
});
test('report contains the same diagnosis, browser version and action as the card; no user/session identifiers', () => {
  const row = { ...sample, user_id: 'PRIVATE-USER', session_id: 'PRIVATE-SESSION' };
  const group = groupAppErrors([row])[0].groups[0];
  const report = buildErrorReport(group, '端末・ブラウザ機能', explainError(row), row.stack);
  for (const text of ['Chrome翻訳の通信処理失敗', 'コード照合済み', 'Chrome（iOS） 151.0.7922.57', '表示への影響: 画面の表示停止は確認できません', '操作=promise_rejection', '518:344']) assert.ok(report.includes(text), text);
  assert.doesNotMatch(report, /PRIVATE-USER|PRIVATE-SESSION/);
  assert.match(browserLabel('Mozilla/5.0 (iPhone) FxiOS/140.1 Mobile Safari/604.1'), /Firefox（iOS） 140.1/);
  assert.equal(browserLabel(''), '未記録');
});
test('all records remain visible and unrelated Rejected still has an honest, actionable explanation', () => {
  const rows = [{ ...sample, id: 'older', status: 'fixed', created_at: '2026-10-26T00:00:00Z' }, sample];
  const group = groupAppErrors(rows)[0].groups[0];
  assert.equal(group.latest.id, sample.id);
  assert.deepEqual(group.openIds, ['translation']);
  assert.equal(group.rows.length, 2);
  const unknown = explainError({ message: 'Rejected', source: 'unhandledrejection' });
  assert.match(unknown.title, /原因未特定/);
  assert.match(unknown.action, /除外しない/);
});

test('resize delivery has an exact dedicated classification, never suppresses records or claims a crash', async () => {
  const { buildErrorDetails } = await import('../src/lib/errorDiagnosis.js');
  for (const message of ['ResizeObserver loop completed with undelivered notifications.', 'ResizeObserver loop limit exceeded']) {
    const row = { ...sample, message, source: 'window.onerror', stack: '' };
    const d = diagnoseError(row);
    assert.equal(d.key, 'resize_observer_delivery');
    assert.equal(d.category, 'browser');
    assert.match(d.confidence, /原因は未特定/);
    assert.equal(explainError(row).key, d.key);
    assert.equal(groupAppErrors([row])[0].groups[0].rows.length, 1);
    const details = buildErrorDetails(row);
    assert.equal(details.sections.length, 5);
    assert.equal(details.checks.length, 5);
    assert.equal(details.checks[1].status, '情報不足');
    assert.equal(details.checks[2].status, '未確認');
    assert.match(details.summary, /確定ではなく/);
    assert.match(details.sections[4].items.join(' '), /履歴ではありません/);
  }
  for (const changed of [{ source: 'error_boundary' }, { message: 'ResizeObserver crashed' }, { message: 'Other: ResizeObserver loop limit exceeded' }]) {
    assert.notEqual(diagnoseError({ source: 'window.onerror', message: 'ResizeObserver loop limit exceeded', ...changed }).key, 'resize_observer_delivery');
  }
});

test('details distinguish operator records and admin resolution from independently verified recovery', async () => {
  const { buildErrorDetails } = await import('../src/lib/errorDiagnosis.js');
  const d = buildErrorDetails({ message: 'unknown', status: 'fixed', admin_note: '端末回転で確認。', resolved_at: '2026-11-06T00:00:00Z', metadata: { recovered: true, cause: 'PROVEN' } });
  assert.match(d.sections[4].items.join(' '), /運営者の記録.*端末回転で確認/);
  assert.match(d.sections[4].items.join(' '), /独立に確認することはできません/);
  assert.doesNotMatch(JSON.stringify(d), /PROVEN/);
  assert.equal(d.checks[4].status, '管理上は解決済み');
});

test('technical reports redact credentials, query values, emails and identifiers without altering original evidence', async () => {
  const { safeErrorText } = await import('../src/lib/errorDisplay.js');
  const secrets = ['private@example.com', 'SECRET_QUERY', 'SECRET_TOKEN', 'SECRET_PASSWORD', '12345678-1234-1234-1234-123456789abc'];
  const text = 'private@example.com https://example.com/app.js?key=SECRET_QUERY#access_token=SECRET_TOKEN password=SECRET_PASSWORD 12345678-1234-1234-1234-123456789abc';
  const safe = safeErrorText(text);
  for (const secret of secrets) assert.ok(!safe.includes(secret), secret);
  assert.match(safe, /example.com\/app.js/);
  const row = { ...sample, message: text, admin_note: text, stack: `save@https://example.com/app.js?token=SECRET_QUERY:1:2`, user_id: 'PRIVATE-USER', session_id: 'PRIVATE-SESSION' };
  const group = groupAppErrors([row])[0].groups[0];
  const report = buildErrorReport(group, 'Other', explainError(row), row.stack);
  for (const secret of [...secrets, 'PRIVATE-USER', 'PRIVATE-SESSION']) assert.ok(!report.includes(secret), secret);
  assert.equal(row.message, text);
});

test('common runtime exceptions get plain-language subtypes without asserting a root cause', () => {
  for (const [message, key] of [['x is not a function', 'runtime_not_callable'], ["Can't find variable: x", 'runtime_missing_reference'], ["Cannot read properties of undefined (reading 'x')", 'runtime_empty_value'], ['Rendered more hooks than during the previous render.', 'react_hook_order']]) {
    const d = diagnoseError({ message, source: 'window.onerror' });
    assert.equal(d.key, key);
    assert.equal(d.category, 'runtime');
    assert.match(d.impact, /確認できません/);
    assert.match(d.cause, /未特定|未確認/);
  }
});

test('relative routes and JSON credential forms are masked throughout detailed reports', async () => {
  const { safeErrorText } = await import('../src/lib/errorDisplay.js');
  const raw = '/profile?code=secretcode&name=PrivatePerson {"access_token":"secret-access","password":"secret password","refresh_token":"escaped\\\"private"} #/search?query=PrivateQuery';
  const safe = safeErrorText(raw);
  for (const secret of ['secretcode', 'PrivatePerson', 'secret-access', 'secret password', 'escaped', 'private', 'PrivateQuery']) assert.ok(!safe.includes(secret), secret);
  assert.match(safe, /\/profile\?\[非表示\]/);
  const row = { ...sample, message: raw, page: '/profile?code=secretcode&name=PrivatePerson', admin_note: raw, stack: raw };
  const group = groupAppErrors([row])[0].groups[0];
  const report = buildErrorReport(group, '分類', explainError(row), row.stack);
  for (const secret of ['secretcode', 'PrivatePerson', 'secret-access', 'secret password', 'PrivateQuery']) assert.ok(!report.includes(secret), secret);
});

test('report title always matches canonical classification even when legacy explanations differ', () => {
  for (const message of ['Script error.', "undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')"]) {
    const row = { ...sample, message, source: 'window.onerror', stack: '' };
    const group = groupAppErrors([row])[0].groups[0];
    const d = diagnoseError(row);
    const report = buildErrorReport(group, '分類', { title: 'LEGACY_UNSUPPORTED_CAUSE', cause: 'LEGACY_UNSUPPORTED_CAUSE', action: '' }, '');
    assert.ok(report.includes(`■ 種類: ${d.title}\n`));
    assert.ok(report.includes(`■ 細分類: ${d.title}\n`));
    assert.doesNotMatch(report, /LEGACY_UNSUPPORTED_CAUSE/);
  }
});
