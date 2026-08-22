// 農家のアクションページ（#/admin/farmer-pages・管理者専用・2026-08-11たきと指示）。
// 農家が最初から最後まで通る画面を、順序どおりに1枚ずつ展開する見本帳。
//
// ★2026-08-11たきと指示「すべて実際に稼働しているページやアニメーション、規格等を再現して」により、
//   似せて描くのをやめ、【本番の部品をそのまま使う】方式にした：
//   LFCropGrid／LFWizCard／LFPillSelect／LFCardBtn／Avatar／StatusRibbon（components/ui）、
//   JobCard、WorkerTrustCard、Celebration（本物の祝祭アニメ）、CROP_OPTIONS／TASK_OPTIONS／
//   APP_PHASE_LABEL・COLOR（lib/utils）。本番の見た目が変われば、この見本帳も自動で追従する。
//   本物の部品が無い画面だけ、本番のJSXから文言と規格（色・角丸・字送り）を写して組んである。
// ★読み取り専用：DBを読まない・書かない・保存も入力もしない（supabaseをimportしない）。
//   部品に渡すハンドラはすべて空＝押しても何も起きない（見るための画面）。
//   ＝「保存・入力機能の取り扱い」の管理者ゲート論点には非該当。
// ★中身（求人・働き手）はすべて架空。憲法3条「表示にダミー禁止」は利用者に見せる画面の規則で、
//   ここは運営だけが見る見本帳＝AdminBoxRegistryPageの「本番の見た目（サンプル題名）」と同じ扱い。
// ★下部バー（.app-header-mobile）と浮遊☰は、この画面だけ「戻る／次へ」に差し替える
//   （appStyles の body:has(.cb-farmer-walk-page) ＋ .cb-walk-bar）。
// ★1画面=STEPSの1要素。画面を足す・消す・並べ替えるのは STEPS だけを直す（他を壊さない）。
//   url は必ず実コードにgrepで当ててから書く（2026-08-11：旧#/roleを載せて旧遺物を指摘された）。
import { useState, useEffect } from "react";
import { AdminNav } from "./AdminNav";
import { LFWizCard, LFCropGrid, LFPillSelect, Avatar, StatusRibbon } from "../ui";
import { JobCard } from "../JobCard";
import { Celebration } from "../Celebration";
import { WorkerTrustCard } from "../TrustCards";
import { CROP_OPTIONS, TASK_OPTIONS, APP_PHASE_LABEL, APP_PHASE_COLOR, ROLE_GREEN, ROLE_ORANGE } from "../../lib/utils";

const INK = "#222", SUB = "#717171", LINE = "#EBEBEB", SOFT = "#F7F7F7";
const GREEN = "#00A86B", RED = "#E24B4A", AMBER = "#F5A623";
const noop = () => {};

/* LandingFlow の lfStyles を写経（本番の見出し・説明文の規格）。
   ★実物（features/jobs/create/lfStyles.js）を変えたら、ここも合わせること */
const lfStyles = {
  stepTitle: {
    fontSize:"clamp(26px, 3.2vw, 36px)", fontWeight:850, lineHeight:1.25,
    letterSpacing:"-0.035em", color:"#222", textAlign:"center", margin:"32px 0 10px",
  },
  subtitle: {
    fontSize:"clamp(16px, 1.6vw, 18px)", lineHeight:1.7, color:"#717171",
    textAlign:"center", margin:"0 auto 28px", maxWidth:520,
  },
};
/* 求人フローの本文枠（本番＝maxWidth 480・padding 20px の中央寄せ） */
function LFPage({ children }) {
  return <div style={{ maxWidth:480, margin:"0 auto", padding:"0 20px 24px" }}>{children}</div>;
}
/* 本番の入力欄（LandingFlow の LFWizCard 内で使われている形）を写経 */
function LFField({ label, value, ph, note }) {
  return (
    <div style={{ marginBottom:14 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:INK, margin:"0 0 6px" }}>{label}</p>
      <div className="f-sans" style={{ width:"100%", border:`1px solid ${LINE}`, borderRadius:10, padding:"12px 13px", fontSize:14, color: value ? INK : "#C0C0C0", background:"#fff", boxSizing:"border-box" }}>{value || ph}</div>
      {note && <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"6px 0 0", lineHeight:1.7 }}>{note}</p>}
    </div>
  );
}
/* 本番のボタン（.btn-primary＝黒／緑CTAはブランド色）。クラスは本番と同じものを当てる */
function LFNext({ children = "次へ" }) {
  return <span className="btn-primary f-sans" style={{ display:"inline-block", padding:"14px 40px", fontSize:15, fontWeight:700 }}>{children}</span>;
}
function Chip({ children, bg = SOFT, fg = SUB }) {
  return <span className="f-sans" style={{ display:"inline-block", padding:"3px 10px", borderRadius:9, fontSize:11, fontWeight:700, background:bg, color:fg }}>{children}</span>;
}
function Card({ children, style }) {
  return <div style={{ border:`1px solid ${LINE}`, borderRadius:16, padding:14, background:"#fff", ...style }}>{children}</div>;
}
function Row({ l, r, edit }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:10, padding:"9px 0", borderBottom:`1px solid ${SOFT}` }}>
      <span className="f-sans" style={{ fontSize:12, color:SUB, width:78, flexShrink:0 }}>{l}</span>
      <span className="f-sans" style={{ flex:1, fontSize:13, color:INK, fontWeight:600 }}>{r}</span>
      {edit && <span className="f-sans" style={{ fontSize:12, color:GREEN, fontWeight:700 }}>編集</span>}
    </div>
  );
}
function Btn({ children, kind = "primary" }) {
  const s = kind === "primary" ? { background:INK, color:"#fff", border:`1px solid ${INK}` }
    : kind === "green" ? { background:GREEN, color:"#fff", border:`1px solid ${GREEN}` }
    : kind === "danger" ? { background:"#fff", color:RED, border:`1px solid ${RED}` }
    : { background:"#fff", color:"#444", border:"1px solid #DDD" };
  return <span className="f-sans" style={{ display:"block", flex:1, textAlign:"center", padding:"12px 16px", borderRadius:14, fontSize:14, fontWeight:800, ...s }}>{children}</span>;
}
/* 本番の求人カード（作成中・公開中パネル）の正方形カードを写経＝写真が無ければ 📝／🌱 */
function JobTile({ label, icon, ribbon }) {
  return (
    <div style={{ background:"#fff", border:`1px solid ${LINE}`, borderRadius:12, overflow:"hidden" }}>
      <div style={{ position:"relative", aspectRatio:"1 / 1", background:SOFT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:36 }}>
        {icon}
        {ribbon && <StatusRibbon label={ribbon} color="#0E8A6B" />}
      </div>
      <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:INK, margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</p>
    </div>
  );
}
function PhaseChip({ k }) {
  return <span className="f-sans" style={{ display:"inline-block", fontSize:11, fontWeight:700, color:"#fff", background:APP_PHASE_COLOR[k], borderRadius:6, padding:"3px 9px" }}>{APP_PHASE_LABEL[k]}</span>;
}
function Msg({ me, children, name }) {
  return (
    <div style={{ display:"flex", justifyContent: me ? "flex-end" : "flex-start", marginBottom:8 }}>
      <div style={{ maxWidth:"78%" }}>
        {!me && name && <p className="f-sans" style={{ fontSize:10, color:SUB, margin:"0 0 3px" }}>{name}</p>}
        <div className="f-sans" style={{ padding:"9px 12px", borderRadius:14, fontSize:13, lineHeight:1.7,
          background: me ? GREEN : "#fff", color: me ? "#fff" : INK, border: me ? "none" : `1px solid ${LINE}` }}>{children}</div>
      </div>
    </div>
  );
}
/* 本番の祝祭アニメを実際に再生するボタン（Celebrationは全画面・自動で終わる） */
function PlayBtn({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="f-sans"
      style={{ display:"block", width:"100%", padding:"13px 16px", borderRadius:14, border:`1px solid ${INK}`, background:INK, color:"#fff", fontSize:14, fontWeight:800, cursor:"pointer" }}>{children}</button>
  );
}

