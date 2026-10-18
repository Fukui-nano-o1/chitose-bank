import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// 各プロセスの実際のタイムゾーンで検査する。日付境界・夏時間・旧下書きも含める。
for (const zone of ['Asia/Tokyo', 'UTC', 'Etc/GMT+3', 'America/New_York', 'Pacific/Kiritimati']) {
  test(`calendar dates survive save/restore in ${zone}`, () => {
    const moduleUrl = new URL('../src/lib/calendarDate.js', import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import {calendarDateFromYmd as read, calendarDateToYmd as write, restoreDraftCalendarDate as restore} from ${JSON.stringify(moduleUrl)};
      for (const day of ['2026-01-01','2026-03-08','2026-11-01','2026-12-01','2026-12-31','2028-02-29']) {
        const date = read(day);
        assert.ok(date instanceof Date, day);
        assert.equal(write(date), day);
        assert.equal(write(restore(JSON.parse(JSON.stringify(write(date))))), day);
      }
      for (const invalid of [null,undefined,'','2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-12-00','2026-1-1','2026-12-01T00:00:00Z']) {
        assert.equal(read(invalid), null, String(invalid));
      }
      assert.equal(write(null), null);
      assert.equal(write(new Date('invalid')), null);
      // 旧ISOは同時保存のpayloadを使い、端末の時差が変わっても元の日を維持。
      assert.equal(write(restore('2026-11-30T15:00:00.000Z','2026-12-01')), '2026-12-01');
      assert.equal(write(restore('2026-12-05T00:00:00Z','2026-12-05')), '2026-12-05');
      // 現行フォームの変更・明示的な未入力を古い送信値で上書きしない。
      assert.equal(write(restore('2026-12-03','2026-12-01')), '2026-12-03');
      assert.equal(restore(null,'2026-12-01'), null);
      assert.equal(restore('2026-02-30','2026-12-01'), null);
      assert.equal(restore('invalid','2026-12-01'), null);
      // payloadの無い旧匿名下書きは従来の時刻解釈を維持し、推測で日付を動かさない。
      assert.equal(restore('2026-11-30T15:00:00.000Z').getTime(), Date.parse('2026-11-30T15:00:00.000Z'));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
}
