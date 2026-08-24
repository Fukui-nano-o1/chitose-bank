// 信頼カード（分割・段階2後半・2026-07-24）：働き手/雇い手の与信情報カード。プレビュー・応募者カード・確認ページで共用。
import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import { WORKER_DECLARATIONS, INSURANCE_ITEMS, ROLE_ORANGE, ROLE_ORANGE_INK, yearMonthLabel, farmHostQa, hostStyleChips, tenureLabel, normalizeInsuranceItems } from "../lib/utils";
import { ExpandableText, Avatar, QaChat, MaskedText } from "./ui";
import { NavIconInline } from "./NavIcons";

// アイコンの大画面表示（2026-08-14たきと指示「アイコンタップで大画面表示にしよう」）。
// createPortalでbody直下へ＝モーダル内（transform祖先）からでもfixedの基準がが画面に保たれる
// （AdminJobPreview・プロフィール編集ボックスと同じ手法）。どこをタップしても閉じる
// （✕は置かない＝農園紹介のヘッダー整理と同じ思想）。写真のある時だけ入口がが開く（頭文字アバターは拡大しない）
function AvatarLightbox({ url, onClose }) {
  return createPortal(
    <div onClick={onClose} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10500, background:"rgba(0,0,0,0.92)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", animation:"fadeIn .2s ease", padding:16 }}>
      <img src={url} alt="" style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:12 }} />
    </div>,
    document.body
  );
}

