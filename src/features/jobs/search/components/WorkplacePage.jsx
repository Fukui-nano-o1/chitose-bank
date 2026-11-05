import { WorkplacePhoto } from '../../../../components/WorkplacePhoto.jsx';
import { validWorkplacePhotoPath } from '../../../../lib/workplacePhotoAccess.js';
import { workplaceSections } from '../workplacePresentation.js';

const sectionStyle = { padding: '24px 0', borderTop: '1px solid #EBEBEB' };
const headingStyle = { fontSize: 20, fontWeight: 700, margin: '0 0 12px', lineHeight: 1.5 };
const bodyStyle = { fontSize: 15, lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

// A route-owned page, not a sheet. The controller owns history/scroll restoration.
// Workplace photographs have their own publication lifecycle, separate from jobs.
// Only the dedicated published RPC supplies these paths. Never substitute job photos or avatars.
export function WorkplacePage({ job, employer, status = 'loading', photos = [], photoStatus = 'unconfigured', onBack }) {
  const workplacePhotos = photoStatus === 'ready' && Array.isArray(photos) ? photos.filter(photo => validWorkplacePhotoPath(photo?.path)) : [];
  const sections = status === 'ready' ? workplaceSections(employer) : [];

  return (
    <section className="workplace-page f-sans" aria-label="職場紹介" style={{ background: '#fff', color: '#222', minHeight: '100dvh', padding: '0 20px calc(96px + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ padding: '20px 0', borderBottom: '1px solid #EBEBEB' }}>
          <button type="button" onClick={onBack} className="f-sans cb-btn-press cb-hover-tint"
            style={{ minHeight: 44, background: '#fff', border: '1px solid #DDD', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#222' }}>
            <span aria-hidden="true">← </span>求人詳細に戻る
          </button>
        </header>
        <h1 style={{ fontSize: 28, lineHeight: 1.4, margin: '28px 0 8px' }}>職場紹介</h1>
        <p style={{ ...bodyStyle, color: '#717171', marginBottom: 24 }}>{[job?.crop, job?.task].filter(Boolean).join(' ')}{job?.id != null ? `（求人 #${job.id}）` : ''}</p>

        <section aria-labelledby="workplace-photos" style={sectionStyle}>
          <h2 id="workplace-photos" style={headingStyle}>職場の写真</h2>
          {photoStatus === 'loading' && <p role="status">職場の写真を読み込んでいます…</p>}
          {photoStatus === 'error' && <p role="alert">職場の写真を読み込めませんでした。求人詳細に戻って、もう一度お試しください。</p>}
          {photoStatus === 'unconfigured' && <p style={{ ...bodyStyle, color: '#717171' }}>職場紹介の写真は準備中です。求人の写真はここには表示しません。</p>}
          {photoStatus === 'ready' && !workplacePhotos.length && <p style={{ ...bodyStyle, color: '#717171' }}>職場の写真はまだ公開されていません。</p>}
          {workplacePhotos.map((photo, index) => <WorkplacePhoto key={photo.id || photo.path} path={photo.path} alt={`職場で働く様子 ${index + 1}`}
            style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', borderRadius: 12, background: '#F7F7F7', marginBottom: 20 }} />)}
        </section>

        <p style={{ ...bodyStyle, color: '#717171', marginBottom: 20 }}>文章は募集主が登録した普段の働き方の紹介で、勤務場所ごとの情報ではありません。設備・サポートは、この求人の掲載時の条件です。</p>
        {status === 'loading' && <p role="status" style={bodyStyle}>職場紹介を読み込んでいます…</p>}
        {status === 'error' && <p role="alert" style={bodyStyle}>職場紹介を読み込めませんでした。求人詳細に戻って、もう一度お試しください。</p>}
        {status === 'ready' && !sections.length && <p style={{ ...bodyStyle, color: '#717171' }}>職場紹介はまだ登録されていません。</p>}
        {sections.map(group => <section key={group.id} aria-labelledby={'workplace-' + group.id} style={sectionStyle}>
          <h2 id={'workplace-' + group.id} style={headingStyle}>{group.title}</h2>
          {group.rows.map(item => <div key={item.title} style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>{item.title}</h3>
            <p style={bodyStyle}>{item.body}</p>
          </div>)}
        </section>)}
      </div>
    </section>
  );
}
