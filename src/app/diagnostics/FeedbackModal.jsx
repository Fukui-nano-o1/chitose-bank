import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVisualViewportFit } from '../../lib/visualViewportFit';
import { captureSupportContext } from '../../lib/supportDiagnostics';
import { SUPPORT_TOPICS, SUPPORT_IMPACTS, supportTopicLabel, supportStatusLabel, supportReceipt, supportDate } from '../../lib/supportModel';
import { supportId, readSupportDraft, saveSupportDraft, clearSupportDraft, prepareSupportRequest, submitSupport, listSupport, getSupport, replySupport, supportErrorMessage, supportStorageAvailable, forgetGuestSupport, readSupportReply, saveSupportReply, clearSupportReply } from '../../lib/supportClient';
import './FeedbackModal.css';

const CATEGORIES = [['broken','動かない'], ['confusing','分かりにくい'], ['typo','誤字・表示'], ['suggestion','提案'], ['other','その他']];
function newDraft(topic = 'other', context) { return { id: supportId(), topic, category: 'confusing', impact: 'difficult', body: '', expected: '', includeDiagnostics: true, context: context || captureSupportContext() }; }
function Status({ status }) { return <span className={`support-status support-status-${status}`}>{supportStatusLabel(status)}</span>; }

// Keep the underlying form mounted. A separate session per account rejects stale responses.
export function FeedbackModal({ open, onClose, userId = null, initialRequest = {} }) {
  return open ? <SupportSession key={userId || 'guest'} onClose={onClose} userId={userId} initialRequest={initialRequest} /> : null;
}
function SupportSession({ onClose, userId, initialRequest }) {
  const [draft, setDraft] = useState(() => readSupportDraft(userId) || newDraft(initialRequest.topic, initialRequest.context));
  const [view, setView] = useState(initialRequest.view || (initialRequest.topic ? 'guide' : 'home'));
  const [topic, setTopic] = useState(initialRequest.topic || draft.topic);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [items, setItems] = useState(null), [detail, setDetail] = useState(null), [sent, setSent] = useState(null);
  const [reply, setReply] = useState({ id: supportId(), body: '' });
  const [confirmForget, setConfirmForget] = useState(false), [copyText, setCopyText] = useState(''), [copied, setCopied] = useState(false), [trap, setTrap] = useState('');
  const overlayRef = useRef(null), scrollRef = useRef(null), busyRef = useRef(false), mounted = useRef(true), sequence = useRef(0), writeGeneration = useRef(0);
  const storageWorks = useRef(supportStorageAvailable());
  const activeTopic = SUPPORT_TOPICS.find(item => item.value === topic) || SUPPORT_TOPICS.at(-1);
  useVisualViewportFit(overlayRef, true);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    overlayRef.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => { mounted.current = false; sequence.current += 1; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: 0 }); }, [view]);
  useEffect(() => {
    if (draft.body || draft.expected || draft.pending) saveSupportDraft(userId, draft);
    else if (readSupportDraft(userId)?.id === draft.id) clearSupportDraft(userId);
  }, [draft, userId]);
  useEffect(() => {
    if (userId) return;
    const cleared = () => {
      sequence.current += 1; writeGeneration.current += 1; busyRef.current = false;
      setBusy(false); setLoading(false); setError(''); setItems(null); setDetail(null); setSent(null);
      setDraft(newDraft()); setReply({ id: supportId(), body: '' }); setView('home');
    };
    window.addEventListener('cb:support-access-cleared', cleared);
    return () => window.removeEventListener('cb:support-access-cleared', cleared);
  }, [userId]);
  useEffect(() => {
    if (initialRequest.view === 'history') loadHistory();
    // This request is captured once at opening, not while editing the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = patch => setDraft(previous => ({ ...previous, ...patch }));
  const go = next => { sequence.current += 1; setLoading(false); setError(''); setCopyText(''); setCopied(false); setView(next); };
  const back = () => { if (view === 'home') onClose(); else if (view === 'detail') loadHistory(); else go(view === 'compose' ? 'guide' : 'home'); };
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const els = [...overlayRef.current.querySelectorAll('button:not(:disabled),a[href],textarea:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(el => !el.closest('[aria-hidden="true"]'));
    if (event.shiftKey && document.activeElement === els[0]) { event.preventDefault(); els.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === els.at(-1)) { event.preventDefault(); els[0]?.focus(); }
  }
  async function loadHistory() {
    const request = ++sequence.current;
    setView('history'); setLoading(true); setError('');
    try { const rows = await listSupport(userId); if (mounted.current && request === sequence.current) setItems(rows); }
    catch { if (mounted.current && request === sequence.current) setError('相談履歴を取得できません。通信状況を確認して、もう一度読み込んでください。'); }
    finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }
  async function loadDetail(id) {
    const request = ++sequence.current;
    setView('detail'); setLoading(true); setError(''); setDetail(null);
    setReply(readSupportReply(userId, id) || { id: supportId(), body: '' });
    try { const result = await getSupport(id, userId); if (mounted.current && request === sequence.current) setDetail(result); }
    catch (failure) { if (mounted.current && request === sequence.current) setError(supportErrorMessage(failure)); }
    finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }
  async function send(event) {
    event.preventDefault();
    if (busyRef.current || !draft.body.trim() || trap) return;
    const generation = writeGeneration.current;
    const pending = prepareSupportRequest(draft, draft.context), frozen = { ...draft, pending };
    setDraft(frozen); saveSupportDraft(userId, frozen); busyRef.current = true; setBusy(true); setError('');
    try { const result = await submitSupport(pending, userId); if (!mounted.current || generation !== writeGeneration.current) return; setSent(result); setDraft(newDraft(topic)); setView('sent'); }
    catch (failure) { if (mounted.current && generation === writeGeneration.current) setError(supportErrorMessage(failure)); }
    finally { if (generation === writeGeneration.current) { busyRef.current = false; if (mounted.current) setBusy(false); } }
  }
  async function sendReply(event) {
    event.preventDefault();
    if (busyRef.current || !reply.body.trim() || !detail) return;
    const report = detail.report;
    const generation = writeGeneration.current;
    const pending = reply.pending || { body: reply.body.trim(), id: reply.id, reopen: report.status === 'resolved' };
    setReply({ ...reply, pending }); saveSupportReply(userId, report.id, { ...reply, pending }); busyRef.current = true; setBusy(true); setError('');
    try { await replySupport(report.id, pending.body, pending.id, pending.reopen, userId); clearSupportReply(userId, report.id); if (mounted.current && generation === writeGeneration.current) await loadDetail(report.id); }
    catch (failure) { if (mounted.current && generation === writeGeneration.current) setError(supportErrorMessage(failure)); }
    finally { if (generation === writeGeneration.current) { busyRef.current = false; if (mounted.current) setBusy(false); } }
  }
  async function copyReport() {
    const text = `chitose-bankへの相談\n${supportTopicLabel(draft.topic)}\n${draft.body}\n期待したこと：${draft.expected || '記載なし'}\n画面：${draft.context.page_hash}\n受付確認用：${draft.id}`;
    setCopyText(text);
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  const report = detail?.report;
  return createPortal(<div className="support-overlay cb-lock-scroll f-sans" ref={overlayRef} onKeyDown={onKeyDown}>
    <section className="support-panel" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <header className="support-header"><button type="button" className="support-icon-button" aria-label="前の画面に戻る" onClick={back}>←</button><h2 id="support-title">{view === 'history' ? '相談履歴' : view === 'detail' ? '相談の状況' : 'ヘルプ・お問い合わせ'}</h2><button type="button" className="support-icon-button" aria-label="元の画面に戻る" onClick={onClose}>×</button></header>
      <div className="support-scroll" ref={scrollRef}>
        {view === 'home' && <><p className="support-kicker">SUPPORT</p><h3>何にお困りですか？</h3><p className="support-muted">元の画面を開いたまま、解決方法の確認や運営への相談ができます。</p>
          {(draft.body || draft.expected || draft.pending) && <button className="support-secondary" onClick={() => go('compose')}>下書きを続ける</button>}
          <div className="support-choice-list">{SUPPORT_TOPICS.map(item => <button className="support-choice" key={item.value} onClick={() => { setTopic(item.value); if (!draft.pending) change({ topic: item.value }); go('guide'); }}><span>{item.label}</span><span aria-hidden="true">›</span></button>)}</div>
          <button className="support-secondary" onClick={loadHistory}>相談履歴</button><p className="support-save-hint">運営からの返信も、相談履歴で確認できます。</p></>}
        {view === 'guide' && <><p className="support-kicker">{activeTopic.label}</p><h3>まず確認できること</h3><ol className="support-help-steps">{activeTopic.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <button className="support-primary" onClick={() => { if (!draft.pending) change({ topic }); go('compose'); }}>この内容で相談する</button><button className="support-secondary" onClick={onClose}>元の操作に戻る</button><button className="support-link" onClick={loadHistory}>相談履歴を見る</button></>}
        {view === 'compose' && <form onSubmit={send}>
          <p className="support-kicker">{supportTopicLabel(draft.topic)}</p><h3>困ったことを教えてください</h3><p className="support-muted">小さな迷いや改善の提案も、運営が確認します。</p>
          <p className="support-notice">報告を送ると、開いていた画面の種類も自動で運営に届きます。スクリーンショットや元の画面の入力内容は添付されません。</p>
          <fieldset className="support-impact" disabled={Boolean(draft.pending)}><legend>今の状況</legend>{SUPPORT_IMPACTS.map(item => <label key={item.value}><input type="radio" name="support-impact" value={item.value} checked={draft.impact === item.value} onChange={() => change({ impact: item.value, category: item.value === 'suggestion' ? 'suggestion' : item.value === 'blocked' ? 'broken' : 'confusing' })} />{item.label}</label>)}</fieldset>
          <label className="support-field">報告の種類<select name="support-category" disabled={Boolean(draft.pending)} value={draft.category} onChange={event => change({ category: event.target.value })}>{CATEGORIES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="support-field">どこで、どうなりましたか？<small>例：PDFを作るボタンを押すと、作成中のまま進みません。</small><textarea name="support-body" required maxLength={3000} rows={4} disabled={Boolean(draft.pending)} value={draft.body} onChange={event => change({ body: event.target.value })} placeholder="気づいたことを、そのまま書いてください" /><small>{draft.body.length}/3000文字。パスワード・認証コード・個人の連絡先は書かないでください。</small></label>
          <label className="support-field">どうなればよかったですか？ <span className="support-muted">任意</span><input name="support-expected" maxLength={1000} disabled={Boolean(draft.pending)} value={draft.expected} onChange={event => change({ expected: event.target.value })} placeholder="例：PDFをスマホに保存したかった" /></label>
          <div className="support-diagnostics"><label><input type="checkbox" name="support-diagnostics" checked={draft.includeDiagnostics} disabled={Boolean(draft.pending)} onChange={event => change({ includeDiagnostics: event.target.checked })} /><span>原因の確認に必要な技術情報を添付する</span></label><p>時刻・画面幅・アプリの版・直近のエラー識別子。入力内容や操作の録画は含みません。</p>{draft.includeDiagnostics && <details><summary>添付する内容を見る</summary><pre>{JSON.stringify(draft.context,null,2)}</pre></details>}<p>相談は本人と運営が確認できます。</p></div>
          <label className="support-honeypot" aria-hidden="true">会社名<input tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)} /></label>
          {draft.pending && !busy && <p className="support-notice">送信の確認が終わるまで内容を保持しています。同じ内容で再送するか、相談履歴を確認できます。</p>}
          {error && <div className="support-error" role="alert">{error}</div>}
          <button type="submit" className="support-primary" disabled={busy || !draft.body.trim()}>{busy ? '送信を確認しています…' : draft.pending ? '同じ内容で再送する' : '運営に送信する'}</button>
          <p className="support-save-hint">{storageWorks.current ? '下書きはこの端末に残ります。閉じても7日以内なら再開できます。' : 'このブラウザでは下書きを保存できません。再読み込みする前に本文をコピーしてください。'}</p>
          <button type="button" className="support-link" onClick={onClose}>下書きを残して元の画面に戻る</button>
          {draft.pending && <button type="button" className="support-secondary" onClick={loadHistory}>相談履歴で受付を確認</button>}
          {error && <><button type="button" className="support-link" onClick={copyReport}>報告内容をコピー</button><p><a href="mailto:t5fki6643qty@gmail.com?subject=chitose-bankへの相談">メールで運営に相談する</a></p><p className="support-muted">メールアプリが開きます。コピーした内容を貼り付けて送れます。</p></>}
          {copyText && <><p role="status">{copied ? 'コピーしました。' : '本文を選択してコピーしてください。'}</p><label className="support-field">コピー用の本文<textarea readOnly value={copyText} /></label></>}
        </form>}
        {view === 'sent' && <><p className="support-kicker">{supportReceipt(sent?.id)}</p><h3>相談を受け付けました</h3><p>運営が内容を確認します。返信や対応状況は、この相談の続きから確認できます。</p>
          {!userId && <p className="support-notice">ログインせずに送信しました。この端末・ブラウザの「相談履歴」から返信を確認できます。履歴の確認にメールは必要ありません。</p>}
          {!storageWorks.current && <p className="support-error">このブラウザでは受付情報を保存できません。このページを閉じると相談履歴を開けなくなる場合があります。</p>}
          <button className="support-primary" onClick={() => loadDetail(sent.id)}>相談の状況を見る</button><button className="support-secondary" onClick={onClose}>元の操作に戻る</button></>}
        {view === 'history' && <><h3>あなたの相談</h3><p className="support-muted">返信を確認したり、状況を追加で伝えたりできます。</p>
          {!userId && <p className="support-notice">ログイン前の相談は、この端末・ブラウザで確認できます。共用端末では、確認後に下の操作で端末の受付情報を消せます。</p>}
          {loading && <p role="status">相談履歴を確認しています…</p>}{error && <div className="support-error" role="alert">{error}</div>}
          {!loading && !error && items?.length === 0 && <p className="support-notice">まだ相談はありません。困ったことや気づいたことをお知らせください。</p>}
          {items?.map(item => <button className="support-ticket" key={item.id} onClick={() => loadDetail(item.id)}><span className="support-ticket-top"><Status status={item.status} /><time>{supportDate(item.updated_at || item.created_at)}</time></span><strong>{supportTopicLabel(item.topic)}</strong><p>{item.body}</p><span className="support-muted">{supportReceipt(item.id)} ›</span></button>)}
          <button className="support-secondary" disabled={loading} onClick={loadHistory}>相談履歴を更新する</button><button className="support-link" onClick={() => go('home')}>ヘルプに戻る</button>
          {!userId && <><hr className="support-divider" />{confirmForget ? <div className="support-notice"><p>この端末から相談履歴と下書きを開けなくなります。運営に送った相談は削除されません。</p><button className="support-secondary" onClick={() => { sequence.current += 1; writeGeneration.current += 1; busyRef.current = false; setBusy(false); forgetGuestSupport(); setItems([]); setDetail(null); setLoading(false); setError(''); setDraft(newDraft()); setConfirmForget(false); }}>端末の受付情報を消す</button><button className="support-link" onClick={() => setConfirmForget(false)}>やめる</button></div> : <button className="support-link" onClick={() => setConfirmForget(true)}>この端末の受付情報を消す</button>}</>}
        </>}
        {view === 'detail' && <>{loading && <p role="status">相談の状況を確認しています…</p>}
          {report && <><div className="support-ticket-top"><Status status={report.status} /><span className="support-muted">{supportReceipt(report.id)}</span></div><h3>{supportTopicLabel(report.topic)}</h3>
            <div className="support-message"><div className="support-message-meta"><strong>あなたの相談</strong><time>{supportDate(report.created_at)}</time></div><p>{report.body}</p>{report.expected_result && <p>期待したこと：{report.expected_result}</p>}</div>
            {(detail.messages || []).map(message => <div key={message.id} className={`support-message${message.author_role === 'admin' ? ' support-message-admin' : ''}`}><div className="support-message-meta"><strong>{message.author_role === 'admin' ? '運営からの返信' : 'あなたの追記'}</strong><time>{supportDate(message.created_at)}</time></div><p>{message.body}</p></div>)}
            {report.status === 'resolved' ? <p className="support-notice">運営が対応を完了しました。まだ解決していない場合は、下から状況を伝えて再確認を依頼できます。</p> : <p className="support-muted">運営の返信はここに表示されます。追加の状況は、新しい相談を作らず、この下に追記できます。</p>}
            <hr className="support-divider" /><form onSubmit={sendReply}><label className="support-field">{report.status === 'resolved' ? 'まだ困っていること' : '追加で伝えたいこと'}<textarea name="support-reply" rows={3} required maxLength={3000} disabled={Boolean(reply.pending)} value={reply.body} onChange={event => { const next = { ...reply, body: event.target.value }; setReply(next); saveSupportReply(userId, report.id, next); }} /></label>{error && <div className="support-error" role="alert">{error}</div>}<button className="support-primary" disabled={busy || !reply.body.trim()}>{busy ? '送信を確認しています…' : report.status === 'resolved' ? 'まだ解決していない' : '追記を送信する'}</button></form>
            <button className="support-secondary" disabled={busy || loading} onClick={() => loadDetail(report.id)}>対応状況を更新する</button></>}
          {!report && !loading && error && <div className="support-error" role="alert">{error}</div>}<button className="support-link" onClick={loadHistory}>相談履歴に戻る</button></>}
      </div>
    </section>
  </div>, document.body);
}