export function WorkerTrustCard({ profile, trust, onEditItem, hideSelfDeclare }) {
  const [avatarZoom, setAvatarZoom] = useState(false); // フックは早期returnより前（rules-of-hooks）
  if (!profile) return null;
  const tap = onEditItem ? (key) => ({ onClick: () => onEditItem(key), role: "button" }) : () => ({});
  // アイコンタップ：編集モード＝従来どおり編集ボックス／閲覧＝写真があれば大画面表示
  const avatarTap = onEditItem ? tap("avatar")
    : (profile.avatar_url ? { onClick: () => setAvatarZoom(true), role: "button", "aria-label": "アイコンを大きく表示" } : {});
  // 移動手段・経験区分は本人申告なので📋自己申告ブロックへ集約（2026-07-23）。バッジ列は希望条件（作業の強さ）のみ
  const badges = [
    profile.physical_level && { iconName:"dumbbell", text: profile.physical_level, k:"intensity" },
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
    ...(profile.transport ? [{ iconName:"car", text: profile.transport, k:"transport" }] : []),
    ...((Array.isArray(profile.self_declared) ? profile.self_declared : []).map(key => { const it = WORKER_DECLARATIONS.find(x => x.k === key); return it ? { text: it.chip, k:"declared" } : null; }).filter(Boolean)),
  ];
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
        <div {...avatarTap} style={{ width:56, height:56, borderRadius:"50%", border:"1.5px solid " + ROLE_ORANGE, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0, ...(avatarTap.onClick ? { cursor:"pointer" } : {}) }}>
          <Avatar url={profile.avatar_url} name={profile.nickname} size={56} ring={ROLE_ORANGE} />
        </div>
        {avatarZoom && profile.avatar_url && <AvatarLightbox url={profile.avatar_url} onClose={()=>setAvatarZoom(false)} />}
        <div style={{ minWidth:0 }}>
          <p {...tap("nickname")} className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0, ...(onEditItem ? { cursor:"pointer" } : {}) }}>{profile.nickname || "名前未設定"}</p>
          {profile.residence_city && (
            <p {...tap("residence")} className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0", ...(onEditItem ? { cursor:"pointer" } : {}) }}><NavIconInline name="pin" size={12} style={{ verticalAlign:"-1.5px", marginRight:2 }} />{profile.residence_city}</p>
          )}
        </div>
      </div>
      {(trust?.joined_at || trust?.verified_at) && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:10 }}>
          {trust.joined_at && (
            <span className="f-sans" style={{ fontSize:11, color:"#717171" }}>chitose-bank利用{tenureLabel(trust.joined_at)}</span>
          )}
          {trust.verified_at && (
            <span className="f-sans" style={{ fontSize:11, color:ROLE_ORANGE_INK, fontWeight:600 }}><NavIconInline name="tick" size={11} style={{ verticalAlign:"-1.5px" }} />連絡先確認済み（{yearMonthLabel(trust.verified_at)}）</span>
          )}
        </div>
      )}
      {/* 💪希望する作業の強さ：閲覧時はQ&A（コメント形式・workerQaItems）に質問要素として合流したので
          バッジは出さない（2026-08-07たきと指示・二重表示を避ける）。編集モードだけは残す＝編集の入口 */}
      {onEditItem && badges.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
          {badges.map((b,i) => (
            <span key={i} {...tap(b.k)} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px", cursor:"pointer" }}>{b.iconName ? <NavIconInline name={b.iconName} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} /> : null}{b.text}</span>
          ))}
        </div>
      )}
      {/* タグ群の整理整頓（2026-08-07たきと指示「綺麗に・横幅限界まで使っていい」）：
          ・チップの形を橙／青で完全に統一（同じ字サイズ・同じ余白・同じ角丸）
          ・各チップが行の余りを均等に吸収（flexGrow）＝右端まで揃った段組みになり隙間が出ない
          ・長い順に並べる＝長いチップが先に行を取り、短いチップが後ろの行を埋める（行のガタつき防止）
          ・長すぎるチップは…で省略（横スクロール・はみ出しを起こさない）
          橙=趣味・言語／青=自己申告 の色だけの区別は不変（2026-08-05規則・見出しボックスは復活させない） */}
      {tags.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:6 }}>
          {[...tags].sort((a,b) => String(b.t).length - String(a.t).length).map((x,i) => (
            <span key={i} {...tap(x.k)} className="f-sans" style={{ flex:"1 1 auto", minWidth:0, textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:12, fontWeight:600, color:"#B05A2A", background:"#FFF3EC", borderRadius:999, padding:"6px 12px", ...(onEditItem ? { cursor:"pointer" } : {}) }}>#{x.t}</span>
          ))}
        </div>
      )}
      {/* 📋 自己申告（経験・経験のある作業・移動手段・免許・資格・保険方針。ご本人の申告・運営未確認）。
          枠（ボックス＋見出し）は撤回し、趣味タグ等と同じチップの群れに揃える（2026-08-05たきと指示）。
          区別は色だけ＝青系。★実績（🌟＝このサイトの台帳）とは別物ので、実績枠には絶対に入れない（2026-07-23） */}
      {!hideSelfDeclare && declItems.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {[...declItems].sort((a,b) => String(b.text).length - String(a.text).length).map((it, i) => (
              <span key={i} {...tap(it.k)} className="f-sans" style={{ flex:"1 1 auto", minWidth:0, textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:12, fontWeight:600, color:"#3A5570", background:"#E8EEF7", borderRadius:999, padding:"6px 12px", ...(onEditItem ? { cursor:"pointer" } : {}) }}>{it.iconName ? <NavIconInline name={it.iconName} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} /> : null}{it.text}</span>
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
      {/* 🌟実績ブロック（完了回数・作業時間・また働きたい）は削除（2026-08-07たきと指示
          「記録に入ってるからプロフィールからは除外」）＝件数・時間は記録面（WorkerWorkRecord）、
          また呼びたいは評価面（ReceivedReviews）が持つ。二重表示させない。
          trust は ✓本人確認済み（verified_at）の表示で引き続き使用ので propは残す */}
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
// extraQa（任意・2026-08-14たきと指示「自己紹介以外の長文は質問形式として表示。同じ要素は視覚的にグループ分け」）：
// 紹介文のお題（farmIntroTopics）等を {q,a} で渡すと、カード内の問いかけQ&Aと同じQaChatの群れに合流する
// ＝質問形式の要素が1箇所にまとまる。渡さない画面は不変
// hideQa（任意・2026-08-14たきと指示「質問形式は代表よりの下に移植」）：カード内のQaChatを出さない。
// 農園紹介モーダル等が、質問形式の群れを代表よりの下（カードの外）に自前で描くときに使う。
// 編集モード（onEditItem）はhideQaを渡さない＝tap("ask")の編集入口は不変
// maskedFields（任意・2026-08-17たきと指示「文言を非表示にするな。モザイク処理にしろ」）：
// 訪問者に伏せた項目のうち【値が入っているもの】の名前（jobs_public.masked_fields）。
// 渡された項目は、値が空でも行を消さず伏せ字（MaskedText）で描く＝「情報が無い農家」と誤解させない。
// 渡さない画面（会員・編集・委託）は従来どおり＝値が空なら行ごと出ない。
export function FarmerTrustCard({ profile, trust, onEditItem, onTapExperience, onTapOpenJobs, extraBadges, black = false, extraQa, hideQa = false, maskedFields }) {
  const [avatarZoom, setAvatarZoom] = useState(false); // フックは早期returnより前（rules-of-hooks）
  if (!profile) return null;
  const AC = black ? "#111111" : "#00A86B";
  const tap = onEditItem ? (key) => ({ onClick: () => onEditItem(key), role: "button" }) : () => ({});
  const cur = onEditItem ? { cursor:"pointer" } : {};
  // アイコンタップ：編集モード＝従来どおり編集ボックス／閲覧＝写真があれば大画面表示
  const avatarTap = onEditItem ? tap("avatar")
    : (profile.avatar_url ? { onClick: () => setAvatarZoom(true), role: "button", "aria-label": "アイコンを大きく表示" } : {});
  // black（委託）では 問いかけQ&A・関わり方チップを出さない（2026-07-31たきと指示・委託に該当ボックスが無いため）
  const qa = black ? [] : farmHostQa(profile);
  // 関わり方＝4問の回答チップ（HOST_STYLE_QUESTIONS・2026-08-14拡充）。black（委託）は従来どおり出さない
  const styleChips = black ? [] : hostStyleChips(profile);
  const okTrust = !!(trust && trust.ok);
  return (
    <div>
      {/* ヘッダー刷新（2026-08-03たきと指示）：アイコンを中央に、下に募集者の項目（氏名・住所・連絡先）を
          ラベル｜内容の行で表示。値は募集者の法定3項目（recruiter_*）＝求人詳細の農園紹介では
          job_employer_profile 経由でanonにはNULLで届く（訪問者には氏名（公開ニックネーム）以外出ない） */}
      <div style={{ marginBottom:12 }}>
        <div {...avatarTap} style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid " + AC, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", margin:"0 auto 12px", ...cur, ...(avatarTap.onClick ? { cursor:"pointer" } : {}) }}>
          <Avatar url={profile.avatar_url} name={profile.nickname} size={64} bg={black ? "#111111" : undefined} />
        </div>
        {avatarZoom && profile.avatar_url && <AvatarLightbox url={profile.avatar_url} onClose={()=>setAvatarZoom(false)} />}
        {/* 氏名の横にフリガナを（）付きで表示（2026-08-03たきと指示）。recruiter_name_kana は
            employer_profiles 直読みの画面は自動で載り、農園紹介は job_employer_profile が返す（anonはNULL） */}
        {/* ラベルは登録区分で出し分け（2026-08-14たきと指示）：個人＝氏名・住所／法人＝名称・所在地。
            区分は trust.entity_type（employer_trust_info が account_holders から返す）。
            届いていない間（キャッシュ更新前・trustなしの画面）は従来どおり個人表記に倒す */}
        {/* 4つ目＝マスク名（2026-08-17）。値が空でも maskedFields に載っていれば行を出して伏せ字を描く。
            氏名は訪問者にも表示名（nickname）が出るsoマスク対象にしない＝伏せ字と名前を二重に見せない */}
        {(() => { const corp = trust?.entity_type === "corporate"; return (
        [[corp ? "名称" : "氏名", (() => {
            const n = profile.recruiter_name || profile.nickname || "";
            const k = (profile.recruiter_name_kana || "").trim();
            return n ? (k ? `${n}（${k}）` : n) : "";
          })(), "nickname", null],
          [corp ? "所在地" : "住所", profile.recruiter_address, "recruiter", "recruiter_address"],
          ["連絡先", profile.recruiter_contact, "recruiter", "recruiter_contact"]]); })().map(([l, v, k, mk]) => {
          const hasValue = !!(v && String(v).trim());
          const masked = !hasValue && !!mk && Array.isArray(maskedFields) && maskedFields.includes(mk);
          return (hasValue || masked) ? (
          <Fragment key={l}>
            <div {...(masked ? {} : tap(k))} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:4, ...(masked ? {} : cur) }}>
              <span className="f-sans" style={{ flexShrink:0, width:56, fontSize:12, color:"#999", lineHeight:1.6 }}>{l}</span>
              {/* 行の判定はラベル文字でなくキーで（2026-08-14）：法人はラベルが「名称/所在地」に変わるため */}
              <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight: k === "nickname" ? 700 : 400, lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", minWidth:0 }}>
                {/* 説明の主語は「募集者の住所／連絡先」＝タップで出る案内が何の項目か分かるようにする */}
                {masked ? <MaskedText label={"募集者の" + l} chars={l === "連絡先" ? 6 : 8} /> : v}
              </span>
            </div>
            {/* 利用歴は氏名の直下（2026-08-07たきと指示）。✓連絡先確認済みは連絡先の直下へ移植
                （2026-08-14たきと指示）。連絡先の行が出ない画面（未設定の農家）だけ、従来どおり
                氏名の直下に出す（信頼の目印を消さない）。訪問者は伏せ字で連絡先の行が出るso連絡先の下。
                値の列（ラベル56px+gap10）に揃える */}
            {(() => {
              const contactRowShown = !!(profile.recruiter_contact && String(profile.recruiter_contact).trim())
                || (Array.isArray(maskedFields) && maskedFields.includes("recruiter_contact"));
              const showMember = k === "nickname" && trust?.member_since;
              const showChecked = trust?.id_checked && (contactRowShown ? l === "連絡先" : k === "nickname");
              if (!okTrust || (!showMember && !showChecked)) return null;
              return (
                <div style={{ display:"flex", flexWrap:"wrap", gap:10, margin:"0 0 4px", paddingLeft:66 }}>
                  {showMember && (
                    <span className="f-sans" style={{ fontSize:11, color:"#717171" }}>chitose-bank利用{trust.member_since}から</span>
                  )}
                  {showChecked && (
                    <span className="f-sans" style={{ fontSize:11, color:AC, fontWeight:600 }}><NavIconInline name="tick" size={11} style={{ verticalAlign:"-1.5px" }} />連絡先確認済み</span>
                  )}
                </div>
              );
            })()}
          </Fragment>
        ) : null; })}
      </div>
      {/* 削除（2026-08-24たきと指示）：
          ・「また働きたい×N」＝評価タブ（ReceivedReviews の肯定バッジ）と同じものが2箇所に出ていたので消した
          ・「求人内容との一致 N / M件」＝意味が伝わらないので消した（DB側 employer_trust_info の
            match_* の集計自体は残っている＝出し方を決め直したくなったらそこから描ける）
          ★消したのは表示だけ。規約 第8条2四（集計は件数にかかわらず表示・否定の件数を含む）は
            いま表示している集計が肯定だけになった＝次の改訂で文面を見直す候補（たきと判断待ち） */}
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
      {/* 利用歴・連絡先確認は氏名の直下（ヘッダー内）へ移動（2026-08-07たきと指示） */}
      {okTrust && trust.avg_approval_hours != null && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 10px" }}>承認までの時間：平均{trust.avg_approval_hours}時間</p>
      )}
      {/* 問いかけQ&A（うちの畑のユニークなところ等）もチャット形式（2026-08-07たきと指示・
          「就農するまで等の文言」と同じ扱い）。回答＝農家の言葉ので緑（blackテーマは黒）。
          編集モードは従来どおり領域タップで編集ボックス（tap("ask")のラッパーを維持） */}
      {/* 質問形式の要素は1つの群れに（2026-08-14たきと指示）：問いかけQ&A＋extraQa（紹介文のお題）を
          同じQaChatに合流＝視覚的なグループ分け。編集モードはextraQaが来ない（tap("ask")の役割は不変） */}
      {(() => {
        const qaAll = [...qa, ...(Array.isArray(extraQa) ? extraQa : [])];
        if (hideQa || qaAll.length === 0) return null;
        return (
          <div {...tap("ask")} style={{ marginTop:4, ...cur }}>
            <QaChat items={qaAll} accent={black ? "#111111" : "#00A86B"} style={{ marginTop:0 }} />
          </div>
        );
      })()}
      {/* タグは1箇所に集約（2026-07-27たきと指示）：やり取りの雰囲気・保険・待遇を1行に並べる。
          「🛡 保険の準備（自己申告）」の見出しは削除し、自己申告の注記だけタグ行の下に残す */}
      {(() => {
        const insChips = normalizeInsuranceItems(profile.insurance_items).map(k => INSURANCE_ITEMS.find(x => x.k === k)).filter(Boolean);
        const perks = Array.isArray(extraBadges) ? extraBadges : [];
        if (styleChips.length === 0 && insChips.length === 0 && perks.length === 0) return null;
        // タグ群の整理整頓（2026-08-07たきと指示・働き手カードと同じ手当て）：
        // 3種（🤝関わり方＝灰／🛡保険＝緑／待遇＝灰）を1つの群れにまとめ、チップの形を統一。
        // 各チップが行の余りを均等に吸収（flexGrow）＝右端まで揃った段組み。長い順で行を詰め、
        // はみ出しは…で省略。色の区別は不変（保険=緑が自己申告の目印）
        const chips = [
          ...styleChips.map((lbl, i) => ({ key:"style-" + i, label: lbl, icon: black ? null : "applicants", bg:"#F7F7F7", color:"#222", isStyle:true })),
          ...insChips.map(it => ({ key:"ins-" + it.k, label: it.chip, icon: black ? null : "shield", bg: black ? "#EEEEEE" : "#E6F7EF", color: black ? "#111111" : "#0B6B4F" })),
          ...perks.map(b => ({ key:"perk-" + b.label, label: b.label, icon: black ? null : (b.icon || null), emoji: black ? null : (b.emoji || null), bg:"#F7F7F7", color:"#222" })),
        ].sort((a,b) => String(b.label).length - String(a.label).length);
        return (
          <div style={{ marginTop:12 }}>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {chips.map(c => (
                <span key={c.key} {...(c.isStyle ? tap("style") : {})} className="f-sans"
                  style={{ flex:"1 1 auto", minWidth:0, textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:12, fontWeight:600, color:c.color, background:c.bg, borderRadius:999, padding:"6px 12px", ...(c.isStyle ? cur : {}) }}>{c.icon && <NavIconInline name={c.icon} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} />}{c.emoji ? c.emoji + " " : ""}{c.label}</span>
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
