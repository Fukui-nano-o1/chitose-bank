import { ListingPhoto } from '../../../../components/ListingPhoto.jsx';
import { HOST_STYLE_QUESTIONS, hostStyleValues } from '../../../../lib/utils';

const text = value => typeof value === 'string' ? value.trim() : '';
const sectionStyle = { padding: '24px 0', borderTop: '1px solid #EBEBEB' };
const headingStyle = { fontSize: 20, fontWeight: 700, margin: '0 0 12px', lineHeight: 1.5 };
const bodyStyle = { fontSize: 15, lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

// Reuse the existing public profile vocabulary: unknown codes are not invented labels.
function styleLabels(employer, key) {
  const question = HOST_STYLE_QUESTIONS.find(item => item.k === key);
  return hostStyleValues(employer?.[key])
    .map(value => question?.options.find(option => option.value === value)?.label)
    .filter(Boolean).join('／');
}

// A route-owned page, not a sheet. The controller owns history/scroll restoration.
// Only current-job photos and already-public employer fields belong here. In
// particular a general task video is not evidence of this workplace's appearance.
export function WorkplacePage({ job, employer, status = 'loading', onBack }) {
  const photos = (Array.isArray(job?.photos) ? job.photos : [])
    .map(photo => ({ src: typeof photo === 'string' ? photo : photo?.url, caption: typeof photo === 'string' ? '' : text(photo?.caption) }))
    .filter(photo => typeof photo.src === 'string' && photo.src.trim());
  const rows = status === 'ready' ? [
    { title: '職場の雰囲気', body: text(employer?.intro_atmosphere) },
    { title: '教え方', body: styleLabels(employer, 'teaching_style') },
    { title: '質問・相談のしかた', body: styleLabels(employer, 'question_style') },
    { title: '働きに来た人に、いつもしていること', body: text(employer?.always_do) },
    { title: '休憩の過ごし方', body: text(employer?.break_style) },
  ].filter(row => row.body) : [];

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

        {job && <section aria-labelledby="workplace-photos" style={sectionStyle}>
          <h2 id="workplace-photos" style={headingStyle}>この求人の写真</h2>
          {photos.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {photos.map((photo, index) => <figure key={`${photo.src}:${index}`} style={{ margin: 0 }}>
              <ListingPhoto src={photo.src} alt={`この求人の写真 ${index + 1}`} loading={index ? 'lazy' : undefined}
                style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', background: '#F7F7F7', borderRadius: 12 }} />
              {photo.caption && <figcaption style={{ ...bodyStyle, marginTop: 8 }}>{photo.caption}</figcaption>}
            </figure>)}
          </div> : <p style={{ ...bodyStyle, color: '#717171' }}>この求人の写真はまだ登録されていません。</p>}
        </section>}

        <p style={{ ...bodyStyle, color: '#717171', marginBottom: 20 }}>以下は募集主が登録した、普段の働き方の紹介です。勤務場所ごとの情報ではありません。</p>
        {status === 'loading' && <p role="status" style={bodyStyle}>職場紹介を読み込んでいます…</p>}
        {status === 'error' && <p role="alert" style={bodyStyle}>職場紹介を読み込めませんでした。求人詳細に戻って、もう一度お試しください。</p>}
        {status === 'ready' && !rows.length && <p style={{ ...bodyStyle, color: '#717171' }}>職場紹介はまだ登録されていません。</p>}
        {rows.map(row => <section key={row.title} style={sectionStyle}>
          <h2 style={headingStyle}>{row.title}</h2>
          <p style={bodyStyle}>{row.body}</p>
        </section>)}
      </div>
    </section>
  );
}
