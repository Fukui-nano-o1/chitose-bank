// 委託レーンの型（定数と純関数）。第2次構造改革2026-08-17で ConsignmentRoom.jsx から分離。
// ここには React も Supabase も入れない＝画面にもDBにも依存しない層（純粋な語彙だけ）。
// ★CONSIGNOR_CONSENT_VERSION を変えると委託者に再同意が出る。文言を直したら必ず版も上げる。

export const CONSIGN_STEPS = ["下書き", "合意", "着手金", "作業中", "検収", "支払", "完了"];
export const consignStepState = (d) => {
  const s = d.spec || {}; const st = d.status || "draft";
  const beyond = (arr) => arr.includes(st);
  const hasDeposit = !!(s.advance && String(s.advance).trim()) || (d.deposit_amount != null && d.deposit_amount > 0);
  const done = [
    true,                                                                    // 下書き
    beyond(["agreed","working","inspected","paid","done"]) || !!d.agreed_at,  // 合意
    (!hasDeposit) || !!s.deposit_received_at || beyond(["working","inspected","paid","done"]), // 前金
    beyond(["working","inspected","paid","done"]),                           // 作業中
    !!d.inspected_at || beyond(["inspected","paid","done"]),                 // 検収
    !!d.paid_at || beyond(["paid","done"]),                                  // 支払
    st === "done",                                                           // 完了
  ];
  return { done, active: done.findIndex(x => !x) };
};

// 状態バッジ（2026-07-31たきと指示・ブラック）：色相で分けず、進むほど濃くなる濃淡の階段にする。
// 求人・求職の帯（橙／緑）とは別の世界＝色相は持ち込まない
export const CONSIGN_STATUS = [
  { k:"draft",     l:"下書き", bg:"#F5F5F5", fg:"#999999" },
  { k:"agreed",    l:"合意",   bg:"#E5E5E5", fg:"#444444" },
  { k:"working",   l:"作業中", bg:"#111111", fg:"#FFFFFF" },
  { k:"inspected", l:"検収済", bg:"#3A3A3A", fg:"#FFFFFF" },
  { k:"paid",      l:"支払済", bg:"#5C5C5C", fg:"#FFFFFF" },
  { k:"done",      l:"完了",   bg:"#F3F3F3", fg:"#999999" },
];

// 募集状況（掲載画面に出す状態）＝内部statusから自動導出（2026-07-31たきと指示・二重管理しない）。
// 内部 draft→募集中／agreed→募集終了（受託者決定）／working・inspected・paid→作業中／done→完了
export const consignRecruitState = (status) => {
  if (status === "done") return { l:"完了", bg:"#F3F3F3", fg:"#999999" };
  if (["working", "inspected", "paid"].includes(status)) return { l:"作業中", bg:"#3A3A3A", fg:"#FFFFFF" };
  if (status === "agreed") return { l:"募集終了", bg:"#E5E5E5", fg:"#444444" };
  return { l:"募集中", bg:"#111111", fg:"#FFFFFF" }; // draft（既定）＝掲載中・応募受付
};

// 履行期限は開始+終了の日付範囲（2026-07-31たきと指示）。raw は spec.date_start/date_end(ymd)、
// 表示用ラベルは spec.deadline に持たせる（カード/印刷/スナップショットは deadline を読む＝据え置き）。
// 復元は raw から。文字列パースで逆算しない（day4教訓#4）
export const parseYmd = (s) => { if (!s) return null; const p = String(s).split("-").map(Number); return p.length === 3 && p.every(n => !isNaN(n)) ? new Date(p[0], p[1] - 1, p[2]) : null; };
export const deadlineLabel = (ds, de) => {
  const s = parseYmd(ds); if (!s) return "";
  const e = parseYmd(de) || s;
  const cy = new Date().getFullYear();
  const f = (dt) => (dt.getFullYear() === cy ? "" : dt.getFullYear() + "年") + (dt.getMonth() + 1) + "月" + dt.getDate() + "日";
  return s.getTime() === e.getTime() ? f(s) : f(s) + " 〜 " + f(e);
};


