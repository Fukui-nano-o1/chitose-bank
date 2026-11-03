import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { WorkplaceEditPage } from './WorkplaceEditPage.jsx';
import { readWorkplaceRecord, readWorkplaceLibrary, reuseWorkplacePhoto, deleteWorkplacePhoto, addWorkplacePhoto, saveWorkplacePhotos, publishWorkplace, unpublishWorkplace } from '../lib/workplaceRecord.js';

export function WorkplaceEditor({ me, onBack }) {
  const [record, setRecord] = useState(null);
  const [library, setLibrary] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0), lock = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setRecord(null); setLibrary([]); setStatus('loading'); setError(''); setWarning(''); setBusy(false); lock.current = false;
    Promise.all([readWorkplaceRecord(supabase, me?.id), readWorkplaceLibrary(supabase, me?.id)]).then(([row, photos]) => {
      if (generation.current === current) { setRecord(row); setLibrary(photos); setStatus('ready'); }
    }).catch(failure => {
      if (generation.current === current) { setError(failure.message); setStatus(failure.code === 'UNCONFIGURED' ? 'unconfigured' : 'error'); }
    });
    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user?.id || null) !== (me?.id || null) && generation.current === current) {
        generation.current++; setRecord(null); setLibrary([]); setStatus('error'); setError('ログイン中のアカウントが変わりました。ページを開き直してください。'); setBusy(false);
      }
    });
    return () => { generation.current = current + 1; subscription?.data?.subscription?.unsubscribe(); };
  }, [me?.id, attempt]);
  const run = async (operation, message) => {
    if (lock.current || status !== 'ready' || !record || record.owner_id !== me?.id) throw new Error('保存済みの内容を読み込んでから操作してください。');
    lock.current = true; setBusy(true); setError(''); setWarning('');
    const current = generation.current, previous = record;
    try {
      const next = await operation(previous);
      if (current !== generation.current) throw new Error('アカウントまたは画面が変わりました。保存結果は再度読み込んで確認してください。');
      const photos = await readWorkplaceLibrary(supabase, previous.owner_id);
      if (current !== generation.current) throw new Error('アカウントまたは画面が変わりました。保存結果は再度読み込んで確認してください。');
      setRecord(next); setLibrary(photos);
      if (current === generation.current) setWarning(message);
      return next;
    } catch (failure) {
      if (current === generation.current) {
        try {
          const photos = await readWorkplaceLibrary(supabase, previous.owner_id);
          if (current === generation.current) setLibrary(photos);
        } catch { if (current === generation.current) { setRecord(null); setLibrary([]); setStatus('error'); } }
        if (current !== generation.current) throw failure;
        setError(failure.message);
        if (['CONFLICT', 'UNCONFIRMED', 'SESSION', 'LIBRARY', 'IN_USE'].includes(failure.code)) { setRecord(null); setStatus('error'); }
      }
      throw failure;
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  };
  const ownedRecord = record?.owner_id === me?.id ? record : null;
  const shownStatus = record && !ownedRecord ? 'loading' : status;
  return <WorkplaceEditPage key={me?.id || 'anon'} onBack={onBack}
    canEdit={!!ownedRecord && shownStatus === 'ready'} status={shownStatus} busy={busy} error={error} warning={warning}
    onRetry={() => setAttempt(n => n + 1)}
    savedPhotos={ownedRecord ? library : []}
    onReuse={id => run(row => reuseWorkplacePhoto(supabase, row, id), '保存済み写真を下書きに追加しました。')}
    onDeleteSaved={id => run(row => deleteWorkplacePhoto(supabase, row, id, { irreversible: true }), '保存済み写真の削除を完了しました。')}
    draftPhotos={ownedRecord?.draft_photos || []} publishedPhotos={ownedRecord?.publication_active ? ownedRecord.published_photos : []}
    onAdd={file => run(row => addWorkplacePhoto(supabase, row, file), '写真を非公開の下書きに保存しました。')}
    onRemove={id => run(row => saveWorkplacePhotos(supabase, row, row.draft_photos.filter(photo => photo.id !== id)), '写真を下書きから外しました。公開中の写真は変わりません。')}
    onPublish={consent => run(row => publishWorkplace(supabase, row, consent), '職場紹介の写真を公開しました。')}
    onUnpublish={() => run(row => unpublishWorkplace(supabase, row), '写真の公開を取り下げました。下書きは残しています。')} />;
}
