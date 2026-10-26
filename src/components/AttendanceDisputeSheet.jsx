import { useState } from 'react';
import { useAttendanceRecord } from '../lib/useAttendanceRecord';
import { openSupport } from '../lib/supportDiagnostics';
import { Dots } from './ui';

export function AttendanceDisputeSheet({ app, meId, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const record = useAttendanceRecord({ owner: meId, applicationId: app?.id, day: null, mode: 'dispute',
    onRestore: input => setReason(input?.reason || '') });
  if (!app) return null;
  return <div className="cb-lock-scroll" style={{ position:'fixed', inset:0, zIndex:9500, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
    <div style={{ background:'#fff', borderRadius:16, padding:24, maxWidth:400, width:'100%', maxHeight:'100%', overflowY:'auto', WebkitOverflowScrolling:'touch', overscrollBehavior:'contain' }}>
      <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:'#222', marginBottom:12 }}>欠勤記録への異議申立</p>
      <p className="f-sans" style={{ fontSize:12, color:'#717171', lineHeight:1.6, marginBottom:12 }}>心当たりがない場合、理由を書いて送信してください。運営が確認します。</p>
      {record.readError && <p role="alert">{record.readError}<button onClick={record.reload}>もう一度読み込む</button></p>}
      <textarea value={reason} onChange={e=>setReason(e.target.value)} disabled={!record.ready || record.submitting} placeholder="異議の理由" rows={4}
        className="f-sans" style={{ width:'100%', border:'1px solid #EBEBEB', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box', marginBottom:16 }} />
      <div style={{ marginBottom:16 }}>
        <button type="button" onClick={() => openSupport({ guide: 'absence-time' })} className="support-link">通知時刻が分からない・申立できないとき</button>
        <p className="f-sans" style={{ fontSize:12, color:'#717171', lineHeight:1.6 }}>運営への相談と、その後の回答を確認できます。入力中の理由はこの画面に残ります。</p>
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button onClick={onClose} disabled={record.submitting} className="f-sans" style={{ padding:'9px 18px', fontSize:13, background:'#fff', color:'#717171', border:'1px solid #EBEBEB', borderRadius:10, cursor:'pointer' }}>キャンセル</button>
        <button onClick={()=>record.submit({application_id:app.id,kind:'dispute_no_show',reason:reason.trim()},onDone)} disabled={!record.ready || record.submitting || !reason.trim()}
          className="f-sans" style={{ padding:'9px 18px', fontSize:13, fontWeight:700, background:'#E24B4A', color:'#fff', border:'none', borderRadius:10, cursor:'pointer' }}>{record.submitting ? <>送信中<Dots /></> : '送信する'}</button>
      </div>
    </div>
  </div>;
}
