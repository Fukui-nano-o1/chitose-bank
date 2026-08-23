// 分割3-B（2026-07-25）：App.jsxから移動。働き手プロフィール編集＋プレビュー（WorkerProfilePreviewは本ファイル専用）。
// 専用定数（PR_PROMPTS・Q&A20問・興味/言語/作業強度の選択肢）も同居。
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { uploadAvatarResilient } from "../lib/avatarUpload";
import { promotePendingApplications } from "../lib/workerReady";
import { WORKER_DECLARATIONS, TASK_OPTIONS, WORKER_STYLE_QUESTIONS, ROLE_ORANGE } from "../lib/utils"; // TASK_OPTIONS＝経験・資格ボックスの「その他の作業」で使用
import { Avatar, LFPillSelect, AutoSkeleton, Dots, FieldHelp } from "./ui";
import { NavIcon, NavIconInline } from "./NavIcons";
import { WorkerExperienceEntriesSwipe } from "./WorkerExperiencePage"; // 免許・資格・保険方針パネルは帯の末尾に内蔵（props経由）
import { WorkerTrustCard } from "./TrustCards";
import { EmergencyContactBox } from "./EmergencyContactBox";

const PR_PROMPTS = [
  { q:"農作業に興味を持ったきっかけは？", placeholder:"きっかけを、あなたの言葉で" },
  { q:"働くうえで大事にしていることは？", placeholder:"大事にしていることを、あなたの言葉で" },
  { q:"農家さんに一言、伝えたいことは？", placeholder:"伝えたいことを、あなたの言葉で" },
];
// 働き手プロフィールQ&A：20問メニュー（4グループ）。答えた問いだけがpr_qaに残る＝義務ではない
const WORKER_QA_QUESTIONS = [
  { group:"⭐農家がよく見る質問", questions:[
    "これまでの農作業の経験を教えてください",
    "自分の強みはなんですか？",
    "どのくらいの頻度で働きたいですか？",
  ]},
  { group:"きっかけ・興味", questions:[
    "農業のバイトを始めたのはいつですか？",
    "農作業に興味を持ったきっかけは？",
    "農業にどれくらい興味がありますか？",
    "将来、農業とどう関わりたいですか？",
  ]},
  { group:"姿勢", questions:[
    "バイトをするうえで心がけていることは？",
    "働くうえで大事にしていることは？",
    "自分の強みはなんですか？",
    "人と働くときに気をつけていることは？",
  ]},
  { group:"経験", questions:[
    "これまでの農作業の経験を教えてください",
    "これまでにどんな農作業の経験がありますか？（他のサービスや手伝いでの経験も、作業の内容で教えてください）",
    "農業以外の仕事・バイトの経験は？",
    "使ったことのある道具や機械はありますか？",
    "体を動かすことは好きですか？",
  ]},
  { group:"条件・生活", questions:[
    "どのくらいの頻度で働きたいですか？",
    "働けるのはどの季節・時期ですか？",
    "朝と夕方、どちらが動きやすいですか？",
    "どのくらいの距離まで通えますか？",
  ]},
  { group:"ひとこと", questions:[
    "農家さんに一言お願いします",
    "趣味や普段していることは？",
    "chitose-bankを知ったきっかけは？",
    "このバイトで得たいことは？",
  ]},
];

// 特定の問いにだけ入力例を添える（回数・バッジ・星ではなく「作業の中身」を書いてもらう誘導）。
// キーは質問文そのもの。未定義の問いはプレースホルダなし
// 質問に答える＝グループごとのページ（2026-08-19たきと指示「質問に答えるも同様」→「グループ化しろ」）。
// 1問1ページだと21ページになり探せないので、区切りはグループ（6つ）。1ページに3〜4問が縦に並ぶ。
// 重複する問い（3問が2つのグループに載っている）は先に出たグループに残す＝同じ問いが2ページに出ない。
// この配列がページの並びの唯一のソース。
const WORKER_QA_PAGES = (() => {
  const seen = new Set();
  return WORKER_QA_QUESTIONS.map(({ group, questions }) => ({
    group,
    questions: questions.filter(q => { if (seen.has(q)) return false; seen.add(q); return true; }),
  })).filter(p => p.questions.length > 0);
})();

// 15秒カード用プリセット（2026-07-14たきと判断でCLAUDE.md許可リストに追加。詳細はCLAUDE.md参照）
// はたらき方の希望4問の正は lib/utils の WORKER_STYLE_QUESTIONS（2026-08-14拡充）。
// 旧ラベル（軽めの作業希望/どちらでも/力仕事もOK）で保存済みの値は書き換えない＝そのまま表示される
const INTEREST_OPTIONS = ["釣り","料理","ランニング","筋トレ","読書","音楽","映画","ゲーム","旅行","キャンプ","園芸","DIY","動物","写真","スポーツ観戦","ショッピング","ドライブ","ネットサーフィン"];
const LANGUAGE_OPTIONS = ["日本語","英語","中国語","ベトナム語","インドネシア語","タガログ語","ポルトガル語","その他"];

