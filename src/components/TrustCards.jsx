// 信頼カード（分割・段階2後半・2026-07-24）：働き手/雇い手の与信情報カード。プレビュー・応募者カード・確認ページで共用。
import { WORKER_DECLARATIONS, INSURANCE_ITEMS, ROLE_ORANGE, ROLE_ORANGE_INK, yearMonthLabel, farmHostQa, interactionStyleLabel, tenureLabel, normalizeInsuranceItems } from "../lib/utils";
import { ExpandableText, Avatar } from "./ui";

export function WorkerTrustCard({ profile, trust, onEditItem, hideSelfDeclare }) {
  if (!profile) return null;
  const tap = onEditItem ? (key) => ({ onClick: () => onEditItem(key), role: "button" }) : () => ({});
  // 移動手段・経験区分は本人申告なので📋自己申告ブロックへ集約（2026-07-23）。バッジ列は希望条件（作業の強さ）のみ
  const badges = [
    profile.physical_level && { icon:"💪", text: profile.physical_level, k:"intensity" },
  ].filter(Boolean);
  const tags = [
    ...(profile.interests || []).map(t => ({ t, k:"interests" })),
    ...(profile.languages || []).map(t => ({ t, k:"languages" })),
  ];
  // 📋自己申告に集約する本人申告：経験区分・経験のある作業・移動手段＋免許資格保険（🌟実績枠には絶対入れない）
  const declItems = [
    // 経験の構造化申告（作物×作業（どのくらい））を先頭に（2026-07-23）
    ...((Array.isArray(profile.experience_entries) ? profile.experience_entries : []).filter(e => e && (e.crop || "").trim()).map(e => ({ text: `${e.crop}×${e.task || ""}${e.duration ? `（${e.duration}）` : ""}`, k:"declared" }))),
    ...(profile.farm_experience ? [{ text:"🌾 " + profile.farm_experience, k:"exp" }] : []),
    ...((Array.isArray(profile.experienced_tasks) ? profile.experienced_tasks : []).filter(Boolean).map(t => ({ text: t, k:"declared" }))),
    ...(profile.transport ? [{ text:"🚗 " + profile.transport, k:"transport" }] : []),
    ...((Array.isArray(profile.self_declared) ? profile.self_declared : []).map(key => { const it = WORKER_DECLARATIONS.find(x => x.k === key); return it ? { text: it.chip, k:"declared" } : null; }).filter(Boolean)),
  ];
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
        <div {...tap("avatar")} style={{ width:56, height:56, borderRadius:"50%", border:"1.5px solid " + ROLE_ORANGE, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0, ...(onEditItem ? { cursor:"pointer" } : {}) }}>
          <Avatar url={profile.avatar_url} name={profile.nickname} size={56} ring={ROLE_ORANGE} />
        </div>
        <div style={{ minWidth:0 }}>
          <p {...tap("nickname")} className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0, ...(onEditItem ? { cursor:"pointer" } : {}) }}>{profile.nickname || "名前未設定"}</p>
          {profile.residence_city && (
            <p {...tap("residence")} className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0", ...(onEditItem ? { cursor:"pointer" } : {}) }}>📍{profile.residence_city}</p>
          )}
        </div>
      </div>
      {(trust?.joined_at || trust?.verified_at) && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:10 }}>
          {trust.joined_at && (
            <span className="f-sans" style={{ fontSize:11, color:"#717171" }}>chitose-bank利用{tenureLabel(trust.joined_at)}</span>
          )}
          {trust.verified_at && (
            <span className="f-sans" style={{ fontSize:11, color:ROLE_ORANGE_INK, fontWeight:600 }}>✓ 本人確認済み（{yearMonthLabel(trust.verified_at)}）</span>
          )}
        </div>
      )}
      {/* 💪希望する作業の強さ：閲覧時はQ&A（コメント形式・workerQaItems）に質問要素として合流したので
          バッジは出さない（2026-08-07たきと指示・二重表示を避ける）。編集モードだけは残す＝編集の入口 */}
      {onEditItem && badges.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
          {badges.map((b,i) => (
            <span key={i} {...tap(b.k)} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px", cursor:"pointer" }}>{b.icon} {b.text}</span>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
          {tags.map((x,i) => (
            <span key={i} {...tap(x.k)} className="f-sans" style={{ fontSize:11, color:"#717171", background:"#FFF3EC", borderRadius:20, padding:"3px 10px", ...(onEditItem ? { cursor:"pointer" } : {}) }}>#{x.t}</span>
          ))}
        </div>
      )}
      {/* 📋 自己申告（経験・経験のある作業・移動手段・免許・資格・保険方針。ご本人の申告・運営未確認）。
          枠（ボックス＋見出し）は撤回し、趣味タグ等と同じチップの群れに揃える（2026-08-05たきと指示）。
          区別は色だけ＝青系。★実績（🌟＝このサイトの台帳）とは別物so、実績枠には絶対に入れない（2026-07-23） */}
      {!hideSelfDeclare && declItems.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {declItems.map((it, i) => (
              <span key={i} {...tap(it.k)} className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#3A5570", background:"#E8EEF7", borderRadius:20, padding:"3px 10px", ...(onEditItem ? { cursor:"pointer" } : {}) }}>{it.text}</span>
            ))}
          </div>
          {/* 自己申告であることの明示は残す（実績と混同させない・法務上の一言） */}
          <p className="f-sans" style={{ fontSize:10, color:"#A0A8B4", margin:"6px 0 0", lineHeight:1.5 }}>ご本人の申告です。運営が確認したものではありません。</p>
        </div>
      )}
      {/* 自己紹介だけは枠を持たせる（2026-08-06たきと指示）。チップの群れ（趣味＝橙／自己申告＝青）と
          実績（緑）に挟まれて本文が地の文に見えてしまうため、白い枠＋小見出しで「本人の言葉」として独立させる。
          100文字を超えたら「…続き」で畳み、タップで全文（枠の色は無彩色＝実績の緑と競合させない） */}
      {profile.pr && (
        <div
          {...(onEditItem ? tap("pr") : {})}
          style={{ background:"#FAFAFA", border:"1px solid #EDEDED", borderRadius:12, padding:"12px 14px", ...(onEditItem ? { cursor:"pointer" } : {}) }}
        >
          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", margin:"0 0 6px" }}>自己紹介</p>
          {onEditItem ? (
            <p className="f-sans" style={{ fontSize:13, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{profile.pr}</p>
          ) : (
            // 閲覧時（プレビュー・応募者カード）は…で省略し、タップで全文（2026-07-23）
            <ExpandableText text={profile.pr} limit={100} moreLabel="続き" style={{ fontSize:13, color:"#222", margin:0, lineHeight:1.7 }} />
          )}
        </div>
      )}
      {/* ── 🌟 実績ブロック（このサイトの台帳のみ。自己申告チップはこの枠に絶対に入れない）。自己申告より上に置く（2026-07-23） ── */}
      {trust?.ok && ((trust.completed_count || 0) > 0 || (trust.want_again_count || 0) > 0 || (trust.total_hours || 0) > 0) && (
        <div style={{ marginTop:12, background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:12, padding:"12px 14px" }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#0B6B4F", margin:"0 0 8px" }}>🌟 実績（このサイトの記録）</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:14 }}>
            <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>完了 {trust.completed_count || 0}回</span>
            {(trust.want_again_count || 0) > 0 && <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>🌟 また働きたい {trust.want_again_count}</span>}
            {(trust.total_hours || 0) > 0 && <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>作業 {trust.total_hours}時間</span>}
          </div>
        </div>
      )}
      {/* 旧・📋自己申告ブロック（白枠＋見出し）は撤回（2026-08-05たきと指示）＝上のタグ群へ統合済み。
          本人のわたしの実績モーダルでは hideSelfDeclare で非表示・農家の応募者カードでは表示、の扱いは不変 */}
    </div>
  );
}

// 農家版15秒カード（WorkerTrustCardの鏡写し）。trustはemployer_trust_info/job_employer_trust_infoの返り値
// onEditItem（任意）: 本人プレビュー用。渡すと各項目がタップ可能になり、対応する編集ボックスのキー
// (avatar/nickname/style/ask)を返す。働き手側（求人詳細等）は渡さない＝従来どおり表示専用
// extraBadges（任意）：待遇バッジ等、呼び出し元が持つタグをこのカードのタグ行に合流させる。
// 渡さない画面（求人詳細など）は従来どおり呼び出し元が自前で並べる＝表示は不変
// black（任意・2026-07-31たきと指示）：委託プレビュー用の黒テーマ。緑→黒・絵文字アイコンは出さない。
// 既定false＝求人詳細・雇い手プレビュー等の既存画面は不変
export function FarmerTrustCard({ profile, trust, onEditItem, onTapExperience, onTapOpenJobs, extraBadges, black = false }) {
  if (!profile) return null;
  const AC = black ? "#111111" : "#00A86B";
  const tap = onEditItem ? (key) => ({ onClick: () => onEditItem(key), role: "button" }) : () => ({});
  const cur = onEditItem ? { cursor:"pointer" } : {};
  // black（委託）では 問いかけQ&A・関わり方チップを出さない（2026-07-31たきと指示・委託に該当ボックスが無いため）
  const qa = black ? [] : farmHostQa(profile);
  const styleLabel = black ? "" : interactionStyleLabel(profile.interaction_style);
  const okTrust = !!(trust && trust.ok);
  return (
    <div>
      {/* ヘッダー刷新（2026-08-03たきと指示）：アイコンを中央に、下に募集者の項目（氏名・住所・連絡先）を
          ラベル｜内容の行で表示。値は募集者の法定3項目（recruiter_*）＝求人詳細の農園紹介では
          job_employer_profile 経由でanonにはNULLで届く（訪問者には氏名（公開ニックネーム）以外出ない） */}
      <div style={{ marginBottom:12 }}>
        <div {...tap("avatar")} style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid " + AC, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", margin:"0 auto 12px", ...cur }}>
          <Avatar url={profile.avatar_url} name={profile.nickname} size={64} bg={black ? "#111111" : undefined} />
        </div>
        {/* 氏名の横にフリガナを（）付きで表示（2026-08-03たきと指示）。recruiter_name_kana は
            employer_profiles 直読みの画面は自動で載り、農園紹介は job_employer_profile が返す（anonはNULL） */}
        {[["氏名", (() => {
            const n = profile.recruiter_name || profile.nickname || "";
            const k = (profile.recruiter_name_kana || "").trim();
            return n ? (k ? `${n}（${k}）` : n) : "";
          })(), "nickname"],
          ["住所", profile.recruiter_address, "recruiter"],
          ["連絡先", profile.recruiter_contact, "recruiter"]].map(([l, v, k]) => (v && String(v).trim()) ? (
          <div key={l} {...tap(k)} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:4, ...cur }}>
            <span className="f-sans" style={{ flexShrink:0, width:56, fontSize:12, color:"#999", lineHeight:1.6 }}>{l}</span>
            <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight: l === "氏名" ? 700 : 400, lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", minWidth:0 }}>{v}</span>
          </div>
        ) : null)}
      </div>
      {okTrust && trust.want_again_workers > 0 && (
        <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:"0 0 6px" }}>{black ? "" : "🌟"}また働きたい×{trust.want_again_workers}</p>
      )}
      {okTrust && trust.completed_hires > 0 && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 6px" }}>これまでに{trust.completed_hires}人を受け入れました</p>
      )}
      {/* 公開中＝いま募集している求人（→公開中タブ）／実績＝日程が終了した求人（→過去の実績タブ）。混同させない（2026-07-24） */}
      {okTrust && trust.open_jobs > 0 && (
        <p onClick={onTapOpenJobs || undefined} role={onTapOpenJobs ? "button" : undefined} className="f-sans" style={{ fontSize:12, color: onTapOpenJobs ? AC : "#717171", fontWeight: onTapOpenJobs ? 600 : 400, margin:"0 0 6px", ...(onTapOpenJobs ? { cursor:"pointer", textDecoration:"underline" } : {}) }}>
          公開中：{trust.open_jobs}件{onTapOpenJobs ? " →" : ""}
        </p>
      )}
      {/* 受け入れ中＝進行中求人への応募の現在地（応募→承認→採用）。集計値のみ・誰かは出さない */}
      {okTrust && (trust.active_applied || 0) > 0 && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 6px" }}>
          受け入れ中：応募{trust.active_applied}件・承認{trust.active_approved || 0}件・採用{trust.active_hired || 0}人
        </p>
      )}
      {okTrust && (trust.ended_jobs || 0) > 0 && (
        <p onClick={onTapExperience || undefined} role={onTapExperience ? "button" : undefined} className="f-sans" style={{ fontSize:12, color: onTapExperience ? AC : "#717171", fontWeight: onTapExperience ? 600 : 400, margin:"0 0 6px", ...(onTapExperience ? { cursor:"pointer", textDecoration:"underline" } : {}) }}>
          実績：{trust.ended_jobs}件{onTapExperience ? " →" : ""}
        </p>
      )}
      {okTrust && (trust.member_since || trust.id_checked) && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:6 }}>
          {trust.member_since && (
            <span className="f-sans" style={{ fontSize:11, color:"#717171" }}>chitose-bank利用{trust.member_since}から</span>
          )}
          {trust.id_checked && (
            <span className="f-sans" style={{ fontSize:11, color:AC, fontWeight:600 }}>✓ 本人確認済み</span>
          )}
        </div>
      )}
      {okTrust && trust.avg_approval_hours != null && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 10px" }}>承認までの時間：平均{trust.avg_approval_hours}時間</p>
      )}
      {qa.length > 0 && (
        <div {...tap("ask")} style={{ display:"grid", gap:10, marginTop:4, ...cur }}>
          {qa.map(({ q, a }) => (
            <div key={q}>
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
              <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
            </div>
          ))}
        </div>
      )}
      {/* タグは1箇所に集約（2026-07-27たきと指示）：やり取りの雰囲気・保険・待遇を1行に並べる。
          「🛡 保険の準備（自己申告）」の見出しは削除し、自己申告の注記だけタグ行の下に残す */}
      {(() => {
        const insChips = normalizeInsuranceItems(profile.insurance_items).map(k => INSURANCE_ITEMS.find(x => x.k === k)).filter(Boolean);
        const perks = Array.isArray(extraBadges) ? extraBadges : [];
        if (!styleLabel && insChips.length === 0 && perks.length === 0) return null;
        return (
          <div style={{ marginTop:12 }}>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {styleLabel && (
                <span {...tap("style")} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px", ...cur }}>{black ? "" : "🤝 "}{styleLabel}</span>
              )}
              {insChips.map(it => (
                <span key={it.k} className="f-sans" style={{ fontSize:12, fontWeight:600, color: black ? "#111111" : "#0B6B4F", background: black ? "#EEEEEE" : "#E6F7EF", borderRadius:20, padding:"4px 10px" }}>{black ? "" : "🛡 "}{it.chip}</span>
              ))}
              {perks.map(b => (
                <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px" }}>{black ? b.replace(/^\S+\s/, "") : b}</span>
              ))}
            </div>
            {insChips.length > 0 && (
              <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"6px 0 0", lineHeight:1.5 }}>農家の自己申告です。運営が確認したものではありません。</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}