export const CONSIGN_FIXED_CLAUSES = [
  "本委託の対価は作業の実施であり、収量・収益を保証するものではありません",
  "賠償は本件報酬額を上限とし、逸失利益は対象外とします（故意・重過失を除く）",
  "作業の指揮命令は受託者の責任者が行います",
  "天候等による中止：開始◯日前までの通知は無償、以後は前金を上限に精算",
  "支払い：前金→区画ごとの検収後に残額",
];

// 作物はブロッコリー固定（2026-07-31たきと指示「作物はブロッコリーだけ」）。
// 入力欄は置かず固定表示。保存時も必ずこの値を書く（spec.crop）＝カード/印刷/スナップショットに反映
export const CONSIGN_CROP = "ブロッコリー";

export const CONSIGN_EMPTY = { field_name:"", region:"徳島県吉野川市", area_a:"", crop:CONSIGN_CROP, task:"", deadline:"", date_start:"", date_end:"", unit_price_10a:"", advance:"", pay_method:"", onsite_contact_mode:"", onsite_name:"", onsite_phone:"", inspection:"", offgrade:"", field_cond:"", facility_parking:"", facility_toilet:"", facility_rest:"", facility_lend:"", hazards:[], hazard_other:"", photos:[], special:"" };

export const CONSIGN_BASIC_FIELDS = [
  { k:"field_name",     l:"圃場の呼び名", ph:"例：川向こうの畑" },
  { k:"region",         l:"地域", ph:"例：徳島県吉野川市（番地は掲載しない）" },
  { k:"area_a",         l:"面積（a）", ph:"例：30" },
  { k:"crop",           l:"作物" },
  { k:"task",           l:"作業" },
  { k:"deadline",       l:"履行期限", help:"作業を終わらせる期日（期間）です。この日までに作業を完了する約束になり、仕様書と契約書に印字されます。収穫の適期など、遅れると困る事情があるときは余裕をもたずに正確な日付を示してください。開始日をタップし、続けて終了日をタップすると期間になります（1日だけなら同じ日をもう一度タップ）。" },
  { k:"unit_price_10a", l:"単価（10aあたり・円）", ph:"例：15000" },
  { k:"advance",        l:"着手金（前払金・円）", ph:"例：10000" },
  // 支払いは案件ごとの取引条件（2026-08-02たきと指示・利用者の属性ではない）。文言は希望でなく断定形
  { k:"pay_method",     l:"この案件の支払方法" },
];

// 作業は3択・複数選択可（2026-07-31たきと指示）。値は「・」区切りの文字列で spec.task に保存
// ＝印刷・凍結スナップショット・カード表示（いずれも spec.task を文字列で読む）を変更せずに済む
export const CONSIGN_TASKS = ["収穫", "検品", "出荷"];

// 危険情報はチェック式（2026-07-31たきと指示・自由記述だと書かれず埋もれるため）。
// 選択は spec.hazards（配列）、その他の自由記述は spec.hazard_other に保存
export const CONSIGN_HAZARDS = ["電柵あり", "急斜面", "ぬかるみ", "農薬散布後", "その他"];

// 新規委託ウィザード（2026-07-31たきと指示）：「入力順」でなく「契約が成立するまでの思考順」。
// 受託者の頭の中＝何やる？→できる？→いくら？→いつ？→危なくない？→応募 に合わせた5ステップ。
// 1ページ1つの問い（最低限の情報UI・最大限のUX）
export const CONSIGN_WIZ_STEPS = [
  { t:"案件概要",   q:"何を頼みますか？",             d:"どんな仕事なのかを3秒で理解できるように。" },
  { t:"作業仕様",   q:"どう終われば完了ですか？",     d:"揉めない仕様をつくります。" },
  { t:"報酬",       q:"いくら払いますか？",           d:"受託者が応募するか判断する情報です。" },
  { t:"日程・安全", q:"いつやりますか？危険は？",     d:"受託可能かの判断と、事故防止のために。" },
  { t:"確認・掲載", q:"内容を確認して掲載します",     d:"掲載ミスを防ぐ最終チェックです。" },
];

