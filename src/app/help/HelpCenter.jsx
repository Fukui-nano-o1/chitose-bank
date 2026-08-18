// ヘルプセンター（#/help・#/help/{chapter}）とアプリの入れ方（#/install）。
// 第2次構造改革2026-08-17でApp.jsxから移設・文面は一字も変えていない。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { isAdmin } from "../../lib/utils";
import { Dots } from "../../components/ui";
import { isIOS } from "../../lib/push";
import { compressImage } from "../../lib/image";

// ── ヘルプセンター（#/help・#/help/{chapter}） ──────────────────
// HELP_CONTENT: 章キー→{num,title,items:[{label,body}]}。
// 画像はここに持たず、help_imagesテーブルからslot_key(章キー+配列index)で引く（管理者アップロード・スロット制）
const HELP_CHAPTER_KEYS = ["about","farmer","worker","mails","info","faq"];
const HELP_CONTENT = {
  about: {
    num: "第1章", title: "chitose-bankとは",
    items: [
      { key:"about-intro",      label: null, body: "chitose-bankは、農家と働き手が直接つながる場です。" },
      { key:"about-principles", label: "3つの原則", body: "① 連絡手段は縛らない\n② 成功報酬は永久に受け取らない\n③ 採否に関与しない" },
      { key:"about-role",       label: null, body: "運営は、場の提供と安全の確認だけを行います。" },
      { key:"about-installapp", label: "アプリとして使う", body: "iPhone（Safari）\n① 共有ボタン（□に↑）をタップ\n② 「ホーム画面に追加」を選ぶ\n③ 右上の「追加」をタップ\n\nAndroid（Chrome）\n① メニュー（⋮）をタップ\n② 「ホーム画面に追加」または「アプリをインストール」を選ぶ\n③ 「インストール」をタップ" },
    ],
  },
  farmer: {
    num: "第2章", title: "農家の流れ",
    items: [
      { key:"farmer-write",           label: "① 求人を書く", body: "途中保存ができるので、時間があるときに少しずつ書き進められます。" },
      { key:"farmer-4checks",         label: "② 掲載前の4つの確認", body: "掲載前に、内容に不備がないか4つの項目を確認します。" },
      { key:"farmer-review",          label: "③ 公開", body: "「掲載する」を押すと、そのまま働き手に公開されます。" },
      { key:"farmer-publish",         label: "④ 公開後の確認", body: "公開後に運営が内容を確認します。法令や安全に関わる問題があれば、修正のお願いや非公開の対応をすることがあります。" },
      { key:"farmer-applyMail",       label: "⑤ 応募メールが届く", body: "働き手から応募があると、メールで知らされます。" },
      { key:"farmer-approve",         label: "⑥ 承認", body: "応募者のプロフィールを見て、承認するか決めます。" },
      { key:"farmer-chatMeet",        label: "⑦ チャットと確認カードで打ち合わせ", body: "承認後、チャットと確認カードで日程や集合場所などを打ち合わせます。" },
      { key:"farmer-insurance",       label: "⑧ 保険の準備", body: "作業当日に備えて、働き手のケガに備える保険（1日傷害保険など）の準備をおすすめします。準備したら「☑保険を準備した」を押しましょう。働き手にお知らせが届きます。" },
      { key:"farmer-confirmStart",    label: "⑨ 当日「開始を確認」", body: "働き手が作業を開始したら、「開始を確認」を押します。" },
      { key:"farmer-completeReview",  label: "⑩ 作業後「完了して評価する」", body: "働き手が来たか確認し、2タップで評価します。" },
      { key:"farmer-fullPay",         label: "満額支払型とは", body: "満額支払型（デフォルト）では、予定より早く作業が終わっても、予定していた時間分の報酬が満額支払われます。" },
    ],
  },
  worker: {
    num: "第3章", title: "働き手の流れ",
    items: [
      { key:"worker-register",    label: "① 登録", body: "メールアドレスで登録します。" },
      { key:"worker-verify",      label: "② 登録情報", body: "氏名・住所・生年月日を入力します（書類確認はありません）。" },
      { key:"worker-profile",     label: "③ プロフィール", body: "書いた分だけ農家に伝わります。自己紹介（自由記述）も保存するとすぐ公開されます（電話番号・メールアドレス・URLは記載できません）。" },
      { key:"worker-apply",       label: "④ 応募", body: "気になる求人に応募します。" },
      { key:"worker-approveMail", label: "⑤ 承認メール", body: "農家が承認すると、メールで知らされます。" },
      { key:"worker-chatMeet",    label: "⑥ チャット・確認カード", body: "チャットと確認カードで、日程や集合場所などを打ち合わせます。" },
      { key:"worker-startWork",   label: "⑦ 当日「▶ 作業を開始する」", body: "作業を始めるときに押します。" },
      { key:"worker-endReview",   label: "⑧ 終了後「✓ 終了を確認」", body: "作業が終わったら押し、3タップで評価します。" },
    ],
  },
  mails: {
    num: "第4章", title: "届くメール一覧",
    items: [
      { key:"mails-jobPublished",      label: "M01　求人が公開されました", body: "いつ：求人が公開された時（掲載＝即公開）／誰に：農家／内容：公開と同時に届きます。応募が入ると「M02 応募あり」が届きます" },
      { key:"mails-applied",           label: "M02　応募あり", body: "いつ：働き手が応募した時／誰に：農家／内容：応募者カードつきの通知" },
      { key:"mails-applyConfirm",      label: "M28　応募の確認", body: "いつ：応募した時／誰に：働き手本人／内容：応募の控え。応募した時刻・来られる日・承認までの流れ・取り消しの方法と、応募状況ページ・求人ページへのリンクがあります" },
      { key:"mails-approved",          label: "M03　承認のお知らせ", body: "いつ：農家が承認した時／誰に：働き手" },
      { key:"mails-rejected",          label: "M04　応募の結果のお知らせ", body: "いつ：農家が見送りにした時／誰に：働き手" },
      { key:"mails-applyCanceled",     label: "M05　応募の取り消し", body: "いつ：働き手が応募を取り消した時／誰に：農家" },
      { key:"mails-cancelConfirm",     label: "M29　応募取り消しの確認", body: "いつ：応募を取り消した時／誰に：働き手本人／内容：取り消しの控え。取り消した時刻と、農家にお知らせ済みで対応不要なこと、再応募できること、求人ページ・さがすへのリンクがあります" },
      { key:"mails-applyExpired",      label: "M06　応募の失効", body: "いつ：農家の判断がないまま作業日を迎えた時（自動で失効します）／誰に：働き手／内容：働き手に不利益の記録は残りません" },
      { key:"mails-replyReminder",     label: "M07　応募への返答のお願い", body: "いつ：作業前日（承認待ちのままの応募がある時）／誰に：農家" },
      { key:"mails-noReplySeries",     label: "M34〜M39　応募が未回答のときのお知らせ", body: "いつ：応募から12・24・36・48・60・72時間が経過しても回答がない時／誰に：農家／内容：応募者が待っていることをお知らせします。応募者ページで「承認・見送り・保留・対応済み」のいずれかを選ぶと止まります。72時間未回答は、利用規約に基づく利用制限の審査対象になります" },
      { key:"mails-message",           label: "チャットの新着（メールは送りません）", body: "チャットに新しいメッセージが届いても、メールは送りません。お知らせはアプリの通知（プッシュ）と、サイト内のお知らせでお伝えします。メッセージの本文はチャットでご確認ください" },
      { key:"mails-revision",          label: "M21　求人修正のお願い", body: "いつ：公開後の確認で修正をお願いする時／誰に：農家" },
      { key:"mails-insuranceReminder", label: "M08　保険のご準備を", body: "いつ：承認後・作業日の3日前・前日17時／誰に：農家" },
      { key:"mails-insuranceDone",     label: "M09　保険の準備の報告", body: "いつ：農家が「保険を準備した」と報告した時／誰に：働き手\nこのお知らせは農家からの報告に基づきます（運営が保険の証書を確認するものではありません）" },
      { key:"mails-startSoon",         label: "M10　開始まであと1時間です", body: "いつ：作業開始の1時間前／誰に：農家・働き手の双方／内容：準備の確認（働き手＝集合場所・持ち物・移動、農家＝受け入れ準備）。「緊急連絡をする」ボタンつき。※すでに作業が始まっている時は送りません" },
      { key:"mails-startSoon15",       label: "M31　開始まであと15分です", body: "いつ：作業開始の15分前／誰に：農家・働き手の双方／内容：異常があるなら今すぐ連絡（遅れる・到着できない・予定変更）。「緊急連絡をする」ボタンつき" },
      { key:"mails-startNow",          label: "M32　仕事開始の時間です", body: "いつ：作業開始の時刻／誰に：農家・働き手の双方／内容：働き手＝開始時刻は自動で記録されます（「今日の仕事を見る」）。農家＝「開始を確認する」（来なかった場合もここから記録できます）。※農家がすでに開始を確認していれば、農家には送りません" },
      { key:"mails-endNow",            label: "M33　仕事終了の時間です", body: "いつ：作業終了の予定時刻／誰に：農家・働き手の双方／内容：報酬は当日その場で現金でお渡し・お受け取りください。働き手＝「終了を確認して評価する」、農家＝「完了して評価する」。※すでに確認・完了を記録していれば、その相手には送りません。作業後の繰り返しのお知らせはありません（M12・M13が担います）" },
      { key:"mails-doneCheck",         label: "M12　作業は終わりましたか", body: "いつ：作業日翌朝9時（最大2回）／誰に：農家" },
      { key:"mails-reviewRequest",     label: "M13　評価のお願い", body: "いつ：作業が完了した時／誰に：働き手" },
      { key:"mails-reviewArrived",     label: "M19　🌟評価が届きました", body: "いつ：相手からの評価が公開された時／誰に：農家・働き手の双方／内容：お互いの評価が揃うか、3日たつと公開されます（3日ルール）" },
      { key:"mails-noShow",            label: "M14　欠勤の記録", body: "いつ：農家が欠勤を記録した時／誰に：働き手／内容：72時間以内に異議申立ができます" },
      { key:"mails-emergency",         label: "M11　緊急連絡", body: "いつ：遅刻・欠勤・中止・延期・欠勤記録への異議の連絡があった時／誰に：相手方（即時）\n現地で会えない時の連絡も、ここから送れます（日時が記録され、話し合いの資料になります）" },
      { key:"mails-repeatNewJob",      label: "M16　🌟また呼びたい農家さんの新求人", body: "いつ：あなたを「また呼びたい」に登録した農家さんが新しい求人を公開した時／誰に：指名リストの働き手" },
      { key:"mails-repeatInstant",       label: "M17　🌟即決で承認されました", body: "いつ：以前「また呼びたい」と評価してくれた農家さんの求人に応募し、選考なしで確定した時／誰に：働き手" },
      { key:"mails-repeatInstantFarmer", label: "M18　🌟リピート即決のお知らせ", body: "いつ：自分の求人の設定（また呼びたい即決）に基づいて自動承認が実行された時／誰に：農家" },
      { key:"mails-jobQuestion",       label: "M22　求人に質問が届きました", body: "いつ：働き手があなたの求人に質問した時／誰に：農家／内容：回答は求人ページの「質問」タブからできます。回答は他の閲覧者にも公開され、同じ質問を減らせます" },
      { key:"mails-jobQuestionAnswered", label: "M23　質問に回答がつきました", body: "いつ：あなたがした求人への質問に、農家が回答した時／誰に：質問した働き手／内容：回答は求人ページの「質問」タブで、その求人を見る全員に公開されます" },
      { key:"mails-emergencyContact",  label: "M30　緊急連絡先のご登録のお願い", body: "いつ：運営からのお願い（不定期）／誰に：緊急連絡先が未登録の方／内容：プロフィール編集ページの「🆘 緊急連絡先」への案内。登録した連絡先は、採用が決まった相手にだけ表示されます" },
      { key:"mails-policyUpdate",      label: "M40・M41　規約・プライバシーポリシーの改訂のお知らせ", body: "いつ：プライバシーポリシー（M40）や利用規約（M41）を改訂した時／誰に：ご利用中の方全員／内容：何を変えたかの要点と、全文へのリンク。同じ版のお知らせが二度届くことはありません" },
    ],
  },
  info: {
    num: "第5章", title: "あなたの情報の扱い",
    items: [
      { key:"info-personalData", label: "氏名・住所・生年月日", body: "運営のみが保管します。画面には「✓ 連絡先確認済み」バッジだけが表示されます（お名前などの値は相手にも表示されません）。" },
      { key:"info-profileData",  label: "ニックネーム・写真・自己紹介・Q&A・タグ", body: "応募先の農家に表示されます。自由記述は保存するとすぐ公開されます（電話番号・メールアドレス・URLは記載できません。公開後に運営が確認します）。" },
      { key:"info-externalRecord", label: "他のサービスでの実績について", body: "他サービスでの経験は、ご本人の自己申告として表示されます。運営が確認したものではありません。\nchitose-bankの実績（🌟・完了数・作業時間）は、このサイトでの働きの記録からだけ作られ、自己申告では増えません。" },
      { key:"info-address",      label: "集合場所の番地", body: "承認された働き手にだけ表示されます。" },
      { key:"info-chat",         label: "チャット", body: "当事者だけが読めます。" },
      { key:"info-reviews",      label: "評価", body: "良い評価のみ公開されます。お互いの評価が揃うか、3日たつまでは相手に見えません。メモは自分だけが見られます。" },
      { key:"info-report",       label: "通報", body: "通報した人が誰かは、相手に伝わりません。" },
    ],
  },
  faq: {
    num: "第6章", title: "困ったとき",
    items: [
      { key:"faq-askBeforeApply",  label: "応募前に質問できますか", body: "求人ページの質問タブからどうぞ。回答は全員に公開されます。" },
      { key:"faq-interview",       label: "面接はできますか", body: "農家は「面接の質問集」をチャットに送れます（プロフィールから作成・テンプレートのコピーも可）。回答もチャットに残るので、あとから見返せます。集合場所や持ち物の確認も、このチャットでやり取りできます。" },
      { key:"faq-cancelApply",     label: "応募を取り消したい", body: "返事待ちタブから取り消せます。承認された後は、緊急連絡からご相談ください。" },
      { key:"faq-noContact",       label: "承認されたのに連絡がない", body: "承認後の連絡はチャットで届きます。チャットを確認しても連絡がない場合は、お問い合わせ窓口までご連絡ください。" },
      { key:"faq-cantGo",          label: "当日行けなくなった", body: "チャット画面の「⚠️ 緊急連絡」ボタンから、遅れる・欠勤の連絡ができます。相手にすぐに通知されます。" },
      { key:"faq-noShowOrDiffer",  label: "農家が来ない・話が違う", body: "求人詳細ページ最下部の「⚑ 報告する」から通報できます。通報した人が誰かは相手に伝わりません。" },
      // 募集主の法定表示（2026-07-30・第14弾）：なぜ書くのかを一言で答える
      { key:"faq-whyRecruiterInfo", label: "なぜ住所や連絡先を書くのですか", body: "求人広告には、募集主の氏名（名称）・住所・連絡先の表示が法律で義務づけられているためです（職業安定法）。業務内容・就業場所・賃金と合わせた6項目が、求人ページに必ず表示されます。ニックネームとは別に、正式な情報をプロフィールの「募集者の情報」にご記入ください。" },
      { key:"faq-payWho",          label: "報酬はいつ誰からもらえますか", body: "報酬は農家から直接受け取ります。運営は報酬のやり取りに関与しません。" },
      { key:"faq-earlyFinish",     label: "早く終わったら給与は減りますか", body: "満額支払型（デフォルト）の求人では、予定より早く作業が終わっても、予定していた時間分の報酬が満額支払われます。" },
      { key:"faq-wrongReview",     label: "評価を間違えた", body: "お問い合わせ窓口までご連絡ください。" },
      { key:"faq-profileHidden",   label: "自己紹介が表示されない", body: "自己紹介は保存するとすぐ公開されます。表示されない時は、画面を引き下げて更新してみてください。電話番号・メールアドレス・URLが含まれていると保存できません。" },
      { key:"faq-withdraw",        label: "退会したい", body: "お問い合わせ窓口までご連絡ください。" },
      { key:"faq-insuranceWho",    label: "保険は誰が掛けますか", body: "保険の準備は農家にお願いしています（1日傷害保険など・多くは前日までの加入が必要です）。農家が「保険を準備した」と報告すると、働き手にお知らせが届きます。お知らせは農家からの報告に基づくもので、運営が証書を確認するものではありません。気になる時は、チャットで保険の内容を気軽に確認してください。働き手自身が1日数百円の傷害保険に入ることもできます。農家プロフィールで、保険の準備の方針を表明できます（自己申告）。" },
      { key:"faq-howToReport",     label: "通報のしかた", body: "求人詳細ページ最下部の「⚑ 報告する」から通報できます。" },
      { key:"faq-howToDispute",    label: "異議申立のしかた", body: "欠勤記録の通知から72時間以内に、アプリから異議申立ができます。" },
      { key:"faq-contact",         label: "お問い合わせ", body: "t5fki6643qty@gmail.com までご連絡ください。苦情には遅滞なく対応します。" },
    ],
  },
};