/* ── 架空の見本データ（本物の部品にそのまま渡す形） ─────────────────────────
   写真は置かない＝本番の「写真が無い求人」の見え方（作物アイコン）がそのまま出る。
   偽の写真を作らない（憲法3条の精神） */
const SAMPLE_JOB = {
  id: 1200, crop:"ブロッコリー", task:"収穫", region:"徳島県吉野川市山川町",
  payType:"daily", pay: 9000, photos: [],
  dateStartRaw:"2026-09-10", dateEndRaw:"2026-09-14",
  isNew: true, beginnerOk: true,
};
const SAMPLE_WORKER = {
  nickname:"はなこ", residence_city:"吉野川市", transport:"車",
  farm_experience:"経験あり", physical_level:"どちらでも",
  experience_entries:[{ crop:"みかん", task:"収穫", duration:"10日ほど" }],
  experienced_tasks:["収穫","選果"], interests:["音楽","料理"], languages:["日本語"],
  self_declared:[],
  pr:"吉野川市に住んでいます。朝はやい仕事が得意です。去年みかんの収穫を手伝って、外での作業が好きになりました。よろしくおねがいします。",
};
const SAMPLE_TRUST = { joined_at:"2026-05-01T00:00:00Z", verified_at:"2026-05-02T00:00:00Z" };

/* ── 農家が通る画面（順序どおり）───────────────────────────────────────────
   ch=章 / name=画面名 / url=本番のURL（実コードで実在を確認済み） / act=その画面で農家がする動作 /
   body(api)=見本の中身。api.play(title)＝本物の祝祭アニメを再生（絵は渡さない・2026-08-19） */