export const CONSIGN_TEXT_FIELDS = [
  { k:"inspection", l:"検収基準", ph:"例：2L以上・軸2cm・コンテナ渡し" },
  // 検収基準を外れた作物の扱い（2026-08-03たきと指示）：基準＝合否の線引き、本項＝外れた分をどうするか。
  // 決めずに始めると「収穫したのに数えられない」「捨てた/持ち帰ったで揉める」が起きるため必須級の取り決め
  { k:"offgrade",   l:"検収基準外作物の扱い", ph:"例：規格外は別コンテナに分けて畑の入口へ。報酬の対象には含めない",
    help:"検収基準に届かなかった作物（小さい・傷・変形など）を、どう扱うかの取り決めです。①その場に残すのか、分けて回収するのか、②報酬の対象に含めるのか含めないのか、③持ち帰りを認めるのか、の3点を決めておくと、作業後の食い違いを防げます。基準外の判断が難しい場合の連絡方法も書けます。" },
  { k:"field_cond", l:"圃場条件", ph:"残渣・傾斜・進入路など" },
  { k:"special",    l:"特約",     ph:"あれば記入" },
];

// 草の形（2026-07-31たきと提供イメージ：茎に小さな楕円の葉が互い違いにつく枝葉のシルエット）。

export const CORP_KINDS = ["株式会社", "合同会社", "農事組合法人", "その他"];

// 入力欄の定義（h=小見出し/ta=複数行/sel=ピル選択/num=数字のみ/zip=郵便番号検索付き/note=補足）
// 個人事業者が委託掲載で新たに聞くのは原則これだけ（2026-07-31たきと指示）：
// 屋号の有無・屋号／電話番号（新規登録に無い場合のみ）／事業所所在地（自宅と異なる場合のみ）／
// インボイス登録の有無・登録番号。氏名・フリガナ・生年月日・住所・メールは新規登録①から引き継ぐ（聞き直さない）
export const CONSIGNOR_IND_FIELDS = [
  { h:"屋号" },
  { k:"ind_has_trade", l:"屋号の有無", sel:["屋号あり","屋号なし"] },
  { k:"ind_trade", l:"屋号", ph:"例：千歳農園", tradeOnly:true },
  { k:"ind_trade_kana", l:"屋号フリガナ", ph:"例：チトセノウエン", tradeOnly:true },
  { k:"ind_phone", l:"電話番号", ph:"例：090-1234-5678", phoneIfMissing:true },
  { h:"事業所所在地" },
  { k:"ind_biz_same", l:"事業所所在地は自宅と異なりますか？", cl:"事業所所在地", sel:["自宅と同じ","自宅と異なる"] },
  { k:"ind_biz_zip",         l:"事業所の郵便番号", zip:{ main:"ind_biz_addr_main" }, ph:"例：7700000", bizDiff:true },
  { k:"ind_biz_addr_main",   l:"事業所の住所", ph:"例：徳島県〇〇市〇〇町", bizDiff:true },
  { k:"ind_biz_addr_detail", l:"事業所の番地・建物名", ph:"例：123-4", bizDiff:true },
  { h:"インボイス" },
  { k:"ind_has_invoice", l:"インボイス登録の有無", sel:["登録あり","登録なし"], help:"消費税のインボイス制度に登録した事業者かどうかです。登録していなければ「登録なし」で構いません。登録番号を記載すると、受託者（相手）が消費税の仕入税額控除を受けられるため、請求書に印字されます。" },
  { k:"ind_invoice", l:"適格請求書発行事業者登録番号", ph:"例：T1234567890123", invoiceOnly:true, help:"「T」＋13桁の番号です。国税庁「インボイス制度適格請求書発行事業者公表サイト」で確認できます。" },
];

