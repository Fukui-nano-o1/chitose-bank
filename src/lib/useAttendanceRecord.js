import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { attendanceKey, readAttendancePending, recordAttendance } from './attendanceRecord.js';

export function useAttendanceRecord({ owner, applicationId, day, mode, onRestore }) {
  const [loadedKey, setLoadedKey] = useState(null), [readError, setReadError] = useState('');
  const [retry, setRetry] = useState(0), [submitting, setSubmitting] = useState(false);
  const lock = useRef(false), restore = useRef(onRestore);
  restore.current = onRestore;
  const key = attendanceKey(owner, applicationId, day, mode), current = useRef(key);
  current.current = key;
  const ready = loadedKey === key;
  useEffect(() => {
    let cancelled = false;
    setLoadedKey(null); setReadError('');
    restore.current(null);
    if (applicationId && owner) readAttendancePending(supabase, owner, applicationId, day, mode).then(pending => {
      if (cancelled) return;
      restore.current(pending?.input || null); setLoadedKey(key);
    }, error => { if (!cancelled) setReadError(error.message); });
    return () => { cancelled = true; };
  }, [owner, applicationId, day, mode, retry, key]);
  const submit = async (input, onDone) => {
    if (!ready || lock.current) return;
    lock.current = true; setSubmitting(true);
    try {
      const result = await recordAttendance(supabase, owner, input, mode);
      if (current.current !== key) throw Error('入力画面が変わりました。元の記録画面で送信結果を確認してください。');
      if (result.changed) {
        await result.acknowledge();
        alert('前回送信した内容の保存を確認しました。その後に変更した入力はまだ送信していません。必要ならもう一度送信してください。');
      } else {
        onDone(result.row.application_id);
        await result.acknowledge();
      }
    } catch (error) { alert(error.message || '送信結果を確認できません。入力は残しています。'); }
    finally { lock.current = false; setSubmitting(false); }
  };
  return { ready, readError, submitting, reload: () => setRetry(n => n + 1), submit };
}