const STEPS = [
  /* ═══ 準備（アカウント）═══ */
  /* 玄関は素通りになった（2026-08-17・同意画面の撤去）。QRの着地点として章には残すが、
     見本は「何も出ずにそのまま求人一覧へ進む」という実際の見え方にする（偽の画面を描かない） */
  { ch:"準備", name:"玄関", url:"#/visit", act:"印刷物のQRを読む。同意画面などは挟まらず、そのまま求人一覧に着く。",
    body: () => (
      <div style={{ padding:"44px 18px", textAlign:"center" }}>
        <p className="f-sans" style={{ fontSize:26, fontWeight:800, color:INK, margin:"0 0 10px" }}>chitose-bank</p>
        <p className="f-sans" style={{ fontSize:13, color:SUB, lineHeight:1.9, margin:0 }}>
          画面は出ない。QRの着地点で、そのまま次の「さがす」へ進む。<br />
          利用規約・プライバシーポリシーはフッターからいつでも読める。
        </p>
      </div>
    ) },
  { ch:"準備", name:"さがす", url:"#/search", act:"訪問者として求人を見る。町域・番地・募集主は伏せられ、地図もおおまかな位置だけになる。",
    body: () => (
      <div style={{ padding:14 }}>
        {/* 本番の求人カードそのもの（components/JobCard） */}
        <JobCard job={SAMPLE_JOB} variant="list" saved={false} onToggleSave={noop} onOpen={noop} />
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:4 }}>
          ※ 写真のある求人はここに写真が出る。写真の無い求人は、この見本のように作物のアイコンになる。
        </p>
      </div>
    ) },
  { ch:"準備", name:"ログイン", url:"#/login", act:"メールアドレスを入れて、届いた6桁の認証コードでログインする。",
    body: () => (
      <div style={{ padding:"26px 18px" }}>
        <p className="f-sans" style={{ fontSize:24, fontWeight:800, color:INK, textAlign:"center", margin:"0 0 22px" }}>chitose-bank</p>
        <LFField label="メールアドレス" value="chitose@example.com" />
        <LFField label="認証コード（6桁）" value="" ph="123456" note="有効期限：10分" />
        <span className="btn-primary f-sans" style={{ display:"block", textAlign:"center", padding:14, fontSize:15, fontWeight:700, borderRadius:14 }}>ログイン</span>
      </div>
    ) },
  { ch:"準備", name:"本人情報の登録", url:"#/account", act:"区分・氏名・生年月日・住所・連絡先を入れて、規約とプラポリに同意する（1回だけ）。終わると さがす に戻る。",
    body: () => (
      <div style={{ padding:"22px 16px" }}>
        <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:INK, margin:"0 0 16px" }}>新規登録：本人情報の入力</p>
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px" }}>区分</p>
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          <span className="f-sans" style={{ flex:1, textAlign:"center", padding:"11px 0", borderRadius:12, border:`2px solid ${GREEN}`, background:"#E6F7EF", color:GREEN, fontSize:14, fontWeight:800 }}>個人</span>
          <span className="f-sans" style={{ flex:1, textAlign:"center", padding:"11px 0", borderRadius:12, border:`1px solid ${LINE}`, background:"#fff", color:"#999", fontSize:14, fontWeight:600 }}>法人</span>
        </div>
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px" }}>本人情報</p>
        <LFField label="お名前" value="福井 千歳" />
        <LFField label="生年月日" value="1958 / 4 / 12" note="18歳未満は登録できません" />
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"6px 0 8px" }}>送達先</p>
        <LFField label="郵便番号" value="776-0010" />
        <LFField label="番地・建物名" value="字前川 12-3" />
        <p className="f-sans" style={{ fontSize:13, color:INK, lineHeight:1.9, margin:"4px 0 12px" }}>☑ 利用規約・プライバシーポリシーに同意します</p>
        <span className="btn-primary f-sans" style={{ display:"block", textAlign:"center", padding:14, fontSize:15, fontWeight:700, borderRadius:14 }}>登録する</span>
      </div>
    ) },
  /* 旧「役割をえらぶ（#/role）」は実装から消えているので置かない（2026-08-11たきと指摘・コードで確認）。
     いまは、認証は役割を聞かず、どのプロフィールを作ったかで役割が決まる（骨格⑥）＝この画面が実物 */
  { ch:"準備", name:"農家をはじめる", url:"#/profile/worker → #/profile/employer", act:"プロフィール入口の浮遊ボタン「🌱 農家を作る」で、雇い手の顔に切り替える。登録の時点では役割を聞かれない。",
    body: () => (
      <div style={{ padding:14, position:"relative", minHeight:260 }}>
        <Card style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, borderColor:ROLE_ORANGE }}>
          <Avatar url={null} name="ちとせ" size={48} ring={ROLE_ORANGE} />
          <div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:0 }}>ちとせ</p>
            <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"3px 0 0" }}>働き手のプロフィール</p>
          </div>
        </Card>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {[["🔍","さがす"],["📮","応募中"],["❤️","いいね"]].map(([e, l]) => (
            <div key={l} style={{ border:`1px solid ${LINE}`, borderRadius:16, padding:"16px 6px 12px", textAlign:"center", background:"#fff" }}>
              <div style={{ fontSize:22 }}>{e}</div>
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 0" }}>{l}</p>
            </div>
          ))}
        </div>
        {/* 本番の浮遊トグル（.profile-employer-fab）の見た目・文言そのまま */}
        <div style={{ position:"absolute", right:14, bottom:14 }}>
          <span className="f-sans" style={{ display:"inline-block", padding:"12px 24px", borderRadius:24, background:ROLE_GREEN, color:"#fff", fontSize:17, fontWeight:700, boxShadow:"0 4px 12px rgba(0,0,0,.18)" }}>🌱 農家を作る</span>
        </div>
      </div>
    ) },
  { ch:"準備", name:"雇い手プロフィール", url:"#/profile/employer/profile", act:"農園名・写真・待遇・保険・緊急連絡先を埋める。働き手はここを見て応募を決める。未入力の数がバッジに出る。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, borderColor:ROLE_GREEN }}>
          <Avatar url={null} name="千歳ファーム" size={52} ring={ROLE_GREEN} />
          <div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:0 }}>千歳ファーム</p>
            <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"3px 0 0" }}>吉野川市 ・ 就農16年目</p>
          </div>
        </Card>
        {[["👤 氏名・農園名","入力済み"],["📍 所在地","入力済み"],["📞 連絡先","入力済み"],["🎁 待遇","あと1つ"],["🛡 保険","入力済み"],["🆘 緊急連絡先","未入力"]].map(([l, r]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 2px", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:INK }}>{l}</span>
            <Chip bg={r === "入力済み" ? "#E6F7EF" : "#FFF4E0"} fg={r === "入力済み" ? GREEN : "#C77700"}>{r}</Chip>
          </div>
        ))}
      </div>
    ) },

  /* ═══ 求人をつくる（#/work/new/{step}）═══ */
  { ch:"求人をつくる", name:"はじめの説明", url:"#/work/new", act:"求人づくりの入口。ここから基本情報を6つ、ひとつずつ聞かれる。",
    body: () => (
      <div style={{ padding:"30px 20px 24px" }}>
        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:INK, margin:"0 0 8px" }}>ステップ1</p>
        <h1 className="f-sans" style={{ fontSize:"clamp(28px, 6vw, 38px)", fontWeight:800, color:INK, lineHeight:1.25, margin:"0 0 20px" }}>まず、基本情報から</h1>
        <p className="f-sans" style={{ fontSize:16, color:INK, lineHeight:1.7, margin:"0 0 24px" }}>求人に欠かせない情報を入力します。作物、作業内容、場所、日程、採用人数、報酬の6つを、ひとつずつうかがいます。</p>
        <div style={{ textAlign:"right" }}><LFNext /></div>
      </div>
    ) },
  { ch:"求人をつくる", name:"作物", url:"#/work/new/1", act:"作物を選ぶ。一覧は50種類＋「その他」で自由入力。選ぶと緑の枠が付く。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>作物を選んでください</h2>
        <p className="f-sans" style={lfStyles.subtitle}>募集する求人の作物を選びます。一覧にない場合は「その他」から入力できます。</p>
        {/* 本番の部品そのもの＝作物の並び・アイコン・選択の色が本番と必ず一致する */}
        <LFCropGrid options={CROP_OPTIONS} value="ブロッコリー" onSelect={noop} otherText="" onOtherChange={noop} otherPlaceholder="作物名を入力（例：ブロッコリー）" />
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"作業", url:"#/work/new/2", act:"作業内容を選ぶ。作物と同じカード格子。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>作業内容を選んでください</h2>
        <p className="f-sans" style={lfStyles.subtitle}>募集する作業を選びます。一覧にない場合は「その他」から入力できます。</p>
        <LFCropGrid options={TASK_OPTIONS} noIcon value="収穫" onSelect={noop} otherText="" onOtherChange={noop} otherPlaceholder="作業名を入力（例：畝立て、マルチ張り）" />
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"場所", url:"#/work/new/3", act:"郵便番号から住所を呼び出し、町域・番地まで入れる。5欄すべて必須。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>集合場所を入力してください</h2>
        <LFWizCard>
          <LFField label="郵便番号" value="776-0010" note="・郵便番号を入れると、都道府県・市区町村は自動で入ります。違っているときは郵便番号を直してください" />
          <LFField label="都道府県" value="徳島県" />
          <LFField label="市区町村" value="吉野川市" />
          <LFField label="町域" value="山川町忌部" />
          <LFField label="番地・建物名" value="字前川 12-3" />
          <p className="f-sans" style={{ fontSize:14, color:AMBER, marginTop:4 }}>すべての住所欄を入力してください</p>
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"採用人数と作業日程", url:"#/work/new/4", act:"人数を入れ、カレンダーで開始日と終了日をタップする。休みの日は外せる。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>採用人数と作業日程を入力してください</h2>
        <LFWizCard>
          <LFField label="採用人数" value="3人" />
          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:INK, margin:"6px 0 10px" }}>2026年 9月</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {["日","月","火","水","木","金","土"].map(d => <div key={d} className="f-sans" style={{ textAlign:"center", fontSize:11, color:SUB }}>{d}</div>)}
            {Array.from({ length:21 }, (_, i) => i + 1).map(d => {
              const sel = d >= 10 && d <= 14, off = d === 13;
              return (
                <div key={d} className="f-sans" style={{ textAlign:"center", padding:"8px 0", borderRadius:8, fontSize:12, fontWeight: sel ? 800 : 500,
                  background: sel && !off ? GREEN : "transparent", color: off ? "#C0C0C0" : sel ? "#fff" : INK, textDecoration: off ? "line-through" : "none" }}>{d}</div>
              );
            })}
          </div>
          <p className="f-sans" style={{ fontSize:13, color:SUB, margin:"12px 0 0" }}>終了日を選ばない場合は1日募集になります。</p>
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"勤務条件", url:"#/work/new/5", act:"時間・休憩・時間外・報酬を入れる。最低賃金を下回ると先へ進めない。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>勤務条件を入力してください</h2>
        <LFWizCard>
          <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>開始時間と終了時間を選んでください。</p>
          <LFField label="勤務時間" value="8:00 〜 16:00" />
          <LFField label="休憩時間" value="60分" />
          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:INK, margin:"0 0 8px" }}>時間外労働</p>
          <LFPillSelect options={["あり","なし"]} value="あり" onSelect={noop} />
          <LFField label="どれくらいの時間か" value="30分ほど" />
          <LFField label="日給" value="9,000円" />
          <p className="f-sans" style={{ fontSize:13, color:GREEN, fontWeight:700, margin:0 }}>実働7時間で時給1,285円。徳島県の最低賃金1,046円を上回っています。</p>
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"ここからは任意", url:"#/work/new/6", act:"必須はここまで。以降は飛ばしても掲載できる。",
    body: () => (
      <div style={{ padding:"30px 20px 24px" }}>
        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:INK, margin:"0 0 8px" }}>ステップ2</p>
        <h1 className="f-sans" style={{ fontSize:"clamp(28px, 6vw, 38px)", fontWeight:800, color:INK, lineHeight:1.25, margin:"0 0 20px" }}>ここからは任意です</h1>
        <p className="f-sans" style={{ fontSize:16, color:INK, lineHeight:1.7, margin:"0 0 24px" }}>ここから先は、入力しなくても求人を出せます。ですが、写真や作業の詳しい説明、勤務条件などを加えると、働き手が「ここで働きたい」と感じやすくなります。あなたの求人を、もっと魅力的にしましょう。</p>
        <div style={{ textAlign:"right" }}><LFNext /></div>
      </div>
    ) },
  { ch:"求人をつくる", name:"写真", url:"#/work/new/7", act:"畑や作業の写真をのせる（最大10枚）。1枚目がカードの顔になる。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>写真を追加してください</h2>
        <p className="f-sans" style={lfStyles.subtitle}>1枚目が、さがす一覧に大きく出ます。あとから足すこともできます。</p>
        <LFWizCard>
          <div style={{ height:150, borderRadius:12, border:"1.5px dashed #CCC", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6 }}>
            <span style={{ fontSize:30 }}>📷</span>
            <span className="f-sans" style={{ fontSize:13, color:SUB, fontWeight:700 }}>＋ 写真を追加</span>
          </div>
          <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"10px 0 0" }}>0 / 10枚</p>
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"作業の説明", url:"#/work/new/8", act:"当日の流れを自由に書く。写真を選ぶと、その写真ごとの説明も書ける。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>作業の説明を入力してください</h2>
        <LFWizCard>
          <div className="f-sans" style={{ border:`1px solid ${LINE}`, borderRadius:10, padding:12, fontSize:14, color:INK, lineHeight:1.9, minHeight:110 }}>
            朝8時に畑に集合して、ブロッコリーを一つずつ切って、コンテナに入れていきます。慣れれば難しくありません。<br />お昼は12時から1時間、休憩小屋で休みます。
          </div>
          <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"8px 0 0" }}>写真を選ぶと、その写真の説明を書けます。</p>
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"危険な場所・作業", url:"#/work/new/9", act:"危ないところを正直に伝える。写真も付けられる。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>危険な場所・作業を入力してください</h2>
        <LFWizCard>
          <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な場所があれば入力してください。</p>
          <LFField label="場所" value="用水路のふち" />
          <LFField label="内容" value="畑の北側に深さ1mの用水路があります。柵はありません。" />
          <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", margin:"14px 0 8px" }}>働き手に事前に知らせたい危険な作業があれば入力してください。</p>
          <LFField label="作業" value="収穫ナイフ" />
          <LFField label="内容" value="よく切れます。手袋をお渡しします。" />
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"働き手への希望", url:"#/work/new/10", act:"持ち物・注意事項・求める経験を書く（すべて任意）。",
    body: () => (
      <LFPage>
        <h2 className="f-sans" style={lfStyles.stepTitle}>働き手への希望を入力してください</h2>
        <p className="f-sans" style={lfStyles.subtitle}>持ち物や注意事項、求める経験など、働き手に伝えておきたいことを入力できます。作業に必要な道具や安全への備えは、受け入れる農家側でご用意・ご対応ください。（すべて任意です）</p>
        <LFWizCard>
          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:INK, margin:"0 0 8px" }}>必要な経験</p>
          <LFPillSelect options={["未経験OK","少し経験があると助かる","経験者のみ"]} value="未経験OK" onSelect={noop} />
          <LFField label="持ち物" value="長靴、帽子、飲みもの" />
          <LFField label="注意事項" value="雨の日は前日の夕方に中止のご連絡をします。" />
        </LFWizCard>
      </LFPage>
    ) },
  { ch:"求人をつくる", name:"確認", url:"#/work/new/11", act:"働き手に見える姿をそのまま確かめる。行ごとに直せる。写真は横スワイプで見る。",
    body: () => (
      <div style={{ padding:0 }}>
        <div style={{ height:150, background:SOFT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48 }}>🥦</div>
        <div style={{ padding:16 }}>
          <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, textAlign:"center", margin:"0 0 14px" }}>掲載イメージを確認してください</p>
          <p className="f-sans" style={{ fontSize:17, fontWeight:600, color:INK, margin:0 }}>ブロッコリー 収穫</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, margin:"4px 0 12px" }}>徳島県吉野川市山川町忌部 字前川12-3</p>
          <Card style={{ padding:"2px 12px" }}>
            <Row l="日程" r="9/10（木）〜9/14（月）" edit />
            <Row l="勤務時間" r="8:00〜16:00（休憩60分）" edit />
            <Row l="採用人数" r="3人" edit />
            <Row l="報酬" r="日給 9,000円" edit />
            <Row l="時間外" r="あり（30分ほど）" edit />
          </Card>
        </div>
      </div>
    ) },

  /* ═══ 掲載する ═══ */
  { ch:"掲載する", name:"掲載前のチェック", url:"#/work/new/11", act:"下からせり上がるシートで確認に同意する。ここが掲載の記録になる。足りない欄があれば、その入力ページへ送られる。",
    body: () => (
      <div style={{ padding:0, position:"relative", minHeight:320, background:"rgba(0,0,0,0.45)" }}>
        <div className="cb-sheet-up" style={{ position:"absolute", left:10, right:10, bottom:10, background:"#fff", borderRadius:20, padding:16, boxShadow:"0 -6px 24px rgba(0,0,0,0.18)" }}>
          <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:"0 0 12px" }}>掲載する前に、ご確認ください</p>
          {["書いた条件で、そのとおりに働いてもらいます","最低賃金を下回っていません","危ないところは正直に書きました","働き手の安全に配慮します"].map(t => (
            <p key={t} className="f-sans" style={{ fontSize:13, color:INK, lineHeight:1.9, margin:"0 0 6px" }}>☑ {t}</p>
          ))}
          <div style={{ marginTop:12 }}><Btn kind="green">同意して掲載する</Btn></div>
        </div>
      </div>
    ) },
  { ch:"掲載する", name:"掲載しました（祝祭）", url:"#/profile/employer", act:"完了ページではなく祝祭の演出が出て、自分の求人の場所に着地する。60秒何もしなければ さがす に移る。",
    body: (api) => (
      <div style={{ padding:18 }}>
        <p className="f-sans" style={{ fontSize:13, color:SUB, lineHeight:1.9, margin:"0 0 14px" }}>
          本番と同じ演出（components/Celebration）をそのまま再生します。暗幕 → 打ち上げの尾 → 閃光 → 菊の光条 → 特大の押印と画面の揺れ → 追い花火 → 幕引き。約3秒で自動的に終わります（音と振動も本番と同じ）。
        </p>
        <PlayBtn onClick={() => api.play("公開しました！")}>▶ 掲載の祝祭を再生する</PlayBtn>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:12 }}>
          即公開（運営本人の自己募集）は「🎉 公開しました！」、一般農家は「🌱 求人ができました！」になります。
        </p>
      </div>
    ) },
  { ch:"掲載する", name:"自分の求人", url:"#/profile/employer/drafts ／ /active", act:"作成中と公開中を上のタブで行き来する。指でも横に送れる。掲載は即公開（2026-08-14承認プロセス削除）。公開の処理が完了しなかった求人にだけ「公開間近」の帯が付く（運営が開く救済経路）。",
    body: () => (
      <div style={{ padding:14 }}>
        <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
          <span className="f-sans" style={{ flex:1, textAlign:"center", padding:"11px 0", borderRadius:12, border:`2px solid ${INK}`, background:"#fff", fontSize:14, fontWeight:800, color:INK }}>作成中（2）</span>
          <span className="f-sans" style={{ flex:1, textAlign:"center", padding:"11px 0", borderRadius:12, border:`1px solid ${LINE}`, background:"#fff", fontSize:14, fontWeight:600, color:"#999" }}>公開中（1）</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          <JobTile label="ブロッコリー 収穫" icon="🌱" ribbon="公開間近" />
          <JobTile label="レタス 定植" icon="📝" />
          <JobTile label="無題の求人" icon="📝" />
        </div>
      </div>
    ) },

  /* ═══ 応募がくる ═══ */
  { ch:"応募がくる", name:"新着の応募", url:"#/new-applicants", act:"応募が届くと、サイトを開いた最初にこの画面に着地する。花びらが舞う。",
    body: () => (
      <div style={{ padding:14 }}>
        <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:INK, textAlign:"center", margin:"0 0 6px" }}>🎉 1件の応募が届きました</p>
        <p className="f-sans" style={{ fontSize:13, color:SUB, textAlign:"center", lineHeight:1.8, margin:"0 0 16px" }}>応募者を見て、承認するか見送るかを決めてください。<br />承認すると、チャットで面接に進めます。</p>
        <Card style={{ padding:10 }}>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ width:66, height:88, borderRadius:10, background:SOFT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>🥦</div>
            <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5 }}>
              <PhaseChip k="applied" />
              <span className="f-sans" style={{ fontSize:11, color:"#999" }}>9/8 10:24 に届きました</span>
              <span className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.6 }}>📅 9/10・9/11・9/12<br />🕒 8:00〜16:00</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:10 }}><Btn>内容を見て決める</Btn></div>
        </Card>
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#999", textAlign:"center", textDecoration:"underline", marginTop:18 }}>あとで見る</p>
      </div>
    ) },
  { ch:"応募がくる", name:"応募者", url:"#/profile/employer/applicants", act:"応募者の信頼カードを見て、承認するか見送るかを決める。上の帯で段階を絞り込める。",
    body: () => (
      <div style={{ padding:14 }}>
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          {["すべて","応募中","面接中","採用","作業中"].map((t, i) => (
            <span key={t} className="f-sans" style={{ padding:"6px 11px", borderRadius:18, fontSize:11, fontWeight:700, border: i === 1 ? `2px solid ${INK}` : `1px solid ${LINE}`, color: i === 1 ? INK : SUB, background:"#fff" }}>{t}</span>
          ))}
        </div>
        <Card>
          <div style={{ marginBottom:10 }}><PhaseChip k="applied" /></div>
          {/* 本番の信頼カードそのもの（components/TrustCards）＝公開してよい項目の唯一のソース */}
          <WorkerTrustCard profile={SAMPLE_WORKER} trust={SAMPLE_TRUST} />
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <Btn kind="green">承認する</Btn>
            <Btn kind="ghost">見送る</Btn>
          </div>
        </Card>
      </div>
    ) },
  { ch:"応募がくる", name:"チャット", url:"#/chat/{応募id}", act:"働き手と直接やりとりする。上に求人の箱が出て、段階が分かる。メッセージは消せない（記録）。",
    body: () => (
      <div style={{ background:SOFT, minHeight:300 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 14px", borderBottom:`1px solid ${LINE}`, background:"#fff" }}>
          <span style={{ fontSize:15, color:SUB }}>←</span>
          <span className="f-sans" style={{ flex:1, fontSize:14, fontWeight:800, color:INK }}>はなこ さん</span>
          <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:SUB }}>報告</span>
        </div>
        <div style={{ padding:"8px 10px", background:"#fff", borderBottom:`1px solid ${LINE}` }}>
          <div style={{ border:`1px solid ${LINE}`, borderRadius:12, padding:"7px 10px" }}>
            <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:INK, margin:"0 0 4px" }}>#1200 ブロッコリー 収穫</p>
            <PhaseChip k="interview" />
          </div>
        </div>
        <div style={{ padding:12 }}>
          <Msg name="ちとせ銀行">はなこ さんの応募を承認しました。打ち合わせをすすめましょう。</Msg>
          <Msg me>農作業の経験はありますか？</Msg>
          <Msg name="はなこ">去年、みかんの収穫を10日ほど手伝いました。ブロッコリーははじめてです。</Msg>
          <Msg me>大丈夫です。当日その場でお教えします。</Msg>
        </div>
      </div>
    ) },
  { ch:"応募がくる", name:"採用する（祝祭）", url:"#/calendar/todo/hire", act:"🤝で最終確認。日程が重なると警告が出る。OKで採用が決まり、契約の内容が記録に凍結される。",
    body: (api) => (
      <div style={{ padding:14 }}>
        <Card style={{ display:"flex", padding:0, overflow:"hidden", marginBottom:12 }}>
          <div style={{ flex:1, height:92, background:SOFT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30 }}>🥦</div>
          <div style={{ flex:1, padding:"12px 6px", textAlign:"center" }}>
            <Avatar url={null} name="はなこ" size={36} ring={ROLE_ORANGE} />
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 3px" }}>はなこ さん</p>
            <PhaseChip k="interview" />
          </div>
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", borderLeft:`1px solid ${LINE}`, fontSize:26 }}>🤝</div>
        </Card>
        <Card style={{ borderColor:INK, borderWidth:2, marginBottom:12 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:"0 0 8px" }}>はなこ さんを採用しますか？</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>9月10日〜12日 ・ 日給9,000円<br />契約が成立すると、お互いの本名が表示されます（雇用の法定手続きのため）。</p>
          <div style={{ display:"flex" }}><Btn kind="green">OK・採用する</Btn></div>
        </Card>
        <PlayBtn onClick={() => api.play("採用しました")}>▶ 採用の祝祭を再生する</PlayBtn>
      </div>
    ) },

  /* ═══ 仕事の当日 ═══ */
  { ch:"仕事の当日", name:"今日", url:"#/calendar", act:"やることが並ぶ。最優先の1件は「いま これだけ」として上に大きく出る。空の箱も押せて、説明が出る。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card style={{ borderColor:GREEN, borderWidth:2, marginBottom:16 }}>
          <span className="f-sans" style={{ display:"block", fontSize:12, fontWeight:800, color:GREEN, letterSpacing:".08em" }}>いま これだけ</span>
          <p className="f-sans" style={{ fontSize:24, margin:"8px 0 0" }}>✓</p>
          <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:"6px 0 4px" }}>作業の開始を確認</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, margin:0, lineHeight:1.8 }}>はなこ さんが来ているか確かめて、開始を記録します。</p>
        </Card>
        <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:SUB, margin:"0 0 8px" }}>やること</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {/* 実物に追従（2026-08-19）：📅カレンダーの箱は削除／👤は「プロフィール入力」に改称し常設 */}
          {[["👤","プロフィール入力",1],["🤝","採用する"],["🛡","保険の準備の報告",1],["✓","作業の開始を確認",1],["✅","バイトの評価"],["⚠️","緊急連絡"]].map(([e, l, n]) => (
            <div key={l} style={{ position:"relative", border:`1px solid ${LINE}`, borderRadius:16, padding:"16px 6px 12px", textAlign:"center", background:"#fff", opacity: n ? 1 : 0.45 }}>
              <div style={{ fontSize:22 }}>{e}</div>
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 0", lineHeight:1.4 }}>{l}</p>
              {n ? <span className="f-sans" style={{ position:"absolute", top:8, right:8, minWidth:18, padding:"1px 5px", borderRadius:9, background:GREEN, color:"#fff", fontSize:10, fontWeight:800 }}>{n}</span> : null}
            </div>
          ))}
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:12 }}>薄い箱は「いま用事が無い」の目印。押すと用件の説明が出る（押せない箱は無い）。</p>
      </div>
    ) },
  { ch:"仕事の当日", name:"保険の準備の報告", url:"#/calendar/todo/insurance", act:"保険の備えができたと報告する。働き手にも伝わる。",
    body: () => (
      <div style={{ padding:14 }}>
        <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:INK, margin:"0 0 6px" }}>保険の準備の報告</p>
        <p className="f-sans" style={{ fontSize:13, color:SUB, lineHeight:1.8, margin:"0 0 12px" }}>事故が起きたときの備えです。働き手にも「準備できました」と伝わります。</p>
        <Card>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 8px" }}>はなこ さん ・ 9月10日〜</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>🛡 農作業中の傷害保険に加入しています</p>
          <div style={{ display:"flex" }}><Btn kind="green">準備したと報告</Btn></div>
        </Card>
      </div>
    ) },
  { ch:"仕事の当日", name:"きょうの仕事", url:"#/calendar", act:"当日の仕事を見る。開始の記録は作業開始時刻を過ぎると自動で入る（誰も時刻を押さない）。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <Avatar url={null} name="はなこ" size={40} ring={ROLE_ORANGE} />
            <div>
              <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:"0 0 4px" }}>はなこ さん</p>
              <PhaseChip k="working" />
            </div>
          </div>
          <div style={{ background:SOFT, borderRadius:12, padding:"10px 12px" }}>
            <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:0 }}>予定 8:00 開始<br />8:00 に自動で作業中になりました</p>
          </div>
        </Card>
      </div>
    ) },
  { ch:"仕事の当日", name:"緊急連絡", url:"#/calendar/todo/t_emergency", act:"当日の急な連絡をする窓口。採用が決まった仕事から使える。相手の緊急連絡先も採用後だけ見える。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card style={{ display:"flex", padding:0, overflow:"hidden", marginBottom:12 }}>
          <div style={{ flex:1, height:98, background:SOFT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30 }}>🥦</div>
          <div style={{ flex:1, padding:"14px 6px", textAlign:"center" }}>
            <Avatar url={null} name="はなこ" size={38} ring={ROLE_ORANGE} />
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 3px" }}>はなこ さん</p>
            <PhaseChip k="working" />
          </div>
        </Card>
        <div style={{ display:"flex" }}><Btn kind="danger">⚠️ 緊急連絡</Btn></div>
        <p className="f-sans" style={{ fontSize:11, color:SUB, lineHeight:1.8, marginTop:10 }}>相手の緊急連絡先は、採用が決まったあとにだけ表示されます。</p>
      </div>
    ) },

  /* ═══ 完了と評価 ═══ */
  { ch:"完了と評価", name:"バイトの評価", url:"#/calendar/todo/complete", act:"作業が終わったことを記録する。来なかった場合もここで記録する。",
    body: () => (
      <div style={{ padding:14 }}>
        <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:INK, margin:"0 0 6px" }}>作業は終わりましたか？</p>
        <p className="f-sans" style={{ fontSize:13, color:SUB, lineHeight:1.8, margin:"0 0 12px" }}>記録すると、働き手に「おつかれさまでした」が届きます。</p>
        <Card>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 6px" }}>はなこ さん ・ 9月10日</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>8:00 開始 ・ 16:10 終了</p>
          <div style={{ display:"flex", gap:8 }}>
            <Btn kind="green">完了として記録</Btn>
            <Btn kind="ghost">来ませんでした</Btn>
          </div>
        </Card>
      </div>
    ) },
  { ch:"完了と評価", name:"評価を送る", url:"#/profile/employer/applicants", act:"あてはまる項目を選ぶ（点数は付けない）。よかった項目だけが相手に見える。ひとことは運営の確認後に公開される。",
    body: () => (
      <div style={{ padding:14 }}>
        <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:INK, margin:"0 0 6px" }}>はなこ さんはいかがでしたか？</p>
        <p className="f-sans" style={{ fontSize:13, color:SUB, lineHeight:1.8, margin:"0 0 12px" }}>点数はつけません。あてはまるものを選ぶだけです。</p>
        {["時間どおりに来てくれた","説明したとおりにできた","安全に気をつけていた","また呼びたい"].map(t => (
          <div key={t} style={{ display:"flex", gap:9, padding:"10px 0", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, color:GREEN }}>☑</span>
            <span className="f-sans" style={{ fontSize:13, color:INK }}>{t}</span>
          </div>
        ))}
        <div style={{ marginTop:12 }}>
          <LFField label="ひとこと（運営が確認してから公開されます）" value="はじめてとは思えないほど丁寧でした。" />
          <div style={{ display:"flex" }}><Btn kind="green">評価を送る</Btn></div>
        </div>
      </div>
    ) },
  { ch:"完了と評価", name:"はたらいた記録", url:"#/profile/employer/applicants", act:"応募を受けた働き手の、記録から導いた事実だけを見る（点数・順位・おすすめ度は作らない）。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:"0 0 10px" }}>はなこ さんの はたらいた記録</p>
          <Row l="働いた回数" r="13回" />
          <Row l="合計の時間" r="91時間" />
          <Row l="欠勤" r="0回" />
          <Row l="直近5件の遅刻" r="0回" />
          <div style={{ marginTop:10 }}>
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:SUB, margin:"0 0 6px" }}>作物別</p>
            <p className="f-sans" style={{ fontSize:12, color:INK, lineHeight:1.9, margin:0 }}>ブロッコリー 6回 ・ みかん 4回 ・ レタス 3回</p>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:12 }}>どの農園で働いたかは表示されません（求人No.は運営と本人にだけ出ます）。</p>
        </Card>
      </div>
    ) },

  /* ═══ ふだんの道具 ═══ */
  { ch:"ふだんの道具", name:"カレンダー", url:"#/profile/employer/calendar", act:"自分の求人と、決まった働き手の予定を月で見る。役割で色が分かれる。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card style={{ padding:12, marginBottom:12 }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:INK, margin:"0 0 10px" }}>2026年 9月</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {["日","月","火","水","木","金","土"].map(d => <div key={d} className="f-sans" style={{ textAlign:"center", fontSize:10, color:SUB }}>{d}</div>)}
            {Array.from({ length:21 }, (_, i) => i + 1).map(d => (
              <div key={d} style={{ textAlign:"center", padding:"5px 0" }}>
                <span className="f-sans" style={{ fontSize:11, color:INK }}>{d}</span>
                {d >= 10 && d <= 14 && d !== 13 && <div style={{ width:5, height:5, borderRadius:"50%", background:ROLE_GREEN, margin:"2px auto 0" }} />}
              </div>
            ))}
          </div>
          <p className="f-sans" style={{ fontSize:10, color:SUB, margin:"10px 0 0" }}>● 緑＝自分の求人　● 橙＝働き手として行く仕事</p>
        </Card>
        <Card style={{ borderLeft:`4px solid ${ROLE_GREEN}` }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:INK, margin:0 }}>9月10日 ブロッコリー 収穫</p>
          <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"4px 0 0" }}>8:00〜16:00 ・ はなこ さん</p>
        </Card>
      </div>
    ) },
  { ch:"ふだんの道具", name:"道具箱", url:"#/profile/employer", act:"働き手の顔を作る・設定・規約・ログアウト・退会の申し出。",
    body: () => (
      <div style={{ padding:14 }}>
        <Card style={{ marginBottom:12, borderColor:ROLE_ORANGE }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 4px" }}>🤝 働き手プロフィールを作る</p>
          <p className="f-sans" style={{ fontSize:11, color:SUB, lineHeight:1.8, margin:0 }}>農閑期に、他の農園を手伝うこともできます。</p>
        </Card>
        {["アカウントの設定","通知の設定","利用規約","プライバシーポリシー","ログアウト","退会の申し出"].map(t => (
          <div key={t} style={{ display:"flex", justifyContent:"space-between", padding:"13px 2px", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, color: t === "退会の申し出" ? RED : INK, fontWeight:600 }}>{t}</span>
            <span style={{ fontSize:13, color:"#C0C0C0" }}>›</span>
          </div>
        ))}
      </div>
    ) },
];