// 法人が委託掲載で新たに聞くのは原則これだけ（2026-07-31たきと指示）：
// 代表者役職・氏名／担当者電話番号／登録者を連絡担当者として使用するか（初期選択=使用する）／
// 別担当者の場合のみ担当者名・電話・メール／インボイス登録の有無・登録番号。
// 法人名・法人番号・本店郵便番号・本店所在地・登録担当者名・登録メールは新規登録①から自動反映（聞き直さない）
export const CONSIGNOR_CORP_FIELDS = [
  { h:"代表者" },
  { k:"corp_rep_title", l:"代表者役職", ph:"例：代表取締役" },
  { k:"corp_rep_name",  l:"代表者氏名", ph:"例：千歳 太郎" },
  // 連絡担当者（2026-07-31たきと指示）：登録者を使用＝自動反映のみ（担当者名=登録者氏名・
  // メール=登録メール・電話番号は入力させない）／別の担当者＝名前とメールだけ入力（電話は初期設定では不要）
  { h:"連絡担当者" },
  { k:"staff_use_registrant", l:"連絡担当者", sel:["登録者を使用","別の担当者"], note:"新規登録した本人が窓口なら「登録者を使用」のままで構いません" },
  { k:"staff_auto", staffAuto:true },
  { k:"staff_name",  l:"担当者名", ph:"例：千歳 花子", staffDiff:true },
  { k:"staff_email", l:"担当者メールアドレス", ph:"例：hanako@example.com", staffDiff:true },
  { h:"インボイス" },
  { k:"corp_has_invoice", l:"インボイス登録の有無", sel:["登録あり","登録なし"], help:"消費税のインボイス制度に登録した事業者かどうかです。登録していなければ「登録なし」で構いません。登録番号を記載すると、受託者（相手）が消費税の仕入税額控除を受けられるため、請求書に印字されます。" },
  { k:"corp_invoice", l:"適格請求書発行事業者登録番号", ph:"例：T1234567890123", corpInvoiceOnly:true, help:"「T」＋13桁の番号です。国税庁「インボイス制度適格請求書発行事業者公表サイト」で確認できます。" },
];

// ③連絡設定ページは廃止（2026-08-02たきと指示「このページは初期設定から削除してよい」）。
// 恒久的な連絡情報＝新規登録から自動引き継ぎ（個人=登録者氏名・電話・登録メール／法人=登録担当者）。
// 案件当日の現場連絡先＝委託ごとに必要なら変更（新規委託ウィザードの日程・安全に設置）。
// 通知メール＝登録メールを自動使用（委託ごとに変える実益はほぼ無い）。
// 同じ情報をもう一度書かせるページは記憶力試験でしかなく、委託の品質を上げない。

// 旧v1（一枚フォーム）の公開項目＝種別未選択の既存データ表示用フォールバック
export const CONSIGNOR_PUBLIC_FIELDS = [
  { k:"consignor_name",       l:"氏名または法人名" },
  { k:"consignor_trade_name", l:"屋号" },
  { k:"consignor_corp_no",    l:"法人番号" },
  { k:"consignor_invoice_no", l:"インボイス登録番号" },
  { k:"consignor_rep_name",   l:"代表者名" },
  { k:"consignor_address",    l:"住所・所在地" },
  { k:"consignor_phone",      l:"電話番号" },
  { k:"consignor_email",      l:"メールアドレス" },
];

// 法人番号の検査用数字（チェックデジット）検証＝公的情報との照合（2026-07-31たきと指示）。
// 国税庁の算式：13桁の先頭1桁＝9−（基礎番号12桁の偶数位の和×2＋奇数位の和）mod 9（位は右から数える）。
// 13桁でない場合は null（判定対象外）を返す
export const corpNoCheckOk = (v) => {
  const t = (v || "").replace(/[^0-9]/g, "");
  if (t.length !== 13) return null;
  let even = 0, odd = 0;
  t.slice(1).split("").forEach((c, i) => { const pos = 12 - i; if (pos % 2 === 0) even += Number(c); else odd += Number(c); });
  return 9 - ((even * 2 + odd) % 9) === Number(t[0]);
};

