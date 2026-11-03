import { useEffect, useRef, useState } from 'react';
import { WorkplacePhoto } from './WorkplacePhoto.jsx';
import { validateWorkplaceImage } from '../lib/workplaceImage.js';

const buttonStyle = { minHeight: 44, padding: '10px 14px', border: '1px solid #DDD', background: '#fff', borderRadius: 8, cursor: 'pointer', color: '#222' };
const photoStyle = { width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', background: '#F7F7F7', borderRadius: 8 };

// Controller and server own auth and persistence. Default to read-only.
export function WorkplaceEditPage({ onBack, canEdit = false, status = 'unconfigured', busy = false, error = '', warning = '', draftPhotos = [], publishedPhotos = [], onAdd, onRemove, onPublish, onUnpublish, onRetry, savedPhotos = [], libraryLimit = 24, libraryBytesLimit = 125829120, onReuse, onDeleteSaved }) {
  const [selection, setSelection] = useState(null);
  const [localError, setLocalError] = useState('');
  const [publicWeb, setPublicWeb] = useState(false);
  const [people, setPeople] = useState(false);
  const [working, setWorking] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const actionLock = useRef(false);
  const input = useRef(null);
  const draftKey = draftPhotos.map(photo => `${photo.id}:${photo.path}`).join('|');
  const usedIds = new Set([...draftPhotos, ...publishedPhotos].map(photo => photo.id));
  const knownBytes = savedPhotos.every(photo => Number.isFinite(photo.size) && photo.size >= 0);
  const libraryBytes = savedPhotos.reduce((total, photo) => total + (Number.isFinite(photo.size) ? photo.size : 0), 0);
  const libraryFull = savedPhotos.length >= libraryLimit || (knownBytes && libraryBytes >= libraryBytesLimit);
  const deletable = deleteId && savedPhotos.some(photo => photo.id === deleteId) && !usedIds.has(deleteId);
  const disabled = !canEdit || status !== 'ready' || busy || working;
  useEffect(() => { setPublicWeb(false); setPeople(false); }, [draftKey, canEdit]);
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url); }, [selection]);
  useEffect(() => { if (!canEdit) setSelection(null); }, [canEdit]);
  useEffect(() => { if (status === 'loading') setLocalError(''); }, [status]);
  useEffect(() => { if (!canEdit || !deletable) setDeleteId(null); }, [canEdit, deletable]);
  const run = async action => {
    if (disabled || actionLock.current || !action) return;
    actionLock.current = true; setWorking(true); setLocalError('');
    try { await action(); }
    catch (failure) { setLocalError(failure?.message || '操作を完了できませんでした。内容を確認して、もう一度お試しください。'); }
    finally { actionLock.current = false; setWorking(false); }
  };
  const select = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled || draftPhotos.length >= 6) return;
    try { validateWorkplaceImage(file); setLocalError(''); setSelection({ file, url: URL.createObjectURL(file) }); }
    catch (failure) { setLocalError(failure.message); }
  };
  return <section className="f-sans workplace-edit-page" aria-labelledby="workplace-edit-title" style={{ maxWidth: 760, margin: '0 auto', padding: '20px 0 96px', color: '#222' }}>
    <button type="button" onClick={onBack} style={buttonStyle}>← プロフィール編集に戻る</button>
    <h1 id="workplace-edit-title" style={{ fontSize: 24, margin: '28px 0 16px' }}>職場紹介の編集</h1>
    <p style={{ lineHeight: 1.8 }}>作業中の様子、一緒に働く人、休憩の雰囲気などがあると、応募する人が働く姿をイメージしやすくなります。</p>
    <p style={{ lineHeight: 1.8 }}>求人の写真とは別に、募集主の職場紹介として共通で使う写真です。最大6枚。分類や説明文の入力は必要ありません。</p>
    {status === 'unconfigured' && <p role="status" style={{ padding: 16, background: '#F7F7F7', borderRadius: 12, lineHeight: 1.8 }}>独立した保存先と公開方法を準備しています。現在、このページでは写真の選択・アップロード・保存・公開はできません。</p>}
    {status === 'loading' && <p role="status">職場紹介を読み込んでいます…</p>}
    {(error || localError) && <p role="alert" style={{ color: '#B42318', lineHeight: 1.8 }}>{error || localError}</p>}
    {status === 'error' && !error && !localError && <p role="alert">職場紹介を読み込めないか、編集する権限を確認できません。ログイン状態を確認して、もう一度お試しください。</p>}
    {status === 'ready' && !canEdit && <p role="status">この職場紹介を編集する権限を確認できません。</p>}
    {status === 'error' && onRetry && <button type="button" disabled={busy || working} onClick={onRetry} style={buttonStyle}>もう一度読み込む</button>}
    {warning && <p role="status" style={{ lineHeight: 1.8 }}>{warning}</p>}

    <h2 style={{ fontSize: 20, marginTop: 28 }}>下書きの写真</h2>
    <p style={{ lineHeight: 1.8 }}>下書きに追加しただけでは公開されません。公開中の写真は「この内容で公開する」を押すまで変わりません。</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
      {draftPhotos.map((photo, index) => <figure key={photo.id} style={{ margin: 0 }}>
        <WorkplacePhoto path={photo.path} alt={`下書きの写真 ${index + 1}`} style={photoStyle} />
        <button type="button" disabled={disabled || !onRemove} onClick={() => run(() => onRemove(photo.id))} style={buttonStyle}>下書きから写真{index + 1}を外す</button>
      </figure>)}
    </div>
    {status === 'ready' && !draftPhotos.length && <p>下書きの写真はまだありません。</p>}
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={select} disabled={disabled || draftPhotos.length >= 6 || !onAdd} aria-label="職場紹介の写真を選ぶ" style={{ display: 'none' }} />
    <button type="button" disabled={disabled || draftPhotos.length >= 6 || !onAdd} onClick={() => input.current?.click()} style={{ ...buttonStyle, marginTop: 16 }}>写真を選ぶ（{draftPhotos.length}/6枚）</button>
    <p style={{ color: '#717171', fontSize: 13 }}>JPEG・PNG・WebP、1枚5MB以内。この編集画面では写真を再変換し、位置情報などの元の画像メタデータを除いて保存します。</p>
    <p style={{ color: '#717171', fontSize: 13, lineHeight: 1.7 }}>写真を下書きから外したり公開を取り下げたりしても、保存ファイル自体は削除しません。未使用の写真は「保存済みの写真」から完全に削除できます。</p>

    {selection && <section aria-label="選んだ写真の確認" style={{ padding: '20px 0', borderTop: '1px solid #DDD', borderBottom: '1px solid #DDD' }}>
      <h3>下書きに追加する前に確認</h3>
      <img src={selection.url} alt="選んだ写真（まだ保存していません）" style={photoStyle} />
      <p style={{ lineHeight: 1.8 }}>まだ保存していません。番地・集合場所・車のナンバー・書類など、非公開情報が写っていないか確認してください。</p>
      <button type="button" disabled={disabled || draftPhotos.length >= 6 || !onAdd} onClick={() => run(async () => { await onAdd(selection.file); setSelection(null); })} style={buttonStyle}>この写真を下書きに追加</button>{' '}
      <button type="button" disabled={busy || working} onClick={() => setSelection(null)} style={buttonStyle}>選択を取り消す</button>
    </section>}

    <section aria-labelledby="workplace-library-title" style={{ marginTop: 28, borderTop: '1px solid #DDD', paddingTop: 20 }}>
      <h2 id="workplace-library-title" style={{ fontSize: 20 }}>保存済みの写真</h2>
      <p style={{ lineHeight: 1.8 }}>以前に保存した写真を、もう一度下書きに追加できます。下書き・公開中のどちらにも使っていない写真だけ、保存先から完全に削除できます。</p>
      {status === 'ready' && <p>{savedPhotos.length}/{libraryLimit}枚{knownBytes ? `・${(libraryBytes / 1048576).toFixed(1)}/${Math.round(libraryBytesLimit / 1048576)}MiB` : ''}</p>}
      {libraryFull && <p role="status">保存できる上限に達しています。新しい写真を追加するには、未使用の写真を削除して空きを作ってください。アップロード未確認の同じ写真は、選び直して再試行できます。保存済みの写真は引き続き下書きに追加できます。</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {savedPhotos.map((photo, index) => {
          const photoState = photo.state;
          const ready = photoState === 'ready';
          const inDraft = draftPhotos.some(item => item.id === photo.id);
          const inPublished = publishedPhotos.some(item => item.id === photo.id);
          const inUse = inDraft || inPublished;
          return <figure key={photo.id} data-saved-photo-id={photo.id} style={{ margin: 0 }}>
            {ready ? <WorkplacePhoto path={photo.path} alt={`保存済みの写真 ${index + 1}`} style={photoStyle} /> : <p role="status" style={{ padding: 16, background: '#F7F7F7', lineHeight: 1.8 }}>{photoState === 'pending' ? 'アップロード未確認。同じ写真を選び直して再試行してください。' : photoState === 'deleting' ? '削除を完了できていません。削除を再試行してください。' : '保存状態を確認できません。もう一度読み込んでください。'}</p>}
            <figcaption style={{ margin: '8px 0', lineHeight: 1.7 }}>{inDraft ? '下書きで使用中' : ''}{inDraft && inPublished ? '・' : ''}{inPublished ? '公開中の写真で使用中' : ''}{!inUse ? '未使用' : ''}</figcaption>
            <button type="button" disabled={disabled || !ready || inDraft || draftPhotos.length >= 6 || !onReuse} onClick={() => run(() => onReuse(photo.id))} style={buttonStyle}>保存済み写真{index + 1}を下書きに追加</button>{' '}
            <button type="button" disabled={disabled || inUse || !onDeleteSaved} onClick={() => setDeleteId(photo.id)} style={buttonStyle}>保存済み写真{index + 1}を削除</button>
            {deleteId === photo.id && !inUse && <div role="group" aria-label={`保存済み写真${index + 1}の完全削除の確認`} style={{ marginTop: 12, padding: 12, border: '1px solid #B42318', borderRadius: 8 }}>
              <p style={{ lineHeight: 1.8 }}>この写真を保存先から完全に削除します。この操作は取り消せません。</p>
              <button type="button" disabled={disabled || !onDeleteSaved || !deletable} onClick={() => run(async () => { await onDeleteSaved(photo.id); setDeleteId(null); })} style={{ ...buttonStyle, color: '#B42318' }}>完全に削除する</button>{' '}
              <button type="button" disabled={busy || working} onClick={() => setDeleteId(null)} style={buttonStyle}>削除をやめる</button>
            </div>}
          </figure>;
        })}
      </div>
      {status === 'ready' && !savedPhotos.length && <p>保存済みの写真はまだありません。</p>}
    </section>

    <section style={{ marginTop: 28, borderTop: '1px solid #DDD', paddingTop: 20 }}>
      <h2 style={{ fontSize: 20 }}>公開前の確認</h2>
      <p style={{ lineHeight: 1.8 }}>公開中の求人の職場紹介ページでは、ログインしていない人も写真を閲覧できます。公開を取り下げても、すでに保存・共有された写真を回収することはできません。</p>
      <label style={{ display: 'block', padding: '10px 0', lineHeight: 1.8 }}><input type="checkbox" checked={publicWeb} disabled={disabled} onChange={event => setPublicWeb(event.target.checked)} /> この下書きの写真をウェブ上で一般公開することに同意します。</label>
      <label style={{ display: 'block', padding: '10px 0', lineHeight: 1.8 }}><input type="checkbox" checked={people} disabled={disabled} onChange={event => setPeople(event.target.checked)} /> 写真の掲載権限があります。人物が写っている場合は、全員からWeb掲載の同意を得ています。</label>
      <button type="button" disabled={disabled || !!selection || !draftPhotos.length || !publicWeb || !people || !onPublish} onClick={() => run(async () => { await onPublish({ publicWeb, people }); setPublicWeb(false); setPeople(false); })} style={buttonStyle}>この内容で公開する</button>
    </section>

    <section style={{ marginTop: 28, borderTop: '1px solid #DDD', paddingTop: 20 }}>
      <h2 style={{ fontSize: 20 }}>公開中の写真</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {publishedPhotos.map((photo, index) => <WorkplacePhoto key={photo.id} path={photo.path} alt={`公開中の写真 ${index + 1}`} style={photoStyle} />)}
      </div>
      {status === 'ready' && !publishedPhotos.length && <p>現在、公開していません。</p>}
      <button type="button" disabled={disabled || !publishedPhotos.length || !onUnpublish} onClick={() => run(onUnpublish)} style={{ ...buttonStyle, marginTop: 16 }}>公開を取り下げる</button>
    </section>
  </section>;
}