const HASH_BASE = "/admin/farmer-pages";
// URLの末尾の数字（1始まり）＝いま何枚目か。範囲外・数字なしは1枚目に倒す
const readStep = () => {
  try {
    const m = window.location.hash.replace(/^#\/?/, "").match(/^admin\/farmer-pages\/(\d+)/);
    const n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= STEPS.length ? n : 1;
  } catch { return 1; }
};

export function AdminFarmerPagesRoom() {
  const [step, setStep] = useState(readStep);
  const [celebration, setCelebration] = useState(null); // 本物の祝祭アニメ（Celebration）を再生中
  // ブラウザの戻る／URL直打ちに追従（URL＝場所の原則。次へ・戻るはhashを書くだけ）
  useEffect(() => {
    const onHash = () => setStep(readStep());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // 画面を送ったら見本の先頭から読める位置へ（長い見本の途中に着地させない）
  useEffect(() => { try { window.scrollTo({ top:0, behavior:"auto" }); } catch { window.scrollTo(0, 0); } }, [step]);

  const go = (n) => { window.location.hash = HASH_BASE + "/" + n; };
  const first = step <= 1, last = step >= STEPS.length;
  // 端でも押せる（タップ不能はやめる・2026-08-03）：最初の「戻る」と最後の「次へ」は管理へ帰る
  const onPrev = () => { if (first) window.location.hash = "/admin"; else go(step - 1); };
  const onNext = () => { if (last) window.location.hash = "/admin"; else go(step + 1); };
  const s = STEPS[step - 1];
  const api = { play: (title) => setCelebration({ title }) };

  return (
    /* cb-admin-page＝サイトフッターを隠す目印／cb-farmer-walk-page＝下部バーと浮遊☰を
       「戻る／次へ」に差し替える目印（appStyles） */
    <div className="fade-in cb-admin-page cb-farmer-walk-page" style={{ maxWidth:560, margin:"0 auto", padding:"24px 16px 120px" }}>
      <AdminNav current="farmer-pages" />

      {/* いま何章の何枚目か */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <Chip bg="#EFEFEF" fg={INK}>{s.ch}</Chip>
        <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0" }}>{step} / {STEPS.length}</span>
      </div>
      <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:INK, margin:"0 0 6px" }}>{s.name}</h2>
      <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 4px" }}>{s.act}</p>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 14px" }}>{s.url}</p>

      {/* 進み具合（章の切れ目が見えるように、全枚数ぶんの目盛りで示す） */}
      <div style={{ display:"flex", gap:2, marginBottom:16 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{ flex:1, height:3, borderRadius:2, background: i < step ? INK : "#E8E8E8" }} />
        ))}
      </div>

      {/* 見本の画面。本番の部品をそのまま使っている画面は、本番の見た目と必ず一致する */}
      <div style={{ border:`1px solid ${LINE}`, borderRadius:22, overflow:"hidden", background:"#fff", boxShadow:"0 6px 24px rgba(0,0,0,0.08)" }}>
        {s.body(api)}
      </div>

      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:14 }}>
        求人・働き手の中身はすべて架空です（実在の利用者・求人ではありません）。読むだけのページで、
        ここからは何も保存されません。見本の中のボタンは押しても動きません。
      </p>

      {/* 本物の祝祭アニメ（components/Celebration）。全画面・約3秒で自動的に終わる */}
      {celebration && (
        <Celebration title={celebration.title} onDone={() => setCelebration(null)} />
      )}

      {/* 下部バーの差し替え（戻る／次へ）。この画面では本来の下部バー・浮遊☰は出ない */}
      <div className="cb-walk-bar">
        <button type="button" className="f-sans cb-walk-prev" onClick={onPrev}>{first ? "← 管理へ" : "← 戻る"}</button>
        <span className="f-sans cb-walk-count">{step} / {STEPS.length}</span>
        <button type="button" className="f-sans cb-walk-next" onClick={onNext}>{last ? "おわり" : "次へ →"}</button>
      </div>
    </div>
  );
}