// 契約書の当事者欄（確認STEP5・印刷仕様書に自動反映）。種別で印字を出し分ける（2026-07-31たきと指示）：
// 個人事業者＝住所・氏名・屋号／法人＝所在地・法人名・代表者（役職＋氏名）。担当者は当事者欄に出さない。
// 身元（氏名・法人名・住所）は account_holders＝唯一の正から読む（2026-08-02たきと確定指示・
// consignor_data へ複製しない）。ah に値が無い旧データのみ consignor_data の旧キーで代替。
// ※これは「現在情報」の表示。成立済み契約の当事者欄は terms_snapshot（凍結値）を参照すること
export const consignorPartyRows = (row, ah) => {
  if (!row && !ah) return [];
  const d = (row && row.consignor_data) || {};
  const a = ah || {};
  const ahAddr = (() => {
    const body = (a.address || "").trim();
    if (!body) return "";
    const z = (a.postal_code || "").trim();
    return (z ? "〒" + z + " " : "") + body;
  })();
  const compose = (zip, main, detail) => {
    const body = [(d[main] || "").trim(), (d[detail] || "").trim()].filter(Boolean).join(" ");
    if (!body) return "";
    const z = (d[zip] || "").trim();
    return (z ? "〒" + z + " " : "") + body;
  };
  const t = (row && row.consignor_type) || a.entity_type || "";
  if (t === "individual") {
    return [["住所", ahAddr || compose("ind_zip","ind_addr_main","ind_addr_detail")], ["氏名", (a.full_name || "").trim() || (d.ind_name || "").trim()], ["屋号", (d.ind_trade || "").trim()]].filter(r => r[1]);
  }
  if (t === "corporate") {
    const rep = [(d.corp_rep_title || "").trim(), (d.corp_rep_name || "").trim()].filter(Boolean).join(" ");
    return [["所在地", ahAddr || compose("corp_zip","corp_addr_main","corp_addr_detail")], ["法人名", (a.company_name || "").trim() || (d.corp_name || "").trim()], ["代表者", rep]].filter(r => r[1]);
  }
  // 種別未選択＝旧v1データのフォールバック
  if (!row) return [];
  return CONSIGNOR_PUBLIC_FIELDS.filter(f => (row[f.k] || "").trim()).map(f => [f.l, row[f.k]]);
};

// 委託機能利用特約（2026-08-02たきと指示・本文はたきと起草の文言をそのまま使用＝改変しない）。
// 委託機能を使う前の最初のゲート。本文を変更したら版数を更新＝旧版の同意者には再同意を求める。
// ★版数の定義は lib/consignAccess.js へ移した（2026-08-03）＝さがすページの公開判定と同じ版を見るため。

export const CONSIGNOR_CONSENT_VERSION = "consignment-data-v2-2026-08"; // v2=2026-08-02 チェック文言改定・種別自動分岐
export const CONSIGNOR_CONSENT_TEXT = "新規登録時に登録した氏名・法人名、住所、メールアドレスその他の登録情報を、委託者情報の作成、委託案件の掲載、取引条件の明示、契約書の作成および取引相手への必要な範囲での開示に利用します。";
// 開示範囲は段階別に明示：掲載と同時に全登録者へ詳細を公開しない。必要な相手へ必要になった段階で開示する
export const CONSIGNOR_DISCLOSURE_STAGES = [
  { t:"掲載時", items:["【個人事業者】氏名または屋号・市町村までの所在地・サイト内連絡手段", "【法人】法人名・本店所在地の市町村・サイト内連絡手段"] },
  { t:"受注申込後・条件調整時", items:["委託者の名称", "担当者名", "メールまたはサイト内連絡先", "案件に必要な圃場情報"] },
  { t:"発注確定後", items:["法的氏名または法人名", "詳細住所・所在地", "代表者情報", "連絡先", "正確な圃場所在地", "契約書記載事項"] },
];

