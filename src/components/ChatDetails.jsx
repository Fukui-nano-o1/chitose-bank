import { Avatar } from './ui';
import { ChatSheet } from './ChatSheet';
import { APP_PHASE_LABEL, calFmtDate, photoThumb } from '../lib/utils';

// 情報の行をそのまま行き先にする。見送り・失効・取消に予定や集合場所は案内しない。
export function ChatDetails({ job, jobNumber, status, phase, partner, isWorkerSide, agreedDates, meetingPlace,
  canOpenPartner, canReport, onClose, onJob, onPartner, onSchedule, onReport, onScreenReport, onHelp }) {
  const hasSchedule = ['applied', 'approved', 'meeting', 'interview', 'contracted', 'working', 'completed'].includes(status);
  const title = job ? [job.crop, job.task].filter(Boolean).join(' ') : '仕事の内容';
  const dates = agreedDates?.length ? agreedDates.map(calFmtDate).join('・') : job?.dateLabel;
  const photo = photoThumb(job?.photos?.[0]);
  return <ChatSheet title="会話の詳細" onClose={onClose}>
    <button type="button" className="chat-detail-job" disabled={!jobNumber} onClick={onJob} aria-label="求人の詳細を見る">
      {photo && <img src={photo} alt="" />}
      <span><small>求人 #{jobNumber || '確認中'} · {APP_PHASE_LABEL[phase] || '確認中'}</small><strong>{title}</strong></span>
      <span aria-hidden="true">›</span>
    </button>
    <nav className="chat-detail-destinations" aria-label="この仕事の情報">
      <button type="button" className="chat-detail-row" disabled={!canOpenPartner} onClick={onPartner} aria-label="相手のプロフィールを見る">
        <Avatar url={partner?.avatar_url} name={partner?.nickname || '？'} size={42} />
        <span className="chat-detail-copy"><small>{isWorkerSide ? '募集主' : '働き手'}</small><strong>{partner?.nickname || '確認中'}</strong></span>
        <span aria-hidden="true">›</span>
      </button>
      {hasSchedule && <button type="button" className="chat-detail-row" onClick={onSchedule} aria-label="この仕事の予定を見る">
        <span className="chat-detail-copy"><small>{status === 'completed' ? '仕事の記録' : '日程・時間'}</small>
          <strong>{dates || '予定の詳細'}</strong>{job?.workTime && <span>{job.workTime}</span>}
        </span><span aria-hidden="true">›</span>
      </button>}
      {hasSchedule && meetingPlace?.full_address && <a className="chat-detail-row" target="_blank" rel="noopener noreferrer"
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meetingPlace.full_address)}`} aria-label="集合場所を地図で見る（別タブ）">
        <span className="chat-detail-copy"><small>集合場所 · 地図で見る</small><strong>{meetingPlace.full_address}</strong></span><span aria-hidden="true">↗</span>
      </a>}
    </nav>
    <nav className="chat-detail-support" aria-label="ヘルプ・報告">
      {canReport && <button type="button" className="chat-detail-row" onClick={onReport}><span>メッセージを通報</span><span aria-hidden="true">›</span></button>}
      <button type="button" className="chat-detail-row" onClick={onScreenReport}><span>この画面を報告</span><span aria-hidden="true">›</span></button>
      <button type="button" className="chat-detail-row" onClick={onHelp}><span>使い方・お問い合わせ</span><span aria-hidden="true">›</span></button>
    </nav>
  </ChatSheet>;
}
