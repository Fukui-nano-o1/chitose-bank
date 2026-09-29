import { Avatar, ExpandableText } from './ui';
import { WORKER_DECLARATIONS, workerQaItems, tenureLabel, yearMonthLabel } from '../lib/utils';

export function ApplicantProfile({ profile, trust }) {
  if (!profile) return <p role="status">プロフィールを読み込んでいます…</p>;
  const experience = (Array.isArray(profile.experience_entries) ? profile.experience_entries : [])
    .filter(e => e?.crop?.trim()).map(e => `${e.crop} × ${e.task || ''}${e.duration ? `（${e.duration}）` : ''}`);
  const qualifications = (Array.isArray(profile.self_declared) ? profile.self_declared : [])
    .map(key => WORKER_DECLARATIONS.find(item => item.k === key)?.chip).filter(Boolean);
  const facts = [
    ['農業の経験', profile.farm_experience], ['経験のある作物・作業', experience.join('\n')],
    ['経験のある作業', (profile.experienced_tasks || []).join('・')],
    ['免許・資格など', qualifications.join('・')], ['移動手段', profile.transport],
    ['やり取りできる言語', (profile.languages || []).join('・')],
  ].filter(([,value]) => value);
  const qa = workerQaItems(profile);
  return <div className="applicant-profile">
    <div className="applicant-person">
      <div className="applicant-person__avatar"><Avatar url={profile.avatar_url} name={profile.nickname} size={80} /></div>
      <div><h3>{profile.nickname || '名前未設定'}</h3>
        {profile.residence_city && <p>{profile.residence_city}</p>}
        {trust?.joined_at && <p>利用{tenureLabel(trust.joined_at)}</p>}
      </div>
    </div>
    {trust?.verified_at && <p className="applicant-profile__note">✓ 連絡先確認済み（{yearMonthLabel(trust.verified_at)}）</p>}
    {profile.pr && <section className="applicant-detail__section"><h3>自己紹介</h3>
      <ExpandableText text={profile.pr} limit={180} moreLabel="続きを読む" style={{ fontSize:15,lineHeight:1.8,whiteSpace:'pre-wrap' }} />
    </section>}
    {facts.length > 0 && <section className="applicant-detail__section"><h3>経験・できること</h3>
      <dl>{facts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="applicant-profile__note">ご本人の申告です。運営が確認したものではありません。</p>
    </section>}
    {!!profile.interests?.length && <section className="applicant-detail__section"><h3>趣味・好きなこと</h3>
      <div className="applicant-profile__chips">{profile.interests.map((tag,i) => <span key={i}>{tag}</span>)}</div>
    </section>}
    {qa.length > 0 && <section className="applicant-detail__section"><h3>働き方・人となり</h3>
      <dl>{qa.map((item,i) => <div key={i}><dt>{item.q}</dt><dd>{item.a}</dd></div>)}</dl>
    </section>}
  </div>;
}