// 種別に応じた下敷き（2026-08-02たきと指示・区分は新規登録の entity_type を唯一の正として自動分岐）。
// ★身元（氏名・法人名・住所・法人番号・メール）は複製しない（2026-08-02たきと確定指示・
//   account_holders が唯一の正＝表示は consignorPartyRows / ahInfo が直接参照する）。
// ここで埋めるのは委託固有の項目（屋号・インボイス・代表者・担当者）だけ。旧v1列から空欄のみ埋める
export const seedConsignorData = (n, t, row) => {
  const put = (k, v) => { if (!(n[k] || "").trim() && (v || "").trim()) n[k] = v; };
  if (t === "individual") {
    put("ind_trade", row.consignor_trade_name);
    put("ind_phone", row.consignor_phone); // 新規登録に電話が無い場合の補完入力（あれば欄ごと非表示）
    put("ind_invoice", row.consignor_invoice_no);
    if (!(n.ind_has_trade || "").trim() && (n.ind_trade || "").trim()) n.ind_has_trade = "屋号あり";
    if (!(n.ind_has_invoice || "").trim() && (n.ind_invoice || "").trim()) n.ind_has_invoice = "登録あり";
  } else {
    put("corp_invoice", row.consignor_invoice_no);
    put("corp_rep_name", row.consignor_rep_name); // 登録者≠代表者のことがあるので登録者名では埋めない
    if (!(n.staff_use_registrant || "").trim()) n.staff_use_registrant = "登録者を使用";
    if (!(n.corp_has_invoice || "").trim() && (n.corp_invoice || "").trim()) n.corp_has_invoice = "登録あり";
  }
  return n;
};

// consignment_profiles に保存しない身元キー（account_holders が唯一の正・2026-08-02たきと確定指示）。
// 旧データに残っていても保存時に取り除く＝二重管理を根絶（表示の旧データ代替は consignorPartyRows 側）
export const CONSIGNOR_IDENTITY_KEYS = ["ind_name","ind_birth","ind_zip","ind_addr_main","ind_addr_detail","ind_email",
  "corp_name","corp_no","corp_zip","corp_addr_main","corp_addr_detail","corp_phone","corp_email"];
export const stripConsignorIdentity = (obj) => {
  const n = { ...obj };
  CONSIGNOR_IDENTITY_KEYS.forEach(k => { delete n[k]; });
  return n;
};

// ページ送り時の先頭スクロール（2026-08-03たきと指示「次へタップでトップに自動スクロール」）。
// iOSは入力欄にフォーカスが残っているとキーボード復帰でスクロール位置が戻されるため、
// blurしてから次フレームでscrollTopを直接書く（window.scrollTo単発では効かない端末がある）
export const consignScrollTop = () => {
  try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch {}
  requestAnimationFrame(() => {
    try {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    } catch {}
  });
};

// ── 委託圃場の登録（2026-08-02たきと指示）：プロフィールのスワイプ2枚目。ここで登録した圃場は

export const CONSIGN_LEND_KINDS = ["道具", "機械", "設備", "消耗品"];
export const CONSIGN_LEND_PH = { 道具:"例：収穫ナイフ", 機械:"例：軽トラ", 設備:"例：予冷庫", 消耗品:"例：コンテナ" };
// 登録簿を [{k,n}] に正規化（旧＝文字列配列との両対応）。案件側の呼び出しでも使う
export const normalizeLendItems = (raw) => (raw || [])
  .map(x => typeof x === "string" ? { k:"", n:x } : { k:(x && x.k) || "", n:(x && x.n) || "" })
  .filter(x => (x.n || "").trim());