// help-imagesバケットの公開URLから、削除に必要なストレージパスだけを取り出す
function helpImagePathFromUrl(url) {
  if (!url) return null;
  const marker = "/help-images/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length).split("?")[0];
}


// インストール案内（#/install・未ログインでも閲覧可・2026-07-22）：OS自動判定で手順を並べ、
// 画像2枠（help_images: install-ios / install-android）は管理者がアップロードできる（ヘルプ画像スロット方式）
export function InstallGuide({ me }) {
  const [images, setImages] = useState({});
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const admin = isAdmin(me);
  const ios = isIOS();
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("help_images").select("slot_key,url").in("slot_key", ["install-ios","install-android"]);
        if (data) { const m = {}; data.forEach(r => { m[r.slot_key] = r.url; }); setImages(m); }
      } catch {}
    })();
  }, []);
  const upload = async (slotKey, file) => {
    if (!file || uploadingSlot) return;
    setUploadingSlot(slotKey);
    try {
      // スクショは原寸1〜3MB級ので長辺1280px・品質0.75に圧縮してから上げる（表示幅760pxの約1.7倍=Retina十分・2026-07-26）
      const upFile = await compressImage(file, 1280, 0.75);
      const ext = (upFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = slotKey + "." + ext;
      const { error: upErr } = await supabase.storage.from("help-images").upload(path, upFile, { upsert: true });
      if (upErr) { alert("アップロードに失敗しました：" + upErr.message); setUploadingSlot(null); return; }
      const { data: urlData } = supabase.storage.from("help-images").getPublicUrl(path);
      const url = (urlData?.publicUrl || "") + "?t=" + Date.now();
      const { error: dbErr } = await supabase.from("help_images").upsert({ slot_key: slotKey, url, updated_at: new Date().toISOString() });
      if (dbErr) { alert("保存に失敗しました：" + dbErr.message); setUploadingSlot(null); return; }
      setImages(prev => ({ ...prev, [slotKey]: url }));
    } catch { alert("アップロードに失敗しました。"); }
    setUploadingSlot(null);
  };
  const slot = (slotKey, label, steps) => (
    <div key={slotKey} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"20px", boxShadow:"0 2px 10px rgba(0,0,0,0.05)" }}>
      <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{label}</p>
      <ol className="f-sans" style={{ margin:"0 0 14px", paddingLeft:20, fontSize:14, color:"#333", lineHeight:1.9 }}>
        {steps.map((s,i) => <li key={i}>{s}</li>)}
      </ol>
      {/* 画像が無いときは何も出さない（2026-07-27たきと指示）：「準備中」の空枠は訪問者には不要 */}
      {images[slotKey] && <img src={images[slotKey]} alt={label+"の手順"} loading="lazy" decoding="async" style={{ width:"100%", borderRadius:12, display:"block" }} />}
      {admin && (
        <label className="f-sans" style={{ display:"inline-block", marginTop:10, fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>
          {uploadingSlot===slotKey ? <>アップロード中<Dots /></> : (images[slotKey] ? "画像を差し替え" : "＋ 画像をアップロード")}
          <input type="file" accept="image/*" style={{ display:"none" }} onChange={e => upload(slotKey, e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
  const iosSlot = slot("install-ios", "iPhone（Safari）", ["Safariでこのページを開く","下の共有ボタン（□に↑）をタップ","「ホーム画面に追加」を選ぶ","右上の「追加」をタップ"]);
  const andSlot = slot("install-android", "Android（Chrome）", ["Chromeでこのページを開く","右上のメニュー（⋮）をタップ","「アプリをインストール」または「ホーム画面に追加」を選ぶ","「インストール」をタップ"]);
  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"40px 16px 60px" }}>
      <div style={{ textAlign:"center", marginBottom:28 }}>
        {/* 🥦は削除（2026-07-27たきと指示） */}
        <h1 className="f-sans" style={{ fontSize:24, fontWeight:800, color:"#222", margin:"0 0 6px" }}>chitose-bankをアプリとして入れる</h1>
        <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7, margin:0 }}>ホーム画面に追加すると、アプリのように開けて通知も受け取れます。</p>
        {/* 訪問者の「入れ方」タブから来る人向けに、何をするのかを最初に明記する（2026-07-27たきと指示） */}
        <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:"12px auto 0", maxWidth:420, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", textAlign:"left" }}>
          App Store・Google Playからのインストールは不要です。いま見ているこのページを、お使いのブラウザから
          ホーム画面に置くだけで完了します。下の手順のとおりに進めてください（1分ほどで終わります）。
        </p>
      </div>
      <div style={{ display:"grid", gap:16 }}>
        {ios ? <>{iosSlot}{andSlot}</> : <>{andSlot}{iosSlot}</>}
      </div>
    </div>
  );
}