export function WorkerProfileEdit({ me, onDone, onCancel, onAvatarChange }) {
  const [nickname, setNickname] = useState("");
  const [pr, setPr] = useState("");
  const [prPromptIndex, setPrPromptIndex] = useState(null); // 選んだ問い(ヒント)。PR欄への保存内容には含めない
  const [prQa, setPrQa] = useState([]); // [{q,a}]（20問メニューのうち答えた分だけ）
  const [avatarUrl, setAvatarUrl] = useState("");
  const [residenceCity, setResidenceCity] = useState("");
  const [transport, setTransport] = useState("");
  const [farmExperience, setFarmExperience] = useState("");
  const [physicalLevel, setPhysicalLevel] = useState("");
  // はたらき方の希望・追加3問（2026-08-14たきと承認・選択式・ラベル文字列で保存）
  const [workMood, setWorkMood] = useState("");
  const [learningPref, setLearningPref] = useState("");
  const [workPattern, setWorkPattern] = useState("");
  const [interests, setInterests] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [selfDeclared, setSelfDeclared] = useState([]); // できること・資格（自己申告・key配列・2026-07-23）
  const [expEntries, setExpEntries] = useState([]); // 経験の構造化申告 {crop,task,duration}（最大5・2026-07-23）
  const [experiencedTasks, setExperiencedTasks] = useState([]); // 旧「経験のある作業」＝その他の作業（残置・データ移行なし）
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 直前の保存で自由記述を書き換えたか（完了メッセージの出し分け）。名前の InReview は審査時代の名残で、
  // 承認プロセス削除後は「保存＝即公開」ので、出るのは「自己紹介も公開されました」（2026-08-14に文言は改定済み）
  const [savedInReview, setSavedInReview] = useState(false);
  const [revTargets, setRevTargets] = useState([]); // 修正依頼の指摘対象（"自己紹介本文"/質問文・2026-07-19）
  // 公開済み（運営が承認した）自由記述の控え（2026-07-27たきと報告）：
  // 保存のたびに pr_pending を無条件で書いていたため、住所や移動手段など選択式を直しただけでも
  // 承認済みの自己紹介が審査待ちに逆戻りし、応募のたびに運営の許可が必要になっていた。
  // 本文が実際に変わった時だけ審査に出すため、承認済みの中身をここに控えて比べる
  const approvedRef = useRef({ pr: "", pr_qa: [] });
  // いま審査に出ている内容の控え（2026-08-13たきと報告「応募するたびに自由記述が申請される」）：
  // 承認済み(approvedRef)と比べるだけだと、初めて書いた自由記述は承認があるまで永久に「違う」ままので、
  // 住所を直しただけの保存でも審査がやり直し（申請時刻がリセット＝48時間の自動公開も後ろにずれる）になっていた。
  // 審査中の内容と同じなら、申請時刻を据え置いて出し直さない＝運営の承認待ちの列に並び直さない
  const pendingRef = useRef({ pr: null, pr_qa: null, submitted_at: null });
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) {
          setNickname(data.nickname || "");
          // 自由記述は確認待ち(pending)があればそちらを編集継続、無ければ公開版を初期値に
          setPr(data.pr_pending ?? data.pr ?? "");
          setAvatarUrl(data.avatar_url || "");
          setPrQa(Array.isArray(data.pr_qa_pending) ? data.pr_qa_pending : (Array.isArray(data.pr_qa) ? data.pr_qa : []));
          approvedRef.current = { pr: data.pr || "", pr_qa: Array.isArray(data.pr_qa) ? data.pr_qa : [] };
          pendingRef.current = { pr: data.pr_pending ?? null, pr_qa: Array.isArray(data.pr_qa_pending) ? data.pr_qa_pending : null, submitted_at: data.pr_submitted_at ?? null };
          setResidenceCity(data.residence_city || "");
          setTransport(data.transport || "");
          setFarmExperience(data.farm_experience || "");
          setPhysicalLevel(data.physical_level || "");
          setWorkMood(data.work_mood || ""); setLearningPref(data.learning_pref || ""); setWorkPattern(data.work_pattern || "");
          setInterests(Array.isArray(data.interests) ? data.interests : []);
          setLanguages(Array.isArray(data.languages) ? data.languages : []);
          setSelfDeclared(Array.isArray(data.self_declared) ? data.self_declared : []);
          setExpEntries(Array.isArray(data.experience_entries) ? data.experience_entries : []);
          setExperiencedTasks(Array.isArray(data.experienced_tasks) ? data.experienced_tasks : []);
          // 修正依頼の指摘対象（2026-07-19）：該当ボックスに赤帯を出す。再提出（保存）で消える
          setRevTargets(Array.isArray(data.pr_revision_targets) ? data.pr_revision_targets : []);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);
  const toggleInterest = (v) => setInterests(prev => {
    if (prev.includes(v)) return prev.filter(x => x !== v);
    if (prev.length >= 3) return prev;
    return [...prev, v];
  });
  const toggleLanguage = (v) => setLanguages(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  // 1問1ページ版の書き込み（打つそばから prQa に入れる。保存はモーダルの「保存する」＝既存の作法）。
  // 空にしたらその問いの行ごと消す＝「未回答」に戻る（空文字の行を残さない）
  const setQaAnswer = (q, text) => {
    setPrQa(prev => {
      if (!text.trim()) return prev.filter(x => x.q !== q);
      return prev.some(x => x.q === q) ? prev.map(x => x.q === q ? { ...x, a: text } : x) : [...prev, { q, a: text }];
    });
  };
  // 任意形式の画像をCanvasでjpegに統一変換（heic以外の全形式に対応・バケット制限も回避）
  const convertToJpeg = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512; // アイコンなので512pxに縮小（容量削減）
      let { width, height } = img;
      if (width > height && width > max) { height = Math.round(height * max / width); width = max; }
      else if (height > max) { width = Math.round(width * max / height); height = max; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => { if (blob) resolve(blob); else reject(new Error('変換に失敗')); }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像を読み込めませんでした。別の画像をお試しください。')); };
    img.src = url;
  });
  const handleAvatar = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      let sourceFile = file;
      // iPhoneのHEIC/HEIF形式は、まずheic2anyでjpegにデコード（選択時のみ動的import）
      const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
      if (isHeic) {
        try {
          const heic2any = (await import('heic2any')).default;
          const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
          sourceFile = Array.isArray(converted) ? converted[0] : converted;
        } catch (heicErr) { setUploading(false); alert("iPhoneの写真（HEIC）の変換に失敗しました。もう一度お試しください。"); return; }
      }
      let blob;
      try { blob = await convertToJpeg(sourceFile); }
      catch (convErr) { setUploading(false); alert(convErr.message || "この画像形式は対応していません。JPEG・PNG・WebP等をお試しください。"); return; }
      // 拡張子はjpg固定（変換後は必ずjpeg）。旧ファイルが別拡張子で残っていれば掃除
      try {
        const { data: olds } = await supabase.storage.from('avatars').list("worker/" + session.user.id);
        if (olds && olds.length > 0) {
          const paths = olds.map(f => "worker/" + session.user.id + "/" + f.name);
          await supabase.storage.from('avatars').remove(paths);
        }
      } catch {}
      const path = "worker/" + session.user.id + "/avatar.jpg";
      const upErr = await uploadAvatarResilient("worker/" + session.user.id, blob);
      if (upErr) { setUploading(false); alert("アップロードに失敗しました：" + upErr.message + "\n通信環境を確認して、もう一度お試しください。"); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = (urlData?.publicUrl || '') + "?t=" + Date.now();
      await supabase.from('worker_profiles').upsert({ auth_id: session.user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl(url);
      if (typeof onAvatarChange === "function") onAvatarChange({ url, name: nickname });
    } catch { alert("画像のアップロードに失敗しました。"); }
    setUploading(false);
  };
  const handleDeleteAvatar = async () => {
    if (!avatarUrl || uploading) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      const { data: files } = await supabase.storage.from('avatars').list("worker/" + session.user.id);
      if (files && files.length > 0) {
        const paths = files.map(f => "worker/" + session.user.id + "/" + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from('worker_profiles').upsert({ auth_id: session.user.id, avatar_url: '', updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl('');
      if (typeof onAvatarChange === "function") onAvatarChange({ url: "", name: nickname });
    } catch { alert("削除に失敗しました。"); }
    setUploading(false);
  };
  // ハブの「📋 経験・できること」カードから来た時は、その場でそのボックスを開く（2026-07-23）
  // 🆘緊急連絡先のカード表示用サマリー（2026-08-14たきと報告「保存しても空のまま」の修理）：
  // 別テーブル（emergency_contacts・self-only）のでこのページの本体読み込みとは独立に読む。
  // 従来は v:"" 固定＝保存してもカードが永久に「未設定」＋赤影のままだった
  // はたらき方の希望＝1問1ページの送り（2026-08-19たきと指示「項目ごとに分ける。タップで右にスワイプ」）。
  // 送りはネイティブ横スクロール＋scroll-snap＝指でも戻れる（自前のtransform管理を持たない）
  const styleScrollRef = useRef(null);
  const [styleIdx, setStyleIdx] = useState(0);
  const onStyleScroll = () => {
    const el = styleScrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setStyleIdx(Math.max(0, Math.min(WORKER_STYLE_QUESTIONS.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const goStyle = (i) => { const el = styleScrollRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };
  // 質問に答える＝1問1ページの送り（2026-08-19）。はたらき方の希望と同じ作法。
  // ★入力中は snap と横スクロールを止める：iOSはscroll-snapコンテナ内のtextareaにフォーカスすると
  //   キーボード表示のレイアウト変化で再スナップが走り、打鍵が奪われる（WorkerExperienceEntriesSwipeと同じ対策）
  const [openQaQ, setOpenQaQ] = useState(null);   // いま入力欄を開いている問い（1つずつ・2026-08-19）
  const qaScrollRef = useRef(null);
  const [qaIdx, setQaIdx] = useState(0);
  const [qaTyping, setQaTyping] = useState(false);
  const onQaScroll = () => {
    const el = qaScrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setQaIdx(Math.max(0, Math.min(WORKER_QA_PAGES.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const goQa = (i) => {
    const n = Math.max(0, Math.min(WORKER_QA_PAGES.length - 1, i));
    const el = qaScrollRef.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };
  const [emgSummary, setEmgSummary] = useState("");
  // ★登録済みかの判定は emgSummary（表示用＝関係＋お名前）ではなく hasEmg（お名前 or 電話）で持つ。
  //   関係の既定は「本人」that先に入るので、emgSummary は空欄保存でも "本人" になり、
  //   DB側の条件（name or phone・migration 20260817100444）とズレる（2026-08-17）
  const [hasEmg, setHasEmg] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("emergency_contacts").select("name,relation,phone").eq("auth_id", session.user.id).maybeSingle();
        if (data) {
          setEmgSummary([data.relation, data.name].filter(x => (x || "").trim()).join("・"));
          setHasEmg(!!((data.name || "").trim() || (data.phone || "").trim()));
        }
      } catch {}
    })();
  }, []);
  const [editBox, setEditBox] = useState(() => { try { const b = sessionStorage.getItem("cb_wkOpenBox"); if (b) { sessionStorage.removeItem("cb_wkOpenBox"); return b; } } catch {} return null; }); // avatar|nickname|residence|transport|exp|intensity|interests|languages|declared|pr|qa（declaredは2026-08-02にボックスへ復帰）
  const [showPreview, setShowPreview] = useState(false); // 右上「プレビュー」→WorkerProfilePreviewをモーダル展開
  const [editFromPreview, setEditFromPreview] = useState(false); // プレビュー発の編集：閉じたらプレビューへ戻る（往復）
  // 承認ポップアップ「プレビューを見る🔗」からの着地：編集ページを開いた直後にプレビューを自動展開
  useEffect(() => {
    try {
      if (sessionStorage.getItem("cb_openWorkerPreview") === "1") {
        sessionStorage.removeItem("cb_openWorkerPreview");
        setShowPreview(true);
      }
    } catch {}
  }, []);
  const closeEditBox = () => {
    setEditBox(null);
    if (editFromPreview) { setEditFromPreview(false); setShowPreview(true); }
  };
  // 保存→次の未入力ボックスを自動展開（全て入力されるまでループ・2026-07-16）
  // ★並びは【応募に必要な3項目が先】（ニックネーム→居住地→自己紹介）。
  //   保存の連鎖と「最初の未入力を開く」導線が、まず応募できる状態まで連れて行く順になる。
  //   emergency は別テーブル（emergency_contacts）soこの並びに入れて hasEmg で充足を見る。
  //   2026-08-19：必須ではなくなった（新規登録の内容が初期値で入る）ので、3項目の後ろへ移した。
  const BOX_ORDER = ["nickname","residence","pr","emergency","avatar","transport","exp","intensity","interests","languages","declared","qa"]; // declaredはボックスへ復帰（2026-08-02たきと指示・保険申告と同じトグル構造のモーダル）
  const boxFilled = (k) => (
    k === "pr" ? !!pr.trim() : k === "nickname" ? !!nickname.trim() : k === "residence" ? !!residenceCity.trim()
    : k === "emergency" ? hasEmg
    : k === "transport" ? !!transport : k === "exp" ? !!farmExperience : k === "intensity" ? !!(physicalLevel || workMood || learningPref || workPattern)
    : k === "interests" ? interests.length > 0 : k === "languages" ? languages.length > 0
    : k === "declared" ? (selfDeclared.length > 0 || expEntries.some(e => (e.crop||"").trim())) : k === "avatar" ? !!avatarUrl : prQa.length > 0
  );
  useEffect(() => { if (editBox === "intensity") setStyleIdx(0); }, [editBox]);
  const nextUnfilledBox = (afterKey) => {
    const start = Math.max(0, BOX_ORDER.indexOf(afterKey));
    for (let i = 1; i <= BOX_ORDER.length; i++) {
      const k = BOX_ORDER[(start + i) % BOX_ORDER.length];
      if (!boxFilled(k)) return k;
    }
    return null;
  };
  // 今日ページ「プロフィール入力」からの着地（2026-08-03たきと指示）：
  // 最初の未入力ボックスをその場で開く。以後は保存のたびに次の未入力へ（上の既存の連鎖に乗る）。
  // ★読み込みが終わってから判定する（読み込み前は全項目が空に見え、必ずアイコンが開いてしまう）。
  // 1回だけ（refで消費）＝閉じたあと再び勝手に開かない
  const fillGuideRef = useRef(false);
  useEffect(() => {
    if (loading || fillGuideRef.current) return;
    let want = false;
    try { want = sessionStorage.getItem("cb_fillProfile") === "1"; if (want) sessionStorage.removeItem("cb_fillProfile"); } catch {}
    if (!want) return;
    fillGuideRef.current = true;
    const k = BOX_ORDER.find(b => !boxFilled(b));   // 先頭から最初の未入力（nextUnfilledBoxは「次」ので先頭を飛ばす）
    if (k) setEditBox(k);
  }, [loading]);   // eslint-disable-line react-hooks/exhaustive-deps -- 読み込み完了の1回だけ走らせる（入力途中の再判定はしない）
  // 保存失敗を運営が追えるように記録（app_errors・システムページに出る）。失敗しても保存フローは妨げない
  const logSaveError = (msg) => {
    try {
      supabase.from("app_errors").insert({
        level: "error", source: "client", component: "WorkerProfileEdit", action: "profile_save",
        message: String(msg || "不明").slice(0, 500), page: (typeof window !== "undefined" ? window.location.hash : ""),
        user_agent: (typeof navigator !== "undefined" ? navigator.userAgent : ""),
      }).then(() => {}, () => {});
    } catch {}
  };
  const save = async (stay = false) => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // ★保存を無言で終わらせない（2026-08-14たきと指示「保存したら即反映」＝失敗も必ず喋らせる）。
      // 従来はセッション切れだと何も言わずreturn＝「保存しました」も「失敗」も出ない迷子だった
      if (!session) { setSaving(false); alert("ログインが確認できませんでした。ページを開き直して、もう一度保存してください。"); return; }
      // 比べる土台を保存の直前に取り直す（2026-08-14たきと報告「応募するたびに自己紹介の申請がくる」）：
      // 画面を開いたまま運営が承認すると approvedRef が古いままになり、同じ内容をもう一度
      // 審査に出していた（承認直後は old.pending が null ので 通知トリガーの変更なしスキップも
      // 効かず、運営に申請メールが毎回届く）。保存は稀な操作ので 1往復の追加を許容。
      // 取得に失敗した時は手元の控えのまま進める（失敗時は上書きしない・2026-08-07規則）。
      // 同じ壁はDB側にもある（trg_wp_review_dedupe＝承認済みと同一内容は審査に入れない）＝二重の壁
      const freshRes = await supabase.from("worker_profiles")
        .select("pr,pr_qa,pr_pending,pr_qa_pending,pr_submitted_at")
        .eq("auth_id", session.user.id).maybeSingle();
      if (!freshRes.error && freshRes.data) {
        const f = freshRes.data;
        approvedRef.current = { pr: f.pr || "", pr_qa: Array.isArray(f.pr_qa) ? f.pr_qa : [] };
        pendingRef.current = { pr: f.pr_pending ?? null, pr_qa: Array.isArray(f.pr_qa_pending) ? f.pr_qa_pending : null, submitted_at: f.pr_submitted_at ?? null };
      }
      // 自由記述(pr/pr_qa)は運営確認後に公開。pr_pending/pr_qa_pendingに保存し、
      // 公開版のpr/pr_qaは書かない(承認RPC/48時間cronだけが書く)。選択式項目は従来どおり即時保存
      // 審査に出すのは「承認済みと中身が違う」時だけ（2026-07-27）。同じなら pending を空にする＝
      // 何も変えていない保存で審査待ちに戻さない／本文を承認済みの状態へ戻した時は審査依頼が取り下がる
      const qaKey = (arr) => JSON.stringify((Array.isArray(arr) ? arr : []).map(x => ({ q: x?.q || "", a: (x?.a || "").trim() })));
      const oneQa = (x) => JSON.stringify({ q: x?.q || "", a: (x?.a || "").trim() });
      const prChanged = pr.trim() !== (approvedRef.current.pr || "").trim();
      const qaChanged = qaKey(prQa) !== qaKey(approvedRef.current.pr_qa);
      // 空にする（消す）だけの変更は審査に出さず、その場で公開版を消す（2026-08-03たきと指示
      // 「入力項目を空にするなら審査は必要ない」）。審査が守るのは新しく公開される文字ので、
      // 消すだけなら見るものが無い。従来は消しても承認まで公開版が残り続けていた
      const approvedQa = new Set((Array.isArray(approvedRef.current.pr_qa) ? approvedRef.current.pr_qa : []).map(oneQa));
      const qaOnlyRemoved = qaChanged && prQa.every(x => approvedQa.has(oneQa(x))); // 承認済みの部分集合＝削除のみ
      const prNeedsReview = prChanged && pr.trim() !== "";
      const qaNeedsReview = qaChanged && !qaOnlyRemoved;
      const inReview = prNeedsReview || qaNeedsReview;
      const clearedFields = {};
      if (prChanged && pr.trim() === "") clearedFields.pr = "";      // 自己紹介を消した＝即反映
      if (qaChanged && qaOnlyRemoved) clearedFields.pr_qa = prQa;    // Q&Aを消しただけ＝即反映
      // 審査に出す中身がいま審査中のものと同じなら、申請時刻を据え置く（2026-08-13）＝
      // 待っている間に他の項目を直して保存しても、審査の列に並び直さない／48時間の自動公開がずれない
      const nextPrPending = prNeedsReview ? pr.trim() : null;
      const nextQaPending = qaNeedsReview ? prQa : null;
      const samePending = inReview
        && (nextPrPending ?? "") === (pendingRef.current.pr ?? "")
        && qaKey(nextQaPending) === qaKey(pendingRef.current.pr_qa)
        && !!pendingRef.current.submitted_at;
      const reviewFields = inReview
        ? { pr_pending: nextPrPending, pr_qa_pending: nextQaPending,
            pr_submitted_at: samePending ? pendingRef.current.submitted_at : new Date().toISOString(),
            pr_revision_targets: null } // 再提出＝修正依頼の赤帯を解除（2026-07-19）
        : { pr_pending: null, pr_qa_pending: null, pr_submitted_at: null };
      const { error } = await supabase.from("worker_profiles").upsert({
        auth_id: session.user.id, nickname: nickname.trim(),
        ...clearedFields,
        ...reviewFields,
        residence_city: residenceCity.trim(), transport, farm_experience: farmExperience, physical_level: physicalLevel,
        work_mood: workMood || null, learning_pref: learningPref || null, work_pattern: workPattern || null,
        interests, languages, self_declared: selfDeclared,
        experience_entries: expEntries.map(e => ({ crop:(e.crop||"").trim(), task:e.task||"", duration:e.duration||"" })).filter(e => e.crop).slice(0, 5),
        experienced_tasks: experiencedTasks,
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      setSaving(false);
      if (!error) {
        // 仮応募の昇格（第15弾・2026-07-30たきと指示）：保存の直後に一度だけ試す。
        // 必須がそろっていなければDB側が not_ready を返して何も起きない＝ここでの判定は持たない。
        // 届いたら成功ページで件数を知らせる（運営の自由記述審査は待たない）
        const promoted = await promotePendingApplications();
        if (promoted > 0) {
          try { sessionStorage.setItem("cb_promoted", String(promoted)); } catch {}
          window.location.hash = "/apply/done";
          return;
        }
        // 即反映した分は「承認済みの控え」も更新する（次の保存で再び差分と見なさないため）
        if (clearedFields.pr !== undefined) approvedRef.current.pr = "";
        if (clearedFields.pr_qa !== undefined) approvedRef.current.pr_qa = prQa;
        // いま審査に出ている内容の控えも更新（同じ画面で続けて保存しても列に並び直さない・2026-08-13）
        pendingRef.current = { pr: reviewFields.pr_pending ?? null, pr_qa: reviewFields.pr_qa_pending ?? null,
                               submitted_at: reviewFields.pr_submitted_at ?? null };
        setSaved(true);
        setSavedInReview(inReview);
        if (inReview) setRevTargets([]); // 赤帯が消えるのは再提出した時だけ（本文を直さない保存では残す）
        if (typeof onAvatarChange === "function") onAvatarChange({ url: avatarUrl, name: nickname.trim() });
        if (stay === true) {
          // 保存→次の未入力ボックスへ（全て入力済みなら閉じる・2026-07-16）。
          // BOX_ORDER外のボックス（保険=ホームから開く移植分）は次へ送らず閉じる
          const nxt = BOX_ORDER.includes(editBox) ? nextUnfilledBox(editBox) : null;
          if (nxt) setEditBox(nxt); else closeEditBox();
          setTimeout(() => setSaved(false), 2200);
        }
        else setTimeout(() => { setSaved(false); if (typeof onDone === "function") onDone(); }, 2200);
      }
      else { logSaveError(error.message); alert("保存に失敗しました：" + error.message); }
    } catch (e) { setSaving(false); logSaveError(e?.message || e); alert("保存に失敗しました。"); }
  };
  // 読み込み中は編集ボックスの仮配置（2026-07-27たきと指示）
  if (loading) return <AutoSkeleton fallbackHeight={92} fallbackCount={5} />;
  return (
    <div style={{ marginTop:32, paddingTop:32, borderTop:"1px solid #EEE" }}>
      {/* 雇い手プロフィール編集と同じ構造：見出し・説明文・ページ全体の保存は廃止（2026-07-25／2026-08-03）。
          プレビューは運営チャットと同じ浮遊ボックスへ移植（2026-08-03たきと指示）＝下部に固定・
          スクロールで格納（cb-float-box の作法をそのまま使う）。保存は各ボックスのモーダル内 */}
      <button onClick={()=>setShowPreview(true)} className="f-sans cb-float-box"
        style={{ position:"fixed", right:12, bottom:"calc(64px + 12px + env(safe-area-inset-bottom, 0px))", zIndex:1200, display:"flex", alignItems:"center", gap:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"10px 14px", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.15)" }}>
        <NavIcon name="views" size={18} />
        <span style={{ fontSize:13, fontWeight:700, color:"#222" }}>プレビュー</span>
      </button>

      {/* はじめのガイド：空の時だけ上部に。★ここに並べる項目は【応募に必要な3項目】＝
          DBの is_worker_profile_ready と lib/workerReady.js の写し。
          3つが食い違うと「埋めたのに応募が届かない」が起きるので、条件を変える時は必ず3つとも直す
          （2026-08-19たきと指示「緊急連絡先必須を解除」＝緊急連絡先はここから外した。
           緊急連絡先は新規登録の氏名・電話が初期値として自動で入り、任意で変更できる） */}
      {(() => {
        const steps = [
          { k:"nickname",  l:"①ニックネーム", done: !!nickname.trim() },
          { k:"residence", l:"②居住地",       done: !!residenceCity.trim() },
          { k:"pr",        l:"③自己紹介",     done: !!pr.trim() },
        ];
        if (steps.every(s => s.done)) return null;
        return (
          <div className="f-sans" style={{ background:"#FFF6EF", border:"1px solid " + ROLE_ORANGE + "33", borderRadius:16, padding:"16px", marginBottom:20 }}>
            <p style={{ fontSize:14, fontWeight:800, color:ROLE_ORANGE, margin:"0 0 4px" }}>この3つで応募できます</p>
            <p style={{ fontSize:11, color:"#717171", margin:"0 0 12px", lineHeight:1.6 }}>この3つが埋まれば求人に応募できます。あとからいつでも足せます。</p>
            <div style={{ display:"grid", gap:8 }}>
              {steps.map(s => (
                <button key={s.k} onClick={()=>setEditBox(s.k)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid "+(s.done?ROLE_ORANGE:"#EBEBEB"), borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                  <span style={{ width:24, height:24, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, background: s.done?ROLE_ORANGE:"#F0F0F0", color: s.done?"#fff":"#B0B0B0" }}>{s.done?"✓":""}</span>
                  <span style={{ fontSize:14, fontWeight:700, color: s.done?ROLE_ORANGE:"#222", flex:1 }}>{s.l}</span>
                  {!s.done && <span style={{ fontSize:12, color:ROLE_ORANGE, fontWeight:700, flexShrink:0 }}>入力する →</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ═══ ボックス格子（入口カードと同じ様式・タップでモーダル編集・2026-07-14） ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {[
          // req:true=看板の核（未入力なら浮遊アニメ）。それ以外は任意=未入力でも赤影のみ（2026-07-16・農家プロと同じ規則）
          // 配置（2026-07-16）：アイコン・ニックネーム／アイコンの下に自己紹介。任意は農家プロと同じ系統順（条件系→属性→問いかけ系が最後）
          // カードの絵文字アイコンは削除＝テキストのみ（2026-08-14たきと指示・雇い手編集ページと同型）
          // 枠と値の色は役割色（働き手=橙 ROLE_ORANGE／雇い手側は緑）＝いまどちらの面にいるかが枠で分かる
          // （2026-08-19たきと指示「各カードの枠に色を配色」・役割カラー規約2026-07-22の目印の一種）
          { k:"avatar",    l:"アイコン",     v: avatarUrl ? "設定済み" : "" }, // 義務化解除（2026-07-25たきと指示）＝任意扱い（未入力は静止赤影のみ）
          { k:"nickname",  l:"ニックネーム", req:true, v: nickname },
          { k:"pr",        l:"自己紹介",     req:true, v: pr },
          { k:"residence", l:"居住地",       v: residenceCity },
          { k:"transport", l:"移動手段",     v: transport },
          { k:"exp",       l:"農業経験",     v: farmExperience },
          { k:"intensity", l:"はたらき方の希望", v: [physicalLevel, workMood, learningPref, workPattern].filter(Boolean).join("・") },
          { k:"interests", l:"趣味",         v: interests.join("・") },
          { k:"languages", l:"言語",         v: languages.join("・") },
          { k:"declared",  l:"経験・資格", v: [...expEntries.filter(e=>(e.crop||"").trim()).map(e=>`${e.crop}×${e.task||""}`), ...selfDeclared.map(k => (WORKER_DECLARATIONS.find(x=>x.k===k)||{}).chip)].filter(Boolean).join("・") },
          { k:"qa",        l:"質問に答える", v: prQa.length > 0 ? `${prQa.length}問に回答` : "" },
          // 緊急連絡先（2026-08-03）：別テーブル保存ので格子の値表示は持たない（開いた先で読み書きする）
          { k:"emergency", l:"緊急連絡先",   v: emgSummary }, // サマリーは emgSummary（2026-08-14修理）
        ].map(b => {
          // 修正依頼の赤帯（2026-07-19）：指摘対象「自己紹介本文」→自己紹介ボックス／質問文→質問に答えるボックス
          const revFlagged = revTargets.length > 0 && (b.k === "pr" ? revTargets.includes("自己紹介本文") : b.k === "qa" ? revTargets.some(t => t !== "自己紹介本文") : false);
          return (
          <button key={b.k} onClick={()=>setEditBox(b.k)} className={"f-sans" + (revFlagged ? " cb-urgent-still" : b.v ? "" : (b.req ? " cb-urgent-card" : " cb-urgent-still"))} style={{ position:"relative", background:"#fff", border:"1px solid " + ROLE_ORANGE, borderRadius:20, padding: revFlagged ? "20px 10px 38px" : "20px 10px 16px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0, ...(b.k === "avatar" ? { gridColumn:"1/-1" } : {}) }}>
            {revFlagged && (
              <span className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:1, padding:"5px 6px", borderRadius:"0 0 20px 20px", background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, textAlign:"center", boxSizing:"border-box" }}><NavIconInline name="alert" size={11} style={{ verticalAlign:"-1.5px" }} />修正のお願い</span>
            )}
            {/* アイコンのカードだけ1行まるごと＋アイコン本体を大きく（2026-08-14たきと指示・雇い手編集ページと同型） */}
            {b.k === "avatar" && <Avatar url={avatarUrl} name={nickname} size={72} ring={ROLE_ORANGE} />}
            <span style={{ fontSize:14, fontWeight:700, color:"#222" }}>{b.l}</span>
            <span style={{ fontSize:11, color: b.v ? ROLE_ORANGE : "#B0B0B0", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.v || "未設定"}</span>
          </button>
          );
        })}
      </div>
      {saved && (
        <p className="f-sans" style={{ fontSize:12, color:ROLE_ORANGE, textAlign:"center", marginTop:14 }}>{savedInReview ? "保存しました ✓　自己紹介も公開されました" : "保存しました ✓"}</p>
      )}
      {onCancel && (
        <button onClick={onCancel} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:14, background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#717171", textDecoration:"underline" }}>プレビューに戻る</button>
      )}

      {/* ═══ 編集モーダル（各ボックスの中身。保存はモーダル内の「保存する」＝全項目upsert） ═══ */}
      {/* document.bodyへポータル（2026-08-01）：祖先がtransformを持つとfixedの基準がその祖先になり、
          オーバーレイが画面下端まで届かず白い帯が出る（AdminJobPreviewと同じ不具合・同じ根治法） */}
      {editBox && createPortal(
      /* cb-lock-scroll＝展開中は背後ページのスクロールを固定し、下部バー・浮遊☰・役割トグルを隠す
         （2026-08-01たきと指示「ボックスが前面・展開中は画面スクロール停止」・雇い手側と同作法） */
      <div onClick={closeEditBox} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 16px", animation:"fadeIn .2s ease" }}>{/* 上下40pxの余白を残して中央（2026-08-01たきと指示・30px→40px・雇い手側と同一）。maxHeight:100%＝余白を差し引いた高さが上限 */}
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:520, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
      {/* ✕は削除（2026-08-14たきと指示）＝閉じるはボックス外タップ（overlayのonClick=closeEditBox・内側はstopPropagation） */}

      {editBox==="avatar" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>アイコン</label>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid " + ROLE_ORANGE, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
          <Avatar url={avatarUrl} name={nickname} size={64} />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <label className="f-sans" style={{ padding:"10px 16px", border:"1px solid #EBEBEB", borderRadius:10, background:"#fff", fontSize:13, color:"#222", cursor:"pointer", textAlign:"center" }}>
            {uploading ? <>処理中<Dots /></> : avatarUrl ? "画像を変更" : "画像を選ぶ"}
            <input type="file" accept="image/*" onChange={handleAvatar} disabled={uploading} style={{ display:"none" }} />
          </label>
          {avatarUrl && (
            <button onClick={handleDeleteAvatar} disabled={uploading} className="f-sans" style={{ padding:"8px 16px", border:"1px solid #EBEBEB", borderRadius:10, background:"#fff", fontSize:12, color:"#717171", cursor:"pointer" }}>削除</button>
          )}
        </div>
      </div>
      </>)}

      {editBox==="nickname" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>ニックネーム</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>呼び名です。本名でなくてかまいません。</p>
      <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="例：たき" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="residence" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>居住地</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>通える範囲の確認に使われます。</p>
      <input value={residenceCity} onChange={e=>setResidenceCity(e.target.value)} placeholder="例：吉野川市（市町村まで）" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="transport" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>移動手段</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>集合場所までの足の確認に使われます。</p>
      <LFPillSelect options={["車","バイク","自転車","公共交通"]} value={transport} onSelect={setTransport} accent={ROLE_ORANGE} />
      </>)}

      {editBox==="exp" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6, marginTop:8 }}>農業就労の経験</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>未経験でも大丈夫。正直に選んでください。</p>
      <LFPillSelect options={["未経験","経験あり"]} value={farmExperience} onSelect={setFarmExperience} accent={ROLE_ORANGE} />
      </>)}

      {/* はたらき方の希望＝4問（2026-08-14拡充・雇い手の関わり方4問と対）。
          2026-08-19たきと指示「項目ごとに分ける。タップで右にスワイプ。全て入力で保存」＝
          縦に4問並べるのをやめ、1問1ページにした。選ぶと次の質問へ送り、4問目を選ぶとそのまま保存して閉じる。
          送りはネイティブ横スクロール＋scroll-snap（WorkerExperienceEntriesSwipe と同じ作法）＝
          指でも戻れる。答えたい質問だけでよい性質は不変＝下の共通「保存する」で保存する */}
      {editBox==="intensity" && (<>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"8px 0 10px", lineHeight:1.6 }}>答えたい質問だけ選んでください（任意）。答えた内容は応募先の農家に表示されます。</p>
      <div ref={styleScrollRef} onScroll={onStyleScroll}
        style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory", WebkitOverflowScrolling:"touch",
                 overscrollBehaviorX:"contain", scrollbarWidth:"none", margin:"0 -2px" }}>
        {WORKER_STYLE_QUESTIONS.map((q, i) => {
          const cur = { physical_level: physicalLevel, work_mood: workMood, learning_pref: learningPref, work_pattern: workPattern }[q.k];
          const set = { physical_level: setPhysicalLevel, work_mood: setWorkMood, learning_pref: setLearningPref, work_pattern: setWorkPattern }[q.k];
          return (
            <div key={q.k} style={{ flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", alignSelf:"flex-start" }}>
              <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>{q.label}（任意）</label>
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 8px" }}>{i + 1} / {WORKER_STYLE_QUESTIONS.length}</p>
              <LFPillSelect options={q.options} accent={ROLE_ORANGE} value={cur} onSelect={v => {
                const next = cur === v ? "" : v;   // 同じものをもう一度タップ＝選び直し（空に戻す）
                set(next);
                // 選んだら次の質問へ自動で送る（最後の質問は送らない＝下の「保存する」で締める）
                if (!next) return;                 // 取り消しでは進めない
                if (i < WORKER_STYLE_QUESTIONS.length - 1) setTimeout(() => goStyle(i + 1), 220);
              }} />
              {/* 既定は「戻る／次へ」（2026-08-19たきと指示）。選ばずに飛ばしたい人もボタンで進める
                  ＝任意の項目が行き止まりにならない。保存はモーダル下部の共通ボタンが担う */}
              <div style={{ display:"flex", gap:8, marginTop:14 }}>
                {i > 0 && (
                  <button type="button" onClick={()=>goStyle(i - 1)} className="f-sans"
                    style={{ flex:"0 0 auto", padding:"10px 16px", background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer" }}>← 戻る</button>
                )}
                {/* 最後の項目に「保存する」は置かない（2026-08-19たきと指示）＝
                    モーダル下部の共通「保存する」と同じ文言のボタンが2つ並ぶため（緊急連絡先と同じ判断） */}
                {i < WORKER_STYLE_QUESTIONS.length - 1 && (
                  <button type="button" onClick={()=>goStyle(i + 1)} className="f-sans"
                    style={{ flex:1, padding:"10px", background: ROLE_ORANGE, color:"#fff", border:"none", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer" }}>次へ →</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* 進み具合（タップでその質問へ）。全部が下の「保存する」でも保存できる＝途中でやめても壊れない */}
      <div style={{ display:"flex", justifyContent:"center", gap:6, margin:"14px 0 4px" }}>
        {WORKER_STYLE_QUESTIONS.map((q, i) => (
          <button key={q.k} type="button" onClick={()=>goStyle(i)} aria-label={q.label}
            style={{ width:8, height:8, borderRadius:"50%", border:"none", padding:0, cursor:"pointer",
                     background: i === styleIdx ? ROLE_ORANGE : "#DDD" }} />
        ))}
      </div>
      </>)}

      {editBox==="interests" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6, marginTop:16 }}>趣味（最大3つ）</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
        {INTEREST_OPTIONS.map(v => {
          const selected = interests.includes(v);
          const disabled = !selected && interests.length >= 3;
          return (
            <button key={v} type="button" onClick={()=>toggleInterest(v)} disabled={disabled} className="f-sans" style={{
              padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor: disabled ? "default" : "pointer",
              border:"1px solid " + (selected ? ROLE_ORANGE : "#EBEBEB"),
              background: selected ? "#FFF1E8" : "#F7F7F7",
              color: selected ? ROLE_ORANGE : (disabled ? "#D0D0D0" : "#717171"),
            }}>{v}</button>
          );
        })}
      </div>
      </>)}

      {editBox==="languages" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>やり取りできる言語</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
        {LANGUAGE_OPTIONS.map(v => (
          <button key={v} type="button" onClick={()=>toggleLanguage(v)} className="f-sans" style={{
            padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
            border:"1px solid " + (languages.includes(v) ? ROLE_ORANGE : "#EBEBEB"),
            background: languages.includes(v) ? "#FFF1E8" : "#F7F7F7",
            color: languages.includes(v) ? ROLE_ORANGE : "#717171",
          }}>{v}</button>
        ))}
      </div>
      </>)}

      {/* 経験・資格（declared）：ボックスへ復帰（2026-08-02たきと指示「保険申告と同じ構造に」）。
          免許・資格・保険方針は保険申告と同じトグル行リスト構造。保存はモーダル共通の「保存する」
          （save()が experience_entries / self_declared / experienced_tasks を含む・配線済み）。
          専用ページ #/experience（WorkerExperiencePage）はURL直打ち・ProfileHub経由用に残置 */}
      {editBox==="declared" && (<>
      <FieldHelp label="経験・資格（自己申告）" accent={ROLE_ORANGE}>あなたのプロフィールに「ご本人の申告」として表示されます。運営が確認するものではありません。</FieldHelp>
      {/* 経験／免許・資格・保険方針：タブ＋全幅ページ切替スワイプ（2026-08-03たきと指示・指連動＝ネイティブ横スクロール＋snap） */}
      <div style={{ marginBottom:16 }}>
        <WorkerExperienceEntriesSwipe expEntries={expEntries} setExpEntries={setExpEntries} selfDeclared={selfDeclared} setSelfDeclared={setSelfDeclared} />
      </div>
      {/* 旧「経験のある作業」＝既存データがある人だけ残置表示（専用ページと同じ扱い） */}
      {experiencedTasks.length > 0 && (<>
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"4px 0 6px" }}>その他の作業</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
          {[...new Set([...TASK_OPTIONS.map(t=>t.name), ...experiencedTasks])].map(v => {
            const on = experiencedTasks.includes(v);
            return (
              <button key={v} type="button" onClick={()=>setExperiencedTasks(prev => on ? prev.filter(x=>x!==v) : [...prev, v])} className="f-sans" style={{
                padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                border:"1px solid " + (on ? ROLE_ORANGE : "#EBEBEB"), background: on ? "#FFF1E8" : "#F7F7F7", color: on ? ROLE_ORANGE : "#717171",
              }}>{v}</button>
            );
          })}
        </div>
      </>)}
      </>)}

      {editBox==="pr" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>自己紹介・PR</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 8px", lineHeight:1.6 }}>承認の判断でいちばん読まれます。</p>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
        {PR_PROMPTS.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPrPromptIndex(i)}
            className="f-sans"
            style={{
              padding:"6px 12px", borderRadius:20,
              border:"1px solid " + (prPromptIndex===i ? ROLE_ORANGE : "#EBEBEB"),
              background: prPromptIndex===i ? "#FFF1E8" : "#F7F7F7",
              color: prPromptIndex===i ? ROLE_ORANGE : "#717171",
              fontSize:12, fontWeight:600, cursor:"pointer",
            }}
          >{p.q}</button>
        ))}
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", marginBottom:8 }}>うまく書く必要はありません。あなたの言葉が、いちばん伝わります</p>
      <textarea
        value={pr}
        onChange={e=>setPr(e.target.value)}
        placeholder={prPromptIndex != null ? PR_PROMPTS[prPromptIndex].placeholder : "農作業の経験や、意気込みなど"}
        rows={4}
        className="field f-sans"
        style={{ width:"100%", fontSize:14, marginBottom:16, resize:"vertical" }}
      />
      </>)}

      {editBox==="emergency" && (<>
      {/* 緊急連絡先（2026-08-03たきと指示）：採用成立後に相手方へのみ開示。保存はこの部品の中で完結
          （emergency_contacts テーブル・self-only）ので、下の共通「保存する」は押さなくてよい */}
      {/* 緊急連絡先は必須ではない（2026-08-19たきと指示「必須を解除」）＝新規登録の氏名・電話が
          初期値として自動で入っており、変えたい人だけ変える。
          ★別テーブルsoこの部品の中で保存が完結する＝共通の save() を通らない。保存の直後に
          仮応募の昇格を試すのは従来どおり残す（3項目がそろっていなければ何も起きない） */}
      <EmergencyContactBox accent={ROLE_ORANGE} onSaved={async ({ name, relation, phone }) => {
        setEmgSummary([relation, name].filter(x => (x || "").trim()).join("・"));
        setHasEmg(!!((name || "").trim() || (phone || "").trim()));
        const promoted = await promotePendingApplications();
        if (promoted > 0) {
          try { sessionStorage.setItem("cb_promoted", String(promoted)); } catch {}
          window.location.hash = "/apply/done";
          return;
        }
        // 共通の save() を通らないので、保存→次の未入力へ進む連鎖もここで繋ぐ（2026-08-17）。
        // hasEmg の反映は非同期so nextUnfilledBox が emergency 自身を返すことがある＝いま埋めた側so閉じる
        const nxt = nextUnfilledBox("emergency");
        if (nxt && nxt !== "emergency") setEditBox(nxt); else closeEditBox();
      }} />
      <div style={{ marginBottom:8 }} />
      </>)}

      {/* 質問に答える＝1問1ページ（2026-08-19たきと指示「質問に答えるも同様」）。
          チップの一覧＋その場で展開をやめ、問いを1枚ずつ送る形にした。打つそばから prQa に入り、
          保存はモーダル下部の共通「保存する」が担う（各ページには置かない）。好きな問いだけでよい
          性質は不変＝答えずに次へ送れる */}
      {editBox==="qa" && (
      <div style={{ marginTop:8, marginBottom:16 }}>
        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:4, paddingRight:36 }}>質問に答えて、あなたを伝える</p>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 10px" }}>
          {qaIdx + 1} / {WORKER_QA_PAGES.length}　好きな質問だけでOK{prQa.length > 0 ? `（${prQa.length}問に回答済み）` : ""}
        </p>
        <div ref={qaScrollRef} onScroll={onQaScroll}
          style={{ display:"flex", overflowX: qaTyping ? "hidden" : "auto", scrollSnapType: qaTyping ? "none" : "x mandatory",
                   WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", scrollbarWidth:"none", margin:"0 -2px" }}>
          {WORKER_QA_PAGES.map(({ group, questions }, i) => (
            <div key={group} style={{ flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", alignSelf:"flex-start" }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:"0 0 10px", letterSpacing:".02em" }}>{group}</p>
              {/* 質問はタブ（横に並ぶ・2026-08-19たきと指示「質問はタブ化。タップで入力欄表示」）。
                  タブは1行（はみ出す分はCSSの…で省略）。選んだ質問の全文と入力欄を下に出す。
                  ★文字数での切り出しはしない：半角混じりの問い（chitose-bank…）で意味が切れるため、
                    maxWidth＋ellipsis に任せて自然な位置で省く
                  答えた問いには✓。選ぶまで入力欄は出さない（タップで表示） */}
              <div style={{ display:"flex", gap:6, overflowX:"auto", WebkitOverflowScrolling:"touch",
                            scrollbarWidth:"none", margin:"0 -2px 10px", padding:"2px" }}>
                {questions.map(q => {
                  const ans = prQa.find(x => x.q === q)?.a || "";
                  const on = openQaQ === q;
                  const revFlaggedQ = revTargets.includes(q); // 修正のお願いの指摘対象は赤で明示（2026-07-19）
                  return (
                    <button key={q} type="button" onClick={()=>setOpenQaQ(on ? null : q)} className="f-sans"
                      style={{ flexShrink:0, maxWidth:200, padding:"7px 13px", borderRadius:20, cursor:"pointer", whiteSpace:"nowrap",
                               overflow:"hidden", textOverflow:"ellipsis", fontSize:12, fontWeight:700,
                               border:"1px solid " + (revFlaggedQ ? "#E24B4A" : on ? ROLE_ORANGE : ans.trim() ? ROLE_ORANGE + "66" : "#EBEBEB"),
                               background: revFlaggedQ ? "#FDECEC" : on ? ROLE_ORANGE : "#fff",
                               color: revFlaggedQ ? "#E24B4A" : on ? "#fff" : ans.trim() ? ROLE_ORANGE : "#717171" }}>
                      {revFlaggedQ ? <NavIconInline name="alert" size={12} style={{ verticalAlign:"-1.5px", marginRight:3 }} /> : ans.trim() ? "✓ " : ""}{q}
                    </button>
                  );
                })}
              </div>
              {questions.includes(openQaQ) && (
                <div className="fade-in" style={{ marginBottom:12 }}>
                  <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 6px", lineHeight:1.6 }}>{openQaQ}</p>
                  <textarea
                    value={prQa.find(x => x.q === openQaQ)?.a || ""}
                    onChange={e=>setQaAnswer(openQaQ, e.target.value)}
                    onFocus={()=>setQaTyping(true)}
                    onBlur={()=>setQaTyping(false)}
                    rows={3}
                    autoFocus
                    className="field f-sans"
                    style={{ width:"100%", fontSize:16, resize:"vertical", boxSizing:"border-box" }}
                  />
                </div>
              )}
              <div style={{ display:"flex", gap:8, marginTop:4 }}>
                {i > 0 && (
                  <button type="button" onClick={()=>goQa(i - 1)} className="f-sans"
                    style={{ flex:"0 0 auto", padding:"10px 16px", background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer" }}>← 戻る</button>
                )}
                {/* 最後のページに「保存する」は置かない（2026-08-19たきと指示・下部の共通ボタンと二重になるため） */}
                {i < WORKER_QA_PAGES.length - 1 && (
                  <button type="button" onClick={()=>goQa(i + 1)} className="f-sans"
                    style={{ flex:1, padding:"10px", background: ROLE_ORANGE, color:"#fff", border:"none", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer" }}>次へ →</button>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* 進み具合（タップでそのグループへ）。はたらき方の希望と同じ作法 */}
        <div style={{ display:"flex", justifyContent:"center", gap:6, margin:"12px 0 0" }}>
          {WORKER_QA_PAGES.map(({ group }, i) => (
            <button key={group} type="button" onClick={()=>goQa(i)} aria-label={group}
              style={{ width:8, height:8, borderRadius:"50%", border:"none", padding:0, cursor:"pointer",
                       background: i === qaIdx ? ROLE_ORANGE : "#DDD" }} />
          ))}
        </div>
      </div>
      )}

      {/* モーダルフッター：保存する（全項目upsert）＋自由記述の注記。
          緊急連絡先だけは別テーブル（emergency_contacts）で、ボックス内の「保存する」がDBに書く。
          両方出すと同じ文言のボタンが2つ並ぶので、ここでは出さない（2026-08-05たきと指示） */}
      {editBox !== "emergency" && (
        <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, marginTop:4, background:ROLE_ORANGE }}>{saving ? <>保存中<Dots /></> : "保存する"}</button>
      )}
      </div>
      </div>
      , document.body)}

      {/* ═══ プレビューモーダル（保存済みの内容を表示） ═══ */}
      {showPreview && (
        <div onClick={()=>setShowPreview(false)} className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
          {/* 求人プレビューと同型のボックス：ポップアップ0.8秒・下限=下部フッター+10px（2026-07-16） */}
          {/* touchAction/overscrollBehavior: iOSでスクロールが背面ページに奪われるのを防ぐ（2026-07-14） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"calc(48px + env(safe-area-inset-top, 0px))", bottom:"calc(48px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:"20px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"0 0 8px" }}>プレビュー（保存済みの内容）・項目をタップで編集できます</p>
            <WorkerProfilePreview me={me} onEdit={()=>setShowPreview(false)}
              onEditItem={(key)=>{ setShowPreview(false); setEditFromPreview(true); setEditBox(key); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkerProfilePreview({ me, onEdit, onEditItem }) {
  const [profile, setProfile] = useState(null);
  const [trust, setTrust] = useState(null);
  const [wantAgainCount, setWantAgainCount] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) setProfile(data);
        const { data: ah } = await supabase.from("account_holders").select("created_at").eq("auth_id", session.user.id).maybeSingle();
        setTrust({ joined_at: session.user.created_at, verified_at: ah?.created_at || null });
        const { data: wac } = await supabase.rpc('worker_want_again_count', { p_worker_id: session.user.id });
        if (wac && wac.ok) setWantAgainCount(wac.want_again_count);
      } catch {}
      setLoading(false);
    })();
  }, []);
  // 読み込み中は編集ボックスの仮配置（2026-07-27たきと指示）
  if (loading) return <AutoSkeleton fallbackHeight={92} fallbackCount={5} />;
  const prQa = Array.isArray(profile?.pr_qa) ? profile.pr_qa : [];
  const pendingPrQa = Array.isArray(profile?.pr_qa_pending) ? profile.pr_qa_pending : [];
  const hasPending = !!(profile?.pr_pending || pendingPrQa.length > 0);
  const isEmpty = !profile || (!profile.nickname && !profile.pr && !profile.avatar_url && prQa.length === 0);
  return (
    <div>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>応募したとき、農家にこのように表示されます。</p>
      {isEmpty ? (
        <div style={{ textAlign:"center", padding:"40px 20px", border:"1px solid #EBEBEB", borderRadius:16 }} className="f-sans">
          <div style={{ fontSize:32, marginBottom:14 }}>🧑‍🌾</div>
          <p style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 8px" }}>プロフィールを完成させましょう</p>
          <p style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>自己紹介があると、農家に安心して承認してもらえます。</p>
          <button onClick={onEdit} className="btn-primary f-sans" style={{ padding:"12px 28px", fontSize:14, fontWeight:700, borderRadius:12, background:ROLE_ORANGE }}>はじめる</button>
        </div>
      ) : (
        <div style={{ border:"1px solid #EBEBEB", borderRadius:16, padding:"20px" }}>
          <WorkerTrustCard profile={profile} trust={trust} onEditItem={onEditItem} />
          {prQa.length > 0 && (
            <div style={{ display:"grid", gap:10, marginTop:16 }} onClick={onEditItem ? ()=>onEditItem("qa") : undefined} role={onEditItem ? "button" : undefined}>
              {prQa.map(({ q, a }) => (
                <div key={q} style={onEditItem ? { cursor:"pointer" } : undefined}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* 確認待ち（自由記述は運営確認後に公開。書いたものが消えて見える事故の防止） */}
      {!isEmpty && hasPending && (
        <div style={{ border:"1px solid #F5D98B", background:"#FFF8E7", borderRadius:16, padding:"20px", marginTop:16 }}>
          <span className="f-sans" style={{ display:"inline-block", fontSize:11, fontWeight:700, color:"#8A6D1D", background:"#fff", padding:"3px 10px", borderRadius:20, marginBottom:12 }}>確認待ち</span>
          {profile.pr_pending && (
            <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:"0 0 12px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{profile.pr_pending}</p>
          )}
          {pendingPrQa.length > 0 && (
            <div style={{ display:"grid", gap:10 }}>
              {pendingPrQa.map(({ q, a }) => (
                <div key={q}>
                  <p className="f-sans" style={{ fontSize:11, color:"#8A6D1D", margin:"0 0 2px" }}>{q}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                </div>
              ))}
            </div>
          )}
          <p className="f-sans" style={{ fontSize:11, color:"#8A6D1D", margin:"12px 0 0" }}>運営の確認後、農家に表示される内容として公開されます（最大2日）</p>
        </div>
      )}
      {/* 実績・評価（Part3・席の確保） */}
      {!isEmpty && (
        <div style={{ border:"1px solid #EBEBEB", borderRadius:16, padding:"20px", marginTop:16 }}>
          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:10, letterSpacing:".06em" }}>実績・評価</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>
            まだ勤務実績はありません。初回勤務後から、労働時間・作業・出勤状況が記録されます。
          </p>
          {wantAgainCount > 0 && (
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:ROLE_ORANGE, margin:"10px 0 0" }}>🌟また呼びたい ×{wantAgainCount}</p>
          )}
        </div>
      )}
    </div>
  );
}