export function HelpCenter({ me, onReportClick }) {
  const chapterFromHash = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const m = h.match(/^help\/(\w+)$/);
    return (m && HELP_CHAPTER_KEYS.includes(m[1])) ? m[1] : null;
  };
  const [openChapter, setOpenChapter] = useState(chapterFromHash());
  const [images, setImages] = useState({}); // { [slot_key]: url }
  const [uploadingSlot, setUploadingSlot] = useState(null);
  useEffect(() => {
    const onHash = () => setOpenChapter(chapterFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!openChapter) return;
    const el = document.getElementById("help-" + openChapter);
    if (el) setTimeout(() => el.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
  }, [openChapter]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("help_images").select("slot_key,url");
        if (data) {
          const map = {};
          data.forEach(row => { map[row.slot_key] = row.url; });
          setImages(map);
        }
      } catch {}
    })();
  }, []);
  const toggle = (key) => {
    const next = openChapter === key ? null : key;
    setOpenChapter(next);
    window.location.hash = next ? "/help/" + next : "/help";
  };
  const uploadSlotImage = async (slotKey, file) => {
    if (uploadingSlot) return;
    setUploadingSlot(slotKey);
    try {
      // スクショは原寸1〜3MB級ので長辺1280px・品質0.75に圧縮してから上げる（表示幅760pxの約1.7倍=Retina十分・2026-07-26）
      const upFile = await compressImage(file, 1280, 0.75);
      const ext = (upFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = slotKey + "." + ext;
      const { error: upErr } = await supabase.storage.from("help-images").upload(path, upFile, { upsert: true });
      if (upErr) { alert("アップロードに失敗しました：" + upErr.message); setUploadingSlot(null); return; }
      const { data: urlData } = supabase.storage.from("help-images").getPublicUrl(path);
      const url = (urlData?.publicUrl || "") + "?t=" + Date.now();
      const { error: dbErr } = await supabase.from("help_images").upsert({ slot_key: slotKey, url, updated_at: new Date().toISOString() });
      if (dbErr) { alert("保存に失敗しました：" + dbErr.message); setUploadingSlot(null); return; }
      setImages(prev => ({ ...prev, [slotKey]: url }));
    } catch { alert("アップロードに失敗しました。"); }
    setUploadingSlot(null);
  };
  const deleteSlotImage = async (slotKey) => {
    if (!confirm("この画像を削除しますか？")) return;
    try {
      const path = helpImagePathFromUrl(images[slotKey]);
      if (path) await supabase.storage.from("help-images").remove([path]);
      const { error } = await supabase.from("help_images").delete().eq("slot_key", slotKey);
      if (error) { alert("削除に失敗しました：" + error.message); return; }
      setImages(prev => { const next = { ...prev }; delete next[slotKey]; return next; });
    } catch { alert("削除に失敗しました。"); }
  };
  // 既存スクショの一括軽量化（管理者のみ・2026-07-26）：圧縮なしで上がった原寸PNG級を、ブラウザで
  // 取得→compressImage(1280px/0.75)→差し替え。png→jpgで拡張子が変わったら旧ファイルを削除しURLも更新。
  // 既に軽い画像（compressImageが原本を返す）はスキップ＝何度押しても安全
  const [recompressing, setRecompressing] = useState("");
  const recompressAll = async () => {
    if (recompressing) return;
    const entries = Object.entries(images);
    if (!entries.length) { alert("画像がありません。"); return; }
    if (!confirm(`ガイドのスクショ${entries.length}枚を軽量化して差し替えます。よろしいですか？`)) return;
    let done = 0, replaced = 0, savedBytes = 0;
    for (const [slotKey, url] of entries) {
      done++; setRecompressing(`${done}/${entries.length}`);
      try {
        const res = await fetch(url.split("?")[0] + "?t=" + Date.now(), { cache: "reload" });
        if (!res.ok) continue;
        const blob = await res.blob();
        const file = new File([blob], helpImagePathFromUrl(url) || slotKey + ".jpg", { type: blob.type });
        const upFile = await compressImage(file, 1280, 0.75);
        if (upFile === file) continue; // 既に軽い
        const ext = (upFile.name.split(".").pop() || "jpg").toLowerCase();
        const path = slotKey + "." + ext;
        const { error: upErr } = await supabase.storage.from("help-images").upload(path, upFile, { upsert: true });
        if (upErr) continue;
        const oldPath = helpImagePathFromUrl(url);
        if (oldPath && oldPath !== path) { try { await supabase.storage.from("help-images").remove([oldPath]); } catch { /* 旧ファイル残置は表示に影響なし */ } }
        const { data: urlData } = supabase.storage.from("help-images").getPublicUrl(path);
        const newUrl = (urlData?.publicUrl || "") + "?t=" + Date.now();
        const { error: dbErr } = await supabase.from("help_images").upsert({ slot_key: slotKey, url: newUrl, updated_at: new Date().toISOString() });
        if (dbErr) continue;
        setImages(prev => ({ ...prev, [slotKey]: newUrl }));
        replaced++; savedBytes += Math.max(0, blob.size - upFile.size);
      } catch { /* この1枚は飛ばして続行 */ }
    }
    setRecompressing("");
    alert(`軽量化が完了しました：${entries.length}枚中 ${replaced}枚を差し替え（約${Math.round(savedBytes / 1024 / 1024 * 10) / 10}MB削減）`);
  };
  return (
    <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（モバイル・CSS側の負マージン併用） */}
      <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>使い方ガイド</h1>
      <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom: isAdmin(me) ? 12 : 36 }}>chitose-bankの使い方をまとめています</p>
      {isAdmin(me) && (
        <button onClick={recompressAll} disabled={!!recompressing} className="f-sans" style={{ marginBottom:24, padding:"8px 14px", fontSize:12, fontWeight:700, color:"#717171", background:"#F7F7F7", border:"1px dashed #D0D0D0", borderRadius:10, cursor: recompressing ? "default" : "pointer" }}>
          {recompressing ? <>🗜 軽量化中 {recompressing}<Dots /></> : "🗜 スクショを一括軽量化（管理）"}
        </button>
      )}
      <div style={{ display:"grid", gap:16 }}>
        {HELP_CHAPTER_KEYS.map(key => {
          const ch = HELP_CONTENT[key];
          const isOpen = openChapter === key;
          return (
            <section key={key} id={"help-" + key} style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", overflow:"hidden" }}>
              <button onClick={() => toggle(key)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"20px 24px", background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <span>
                  <span style={{ display:"block", fontSize:12, color:"#B0B0B0", marginBottom:2 }}>{ch.num}</span>
                  <span style={{ fontSize:19, fontWeight:700, color:"#222" }}>{ch.title}</span>
                </span>
                <span style={{ fontSize:22, color:"#B0B0B0", flexShrink:0 }}>{isOpen ? "－" : "＋"}</span>
              </button>
              {isOpen && (
                <div style={{ padding:"0 24px 24px", display:"grid", gap:20 }}>
                  {key === "faq" && me && (
                    <button onClick={onReportClick} className="f-sans" style={{
                      justifySelf:"start", padding:"9px 18px", fontSize:13, fontWeight:600, color:"#00A86B",
                      background:"#E6F7EF", border:"none", borderRadius:20, cursor:"pointer",
                    }}>💬 この画面を報告</button>
                  )}
                  {ch.items.map((it, i) => {
                    const slotKey = it.key;
                    const imgUrl = images[slotKey];
                    return (
                      <div key={slotKey}>
                        {it.label && <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 6px" }}>{it.label}</p>}
                        <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap" }}>{it.body}</p>
                        {imgUrl && (
                          /* 画像は2倍表示（2026-07-27たきと指示）：横幅いっぱいだと文字が小さくて読めないため、
                             縦横とも2倍に拡大する＝高さが2倍になる。比率は変えない（引き伸ばすと文字がぼやける）。
                             はみ出した横方向はこの枠の中だけを指でなぞって送れる（ページは横スクロールしない） */
                          <div style={{ marginTop:12, overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", borderRadius:12 }}>
                            <img src={imgUrl} alt="" loading="lazy" decoding="async" style={{ display:"block", width:"200%", maxWidth:"none", borderRadius:12, border:"3px solid #E0E0E0", boxShadow:"0 4px 16px rgba(0,0,0,0.12)", boxSizing:"border-box" }} />
                          </div>
                        )}
                        {isAdmin(me) && (
                          <div style={{ marginTop:8 }}>
                            {imgUrl ? (
                              <button onClick={() => deleteSlotImage(slotKey)} className="f-sans" style={{ fontSize:11, color:"#E24B4A", background:"none", border:"1px solid #E24B4A44", borderRadius:8, padding:"4px 10px", cursor:"pointer" }}>🗑 削除</button>
                            ) : (
                              <label className="f-sans" style={{ display:"inline-block", fontSize:11, color:"#717171", background:"#F7F7F7", border:"1px dashed #D0D0D0", borderRadius:8, padding:"4px 10px", cursor: uploadingSlot ? "default" : "pointer" }}>
                                {uploadingSlot === slotKey ? <>アップロード中<Dots /></> : "＋ スクショを追加"}
                                <input type="file" accept="image/*" disabled={!!uploadingSlot} onChange={e => { const f = e.target.files?.[0]; if (f) uploadSlotImage(slotKey, f); e.target.value = ""; }} style={{ display:"none" }} />
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {/* 素材の出典（2026-08-08）：作物アイコンに game-icons.net（CC BY 3.0）を使用している。
          CC BY はクレジット表示が条件なので、この掲示は消さないこと（消すとライセンス違反）。
          地図の出典（国土地理院）は地図の中に出しているのと同じ考え方で、素材ごとに出典を示す */}
      <div className="f-sans" style={{ maxWidth:820, margin:"28px auto 0", padding:"14px 16px", borderTop:"1px solid #EEE", fontSize:11, color:"#B0B0B0", lineHeight:1.9 }}>
        <p style={{ margin:0, fontWeight:700, color:"#999" }}>このサイトについて</p>
        <p style={{ margin:"4px 0 0" }}>
          作物のアイコンは <a href="https://game-icons.net/" target="_blank" rel="noopener noreferrer" style={{ color:"#00A86B" }}>game-icons.net</a>（作者：Delapouite、Lorc ほか）の素材を、
          <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer" style={{ color:"#00A86B" }}>CC BY 3.0</a> のもとで使用しています（色を変更しています）。
        </p>
        <p style={{ margin:"4px 0 0" }}>
          地図は <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer" style={{ color:"#00A86B" }}>国土地理院</a>のタイルを使用しています。
        </p>
      </div>
    </div>
  );
}
