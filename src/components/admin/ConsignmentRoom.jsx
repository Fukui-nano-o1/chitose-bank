// 委託 準備室（#/admin/consignment・管理者専用・分割3-Aで切り出し2026-07-24）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { ymdLocal } from "../../lib/utils";
import { CONSIGN_TERMS_VERSION } from "../../lib/consignAccess";
import { getCache, setCache } from "../../lib/viewCache";
import { snapGet } from "../../lib/snapshot";
import { uploadJobPhoto } from "../../lib/image";
import { zipLookup } from "../../lib/zipLookup";
import { Avatar, VineCorner, Dots } from "../ui";
import { CalendarView } from "../CalendarView";
import { AdminNav } from "./AdminNav";
import {
  CONSIGN_STEPS, consignStepState, CONSIGN_STATUS, consignRecruitState, parseYmd, deadlineLabel,
  CONSIGN_FIXED_CLAUSES, CONSIGN_CROP, CONSIGN_EMPTY, CONSIGN_BASIC_FIELDS, CONSIGN_TASKS,
  CONSIGN_HAZARDS, CONSIGN_WIZ_STEPS, CONSIGN_TEXT_FIELDS, CORP_KINDS, CONSIGNOR_IND_FIELDS,
  CONSIGNOR_CORP_FIELDS, CONSIGNOR_PUBLIC_FIELDS, corpNoCheckOk, consignorPartyRows,
  CONSIGNOR_CONSENT_VERSION, CONSIGNOR_CONSENT_TEXT, CONSIGNOR_DISCLOSURE_STAGES, seedConsignorData,
  CONSIGNOR_IDENTITY_KEYS, stripConsignorIdentity, consignScrollTop, CONSIGN_LEND_KINDS,
  CONSIGN_LEND_PH, normalizeLendItems,
} from "../../features/consignment/model";
import { CONSIGN_TERMS_INTRO, CONSIGN_TERMS_SECTIONS, CONSIGN_TERMS_CHECK, CONSIGN_TERMS_HELP,
  ConsignTermsBody } from "../../features/consignment/terms";
import { ConsignStepper } from "../../features/consignment/components/ConsignStepper";
import { ConsignFieldsPane } from "../../features/consignment/components/ConsignFieldsPane";
import { ConsignLendPane } from "../../features/consignment/components/ConsignLendPane";
import { CONSIGN_SPRIGS, CONSIGN_CLUSTER_BASES, CONSIGN_GRASS_SCALE, makeConsignGrass,
  CONSIGN_VINES, CONSIGN_CORNER_VINE, makeConsignVines, computeSky } from "../../features/consignment/entranceArt";

// ── 委託 準備室（#/admin/consignment・管理者専用・2026-07-19）：B2B委託レーンの手動1件（この冬・運営者自身がモデル）用の内部道具。
//    市場機能（掲載板・受託者画面・決済）は作らない——手動1件の後に判断（たきと指示）。
//    タブ2つ：仕様書（フォーム→保存→印刷ビュー）／台帳（consignment_deals一覧・行タップで編集・状態更新・メモ）
// 委託の型（定数・純関数） → features/consignment/model.js へ移設（2026-08-17）
// ConsignStepper → features/consignment/components/ConsignStepper.jsx へ移設（2026-08-17）

// 委託の型（定数・純関数） → features/consignment/model.js へ移設（2026-08-17）
// 入場演出（草・蔓・空） → features/consignment/entranceArt.js へ移設（2026-08-17）

// ── 委託者情報 v2（2026-07-31たきと指示・種別分岐）──
// 最初に「個人事業者／法人」を選び、入力ページを完全に分岐する。個人名と法人名を同じ列に
// 混ぜない（consignor_type ＋ consignor_data jsonb・ind_*/corp_*/staff_*/cmn_* のキー空間で分離）。
// ページ順：委託者の種類 → 個人事業者情報 or 法人情報 → 連絡担当者（法人のみ・個人は本人が兼ねるので省略）
// → 標準取引条件（共通）→ 登録内容確認。契約書の当事者欄は種別で印字を出し分ける
// 委託の型（定数・純関数） → features/consignment/model.js へ移設（2026-08-17）
//   2箇所で持つと、本文を直したとき片方だけ上げる事故が起きる
// 委託機能利用特約の本文 → features/consignment/terms.jsx へ移設（2026-08-17）

// 登録情報の委託機能での利用同意（2026-08-02たきと指示）：曖昧な「引き継いでよいですか」ではなく、
// 何の情報を・何の目的で・誰に・いつ見せるかまで示して同意を取る。同意文を変えたら版数を更新（再同意）
// 委託の型（定数・純関数） → features/consignment/model.js へ移設（2026-08-17）
// ConsignFieldsPane → features/consignment/components/ConsignFieldsPane.jsx へ移設（2026-08-17）
// ConsignLendPane → features/consignment/components/ConsignLendPane.jsx へ移設（2026-08-17）

// 委託者情報の設定フロー（ブラック・アイコンなし・1ページ1つの問い）
function ConsignorInfoEdit() {
  const [ctype, setCtype] = useState("");   // "individual" | "corporate" | ""
  const [d, setD] = useState(null);         // consignor_data（null=読み込み中）
  const [cstep, setCstep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 保存済みなら名刺タップの行き先は「委託プロフィールページ」＝保存内容の表示（2026-08-02たきと指示）。
  // 未保存・下書き編集中はこれまで通り設定フロー（ウィザード）を出す
  const [viewing, setViewing] = useState(false);
  const [zipBusy, setZipBusy] = useState("");
  const [zipError, setZipError] = useState("");
  const [helpKey, setHelpKey] = useState(null); // ？を開いている項目（helpの説明コメント表示）
  const [confirmAgree, setConfirmAgree] = useState(false); // 確認ページの同意チェック（2026-07-31たきと指示・未チェックでは保存不可）
  // 登録情報の利用同意（初回ゲート）：チェックは初期未選択・版数一致の同意が無ければフローに入れない
  const [consentOk, setConsentOk] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  // 登録情報の修正は委託ページ内で完結（2026-08-02たきと指示）。フォームは保存済みの値を復元して開く
  const [editReg, setEditReg] = useState(false);
  const [regForm, setRegForm] = useState(null);
  const [regSaving, setRegSaving] = useState(false);
  const [regZipBusy, setRegZipBusy] = useState(false);
  const [regZipError, setRegZipError] = useState("");
  const rowRef = useRef(null); // 旧v1列（種別選択時の下敷きに使う）
  const [ahInfo, setAhInfo] = useState(null); // 新規登録①（account_holders）＝引き継ぎの下敷き（2026-07-31たきと指示）
  // ステップ1＝引き継ぎチェック（2026-08-02たきと指示）。種類選択ページは廃止＝entity_typeから自動分岐。
  // フォールバック＝entity_type 未登録の旧データ・破損時のみ種類ページを出す（通常ユーザーには見せない）
  const steps = ["consent", ...(ctype ? [] : ["type"]), ctype === "corporate" ? "corp" : "ind", "confirm"];
  const stepKey = steps[Math.min(cstep, steps.length - 1)];
  const STEP_META = {
    consent: { t:"引き継ぎ確認",   q:"登録情報の引き継ぎを確認してください", de:"新規登録の情報を委託者情報に引き継ぎます。再入力は不要です。" },
    type:    { t:"委託者の種類",   q:"個人事業者ですか、法人ですか？", de:"種類によって入力ページが分かれます。" },
    ind:     { t:"個人事業者情報", q:"委託で新しく必要な情報だけ入力してください", de:"氏名・住所・メールは新規登録から引き継ぎます。契約書には法的な氏名が印字されます。" },
    corp:    { t:"法人情報",       q:"委託で新しく必要な情報だけ入力してください", de:"法人名・法人番号・本店所在地・メールは新規登録から引き継ぎます。契約の当事者は法人です。" },
    confirm: { t:"登録内容確認",   q:"内容を確認して保存します", de:"案件の確認ページと印刷仕様書に自動で反映されます。" },
  };
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setD({}); return; }
        const { data } = await supabase.from("consignment_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        rowRef.current = data || null;
        setConsentOk(!!(data && data.consignment_data_consent && data.consignment_data_consent_version === CONSIGNOR_CONSENT_VERSION));
        // 新規登録①の本人確認情報を引き継ぎの下敷きに（2026-07-31たきと指示）。
        // ★黙って書面へ流し込まない：フォームの初期値に入れるだけで、確認ページを経て
        //   本人が「保存する」を押した時に確定する＝本人の意思で契約書面に載せる形（2026-07-27作法）
        let ahRow = null;
        try {
          const { data: ah } = await supabase.from("account_holders")
            .select("full_name,postal_code,address,birth_date,entity_type,contact_email,contact_phone,company_name,company_number")
            .eq("auth_id", session.user.id).maybeSingle();
          ahRow = ah || null;
          setAhInfo(ahRow);
        } catch {}
        const nd = { ...((data && data.consignor_data) || {}) };
        // 旧v2キー（4分割 pref/city/addr）からの移行：住所(main)へ併合。旧addrには町域が
        // 入っていた（番地ではない）ため main 側に寄せる。番地・建物名は本人が入力し直す
        const mig = (mainK, prefK, cityK, addrK) => {
          if (!(nd[mainK] || "").trim()) {
            const m = [nd[prefK], nd[cityK], nd[addrK]].map(x => (x || "").trim()).filter(Boolean).join("");
            if (m) nd[mainK] = m;
          }
        };
        mig("ind_addr_main", "ind_pref", "ind_city", "ind_addr");
        mig("ind_biz_addr_main", "ind_biz_pref", "ind_biz_city", "ind_biz_addr");
        mig("corp_addr_main", "corp_pref", "corp_city", "corp_addr");
        // 有無フラグの導出（値があるのに未選択のとき）と、旧「自宅住所と同じ」表記の移行
        if (!(nd.ind_has_trade || "").trim() && (nd.ind_trade || "").trim()) nd.ind_has_trade = "屋号あり";
        if (!(nd.ind_has_invoice || "").trim() && (nd.ind_invoice || "").trim()) nd.ind_has_invoice = "登録あり";
        if (nd.ind_biz_same === "自宅住所と同じ") nd.ind_biz_same = "自宅と同じ";
        else if (!(nd.ind_biz_same || "").trim() && (nd.ind_biz_addr_main || "").trim()) nd.ind_biz_same = "自宅と異なる";
        if (!(nd.corp_has_invoice || "").trim() && (nd.corp_invoice || "").trim()) nd.corp_has_invoice = "登録あり";
        if (!(nd.staff_use_registrant || "").trim()) nd.staff_use_registrant = (nd.staff_name || "").trim() ? "別の担当者" : "登録者を使用";
        // 旧v1の分割振込・緊急連絡先を下敷きに（空欄のみ・保存は本人が押した時だけ）
        if (data) {
          if (!nd.cmn_bank && data.consignor_bank) { nd.cmn_bank = data.consignor_bank; nd.cmn_bank_branch = data.consignor_bank_branch || ""; nd.cmn_account_type = data.consignor_account_type || ""; nd.cmn_account_no = data.consignor_account_no || ""; nd.cmn_account_name = data.consignor_account_name || ""; }
          if (!nd.cmn_emergency && data.consignor_emergency) nd.cmn_emergency = data.consignor_emergency;
        }
        // リロード対策（2026-07-31たきと報告「リロードしたとき入力内容がクリアされる」）：
        // 入力中の下書き（localStorage・自動保存）があればDB値の上に重ねて復元。
        // ステップと種別も戻す＝中断した場所から再開（求人フローと同じ作法）
        let draft = null;
        try { draft = JSON.parse(localStorage.getItem("cb_consignorDraft_v1") || "null"); } catch {}
        // 区分は新規登録の entity_type が唯一の正（2026-08-02たきと指示）。委託フローで再選択させない
        // ＝新規登録と委託で別人格になるのを防ぐ。entity_type が無い旧データだけ種類ページへフォールバック
        const ent = (ahRow && (ahRow.entity_type === "corporate" || ahRow.entity_type === "individual")) ? ahRow.entity_type : "";
        const t = ent || (draft && draft.t) || (data && data.consignor_type) || "";
        let merged = (draft && draft.d) ? { ...nd, ...draft.d } : nd;
        if (t) merged = seedConsignorData(merged, t, data || {}); // 自動分岐＝下敷きも自動で適用（身元は複製しない）
        setCtype(t);
        const okC = !!(data && data.consignment_data_consent && data.consignment_data_consent_version === CONSIGNOR_CONSENT_VERSION);
        if (okC && draft && Number.isInteger(draft.s)) setCstep(draft.s); // 未同意ならステップ1（引き継ぎ確認）から
        // 保存済み（種別確定＋同意済み）で下書きが無ければプロフィール表示モード（2026-08-02たきと指示）
        setViewing(!!(data && data.consignor_type) && okC && !draft);
        setD(merged);
      } catch { setD({}); }
    })();
  }, []);
  // 自動下書き保存：入力・ステップ移動のたびにlocalStorageへ（保存成功で消す）。
  // プロフィール表示モード中は書かない（見ただけで下書きが生まれ、次回ウィザードに戻ってしまうため）
  useEffect(() => {
    if (!d || viewing) return;
    try { localStorage.setItem("cb_consignorDraft_v1", JSON.stringify({ t: ctype, s: cstep, d })); } catch {}
  }, [d, ctype, cstep, viewing]);
  useEffect(() => { if (stepKey !== "confirm") setConfirmAgree(false); }, [stepKey]); // 確認のたびに改めてチェックさせる
  // 同意ログの保存（consent/at/version/user_id・行動記録の憲法＝時刻列の追記）
  const agreeConsent = async () => {
    if (consentSaving || !consentChecked) return;
    setConsentSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setConsentSaving(false); return; }
      const { error } = await supabase.from("consignment_profiles").upsert({
        auth_id: session.user.id,
        consignment_data_consent: true,
        consignment_data_consent_at: new Date().toISOString(),
        consignment_data_consent_version: CONSIGNOR_CONSENT_VERSION,
        consignment_data_consent_user_id: session.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) alert("同意の記録に失敗しました：" + error.message);
      else { setConsentOk(true); setCstep(v => v + 1); consignScrollTop(); }
    } catch { alert("同意の記録に失敗しました。"); }
    setConsentSaving(false);
  };
  // 登録情報の修正フォームを開く：account_holders の保存済み値を復元（住所は既知形式で2分割）
  const openRegEdit = () => {
    const ah = ahInfo || {};
    const addr = (ah.address || "").trim();
    const sp = addr.indexOf(" ");
    setRegForm({
      full_name: ah.full_name || "", company_name: ah.company_name || "",
      birth_date: ah.birth_date || "", postal_code: (ah.postal_code || "").replace(/[^0-9]/g, ""),
      addr_main: sp > 0 ? addr.slice(0, sp) : addr, addr_detail: sp > 0 ? addr.slice(sp + 1) : "",
      contact_phone: ah.contact_phone || "", contact_email: ah.contact_email || "",
    });
    setRegZipError(""); setEditReg(true); consignScrollTop();
  };
  const regZipSearch = async () => {
    const z = (regForm?.postal_code || "").replace(/[^0-9]/g, "");
    if (z.length !== 7) { setRegZipError("郵便番号は7桁で入力してください"); return; }
    setRegZipBusy(true); setRegZipError("");
    // 2系統レース＋タイムアウト＋キャッシュ（lib/zipLookup・2026-08-02「検索に数十秒」対策）
    const r = await zipLookup(z);
    if (!r.ok) setRegZipError(r.reason === "notfound" ? "住所が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
    else setRegForm(f => ({ ...f, postal_code: z, addr_main: r.full }));
    setRegZipBusy(false);
  };
  // 保存：account_holders（唯一の正）を変更元タグ付きRPCで更新（2026-08-02たきと確定指示・
  // 変更履歴 account_holder_changes に 前後の値・日時・変更者・変更元=consignment_reg_edit が残る）。
  // entity_type / company_number は通常編集禁止（DBトリガーでも拒否）＝patch に含めない。
  // 委託側 d への身元コピーは廃止（身元は consignor_data に持たない・表示は ahInfo を直接参照）
  const saveRegEdit = async () => {
    if (regSaving || !regForm) return;
    setRegSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setRegSaving(false); return; }
      const composedAddr = [regForm.addr_main.trim(), regForm.addr_detail.trim()].filter(Boolean).join(" ");
      const patch = {
        full_name: regForm.full_name.trim(),
        postal_code: regForm.postal_code.trim(),
        address: composedAddr,
        birth_date: regForm.birth_date.trim() || null,
        contact_phone: regForm.contact_phone.trim() || null,
        contact_email: regForm.contact_email.trim() || null,
        ...(ctype === "corporate" ? { company_name: regForm.company_name.trim() } : {}),
      };
      const { data: r, error } = await supabase.rpc("update_account_holder_self",
        { p_patch: patch, p_source: "consignment_reg_edit" });
      if (error || !(r && r.ok)) { alert("保存に失敗しました：" + (error?.message || (r && r.reason) || "不明なエラー")); setRegSaving(false); return; }
      setAhInfo(a => ({ ...(a || {}), ...patch }));
      setEditReg(false); consignScrollTop();
    } catch { alert("保存に失敗しました。"); }
    setRegSaving(false);
  };
  const setV = (k, v) => setD(p => ({ ...p, [k]: v }));
  // 種別を選ぶ：旧v1列を下敷きに（空欄のみ）→次ページへ
  // 種別ページは廃止＝通常は読み込み時に自動分岐（下記seedConsignorData）。
  // pickType は entity_type 未登録の旧データ専用のフォールバック（例外処理）
  const pickType = (t) => {
    setD(p => seedConsignorData({ ...p }, t, rowRef.current || {}));
    setCtype(t); setCstep(0); consignScrollTop();
  };
  const searchZipInto = async (f) => {
    const z = (d[f.k] || "").replace(/[^0-9]/g, "");
    if (z.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipBusy(f.k); setZipError("");
    // 2系統レース＋タイムアウト＋キャッシュ（lib/zipLookup・2026-08-02「検索に数十秒」対策）
    const r = await zipLookup(z);
    if (!r.ok) setZipError(r.reason === "notfound" ? "住所が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
    else setD(p => ({ ...p, [f.k]: z, [f.zip.main]: r.full }));
    setZipBusy("");
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // 新規登録に電話が無く、委託フローで入力された場合は account_holders（唯一の正）へ書き戻す
      // （変更元タグ付きRPC経由＝変更履歴に consignment_flow として残る）
      const flowPhone = (d.ind_phone || "").trim();
      if (ctype === "individual" && flowPhone && !(ahInfo?.contact_phone || "").trim()) {
        try {
          const { data: r } = await supabase.rpc("update_account_holder_self",
            { p_patch: { contact_phone: flowPhone }, p_source: "consignment_flow" });
          if (r && r.ok) setAhInfo(a => ({ ...(a || {}), contact_phone: flowPhone }));
        } catch {}
      }
      // 身元キーは保存しない（account_holders が唯一の正・2026-08-02たきと確定指示）
      const { error } = await supabase.from("consignment_profiles").upsert({
        auth_id: session.user.id, consignor_type: ctype, consignor_data: stripConsignorIdentity(d), updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) alert("保存に失敗しました：" + error.message);
      else {
        try { localStorage.removeItem("cb_consignorDraft_v1"); } catch {} // 保存成功＝DBが真実の座ので下書きは消す
        // 保存したら委託のトップ（一覧）へ戻る（2026-07-31たきと指示）。✓を一瞬見せてから
        setSaved(true);
        setTimeout(() => { window.location.hash = "/admin/consignment"; }, 600);
      }
    } catch { alert("保存に失敗しました。"); }
    setSaving(false);
  };
  // 条件表示の一元判定（入力欄と登録内容確認の両方が使う）：
  // tradeOnly=屋号ありのみ／phoneIfMissing=新規登録に電話が無い場合のみ／
  // bizDiff=事業所が自宅と異なる場合のみ／invoiceOnly=インボイス登録ありのみ／bankOnly=銀行振込のみ
  const cfHidden = (f) => (
    (f.tradeOnly && (d.ind_has_trade || "") !== "屋号あり") ||
    (f.phoneIfMissing && !!(ahInfo?.contact_phone || "").trim()) ||
    (f.bizDiff && (d.ind_biz_same || "") !== "自宅と異なる") ||
    (f.invoiceOnly && (d.ind_has_invoice || "") !== "登録あり") ||
    (f.staffDiff && (d.staff_use_registrant || "登録者を使用") !== "別の担当者") ||
    (f.corpInvoiceOnly && (d.corp_has_invoice || "") !== "登録あり")
  );
  // 公的情報との照合（2026-07-31たきと指示）：インボイス番号の形式・法人番号との一致・チェックデジット
  const cfWarn = (k) => {
    const v = (d[k] || "").trim();
    if (!v) return "";
    if (k === "ind_invoice" || k === "corp_invoice") {
      if (!/^T\d{13}$/.test(v)) return "「T」＋13桁の形式で入力してください（例：T1234567890123）";
      if (k === "corp_invoice") {
        const digits = v.slice(1);
        // 法人番号は account_holders（唯一の正）を照合先に（旧データのみ consignor_data の残置値）
        const cn = ((ahInfo?.company_number || d.corp_no || "") + "").trim();
        if (/^\d{13}$/.test(cn) && digits !== cn) return "法人の登録番号は「T＋法人番号」です。登録されている法人番号と一致していません";
        if (corpNoCheckOk(digits) === false) return "番号の検査用数字（チェックデジット）が合いません。公表サイトでご確認ください";
      }
    }
    return "";
  };
  // 入力欄1つの描画（sel=ピル・zip=検索ボタン付き・num=数字のみ・ta=複数行・help=？で説明開閉）
  const renderCF = (f) => {
    if (f.h) return <p key={"h" + f.h} className="f-sans" style={{ fontSize:14.3, fontWeight:800, color:"#111111", margin:"18px 0 8px" }}>{f.h}</p>;
    if (!f.h && !f.info && cfHidden(f)) return null;
    if (f.info) return (
      <div key={f.k} className="f-sans" style={{ fontSize:13.2, color:"#111111", background:"#F7F7F7", border:"1px solid #111111", borderRadius:10, padding:"12px 14px", lineHeight:1.7, margin:"0 0 10px" }}>{f.info}</div>
    );
    if (f.staffAuto) {
      if ((d.staff_use_registrant || "登録者を使用") === "別の担当者") return null;
      return (
        <div key={f.k} className="f-sans" style={{ fontSize:13.2, color:"#111111", background:"#F7F7F7", border:"1px solid #111111", borderRadius:10, padding:"12px 14px", lineHeight:1.9, margin:"0 0 10px" }}>
          <span style={{ display:"block", fontWeight:800, marginBottom:2 }}>登録者を連絡担当者として使用（自動反映・入力不要）</span>
          <span style={{ display:"block" }}>担当者名：{(ahInfo?.full_name || "").trim() || "未登録"}</span>
          <span style={{ display:"block" }}>担当者メール：{(ahInfo?.contact_email || d.corp_email || "").trim() || "未登録"}</span>
        </div>
      );
    }
    return (
      <div key={f.k} style={{ marginBottom:10 }}>
        {f.help ? (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <button type="button" onClick={()=>setHelpKey(v => v === f.k ? null : f.k)} aria-label="説明を表示" className="f-sans" style={{ flexShrink:0, width:18, height:18, borderRadius:"50%", border:"1.5px solid #111111", background: helpKey === f.k ? "#111111" : "#fff", color: helpKey === f.k ? "#fff" : "#111111", fontSize:12.1, fontWeight:800, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}>？</button>
              <label className="lbl f-sans" style={{ marginBottom:0 }}>{f.l}</label>
            </div>
            {helpKey === f.k && (
              <p className="f-sans" style={{ fontSize:12.1, color:"#111111", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"6px 0 8px", lineHeight:1.7 }}>{f.help}</p>
            )}
          </div>
        ) : (
        <label className="lbl f-sans">{f.l}</label>
        )}
        {f.sel ? (
          <div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {f.sel.map(opt => {
                const on = (d[f.k] || "") === opt;
                return (
                  <button key={opt} type="button" onClick={()=>setV(f.k, on ? "" : opt)} className="f-sans" style={{ padding:"9px 18px", fontSize:15.4, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                );
              })}
            </div>
            {f.note && <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"6px 0 0" }}>{f.note}</p>}
          </div>
        ) : f.zip ? (
          <div>
            <div style={{ display:"flex", gap:8 }}>
              <input className="field f-sans" inputMode="numeric" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value.replace(/[^0-9]/g, ""))} placeholder={f.ph || ""} style={{ fontSize:15.4, marginBottom:0, flex:1 }} />
              <button type="button" onClick={()=>searchZipInto(f)} disabled={zipBusy === f.k} className="f-sans" style={{ flexShrink:0, padding:"0 14px", fontSize:14.3, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>{zipBusy === f.k ? <>検索中<Dots /></> : "住所を検索"}</button>
            </div>
            {zipError && <p className="f-sans" style={{ fontSize:12.1, color:"#111111", fontWeight:700, margin:"6px 0 0" }}>{zipError}</p>}
          </div>
        ) : f.num ? (
          <input className="field f-sans" inputMode="numeric" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value.replace(/[^0-9]/g, ""))} placeholder={f.ph || ""} style={{ fontSize:15.4, marginBottom:0 }} />
        ) : f.ta ? (
          <textarea className="field f-sans" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value)} placeholder={f.ph || ""} rows={3} style={{ fontSize:14.3, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
        ) : (
          <input className="field f-sans" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value)} placeholder={f.ph || ""} style={{ fontSize:15.4, marginBottom:0 }} />
        )}
        {(() => { const w = cfWarn(f.k); return w ? <p className="f-sans" style={{ fontSize:12.1, fontWeight:700, color:"#111111", margin:"6px 0 0" }}>{w}</p> : null; })()}
      </div>
    );
  };
  // 読み込み中は画面中央に配置（2026-07-31たきと指示）
  if (!d) return (
    <div style={{ minHeight:"55vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <p className="f-sans" style={{ fontSize:14.3, color:"#999999", margin:0 }}>読み込み中<Dots /></p>
    </div>
  );
  // ── 登録情報の修正（委託ページ内で完結・2026-08-02たきと指示）。保存済みの値を復元して編集 ──
  if (editReg && regForm) {
    const isCorp = ctype === "corporate";
    const regField = (k, l, opts = {}) => (
      <div key={k} style={{ marginBottom:10 }}>
        <label className="lbl f-sans">{l}</label>
        <input className="field f-sans" inputMode={opts.num ? "numeric" : undefined} value={regForm[k]} onChange={e=>setRegForm(f => ({ ...f, [k]: opts.num ? e.target.value.replace(/[^0-9]/g, "") : e.target.value }))} placeholder={opts.ph || ""} style={{ fontSize:15.4, marginBottom:0 }} />
      </div>
    );
    return (
      <div>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>登録情報の修正</h2>
        <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 16px" }}>新規登録の情報（唯一の正）を修正します。保存すると委託者情報にも反映されます。区分（個人事業者/法人）はここでは変更できません。</p>
        {isCorp ? (<>
          {regField("company_name", "法人名", { ph:"例：株式会社千歳農園" })}
          {/* 法人番号は通常編集禁止（2026-08-02たきと確定指示・DBトリガーでも拒否）＝読み取り専用表示 */}
          <div style={{ marginBottom:10 }}>
            <label className="lbl f-sans">法人番号</label>
            <div className="f-sans" style={{ fontSize:15.4, color:"#111111", background:"#F7F7F7", border:"1px solid #E5E5E5", borderRadius:10, padding:"12px 14px" }}>{(ahInfo?.company_number || "").trim() || "未登録"}</div>
            <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"4px 0 0" }}>法人番号の変更は運営にお問い合わせください。</p>
          </div>
        </>) : (<>
          {regField("full_name", "氏名", { ph:"例：千歳 太郎" })}
          {regField("birth_date", "生年月日", { ph:"例：1990-01-01" })}
        </>)}
        <div style={{ marginBottom:10 }}>
          <label className="lbl f-sans">郵便番号</label>
          <div style={{ display:"flex", gap:8 }}>
            <input className="field f-sans" inputMode="numeric" value={regForm.postal_code} onChange={e=>setRegForm(f => ({ ...f, postal_code: e.target.value.replace(/[^0-9]/g, "") }))} placeholder="例：7700000" style={{ fontSize:15.4, marginBottom:0, flex:1 }} />
            <button type="button" onClick={regZipSearch} disabled={regZipBusy} className="f-sans" style={{ flexShrink:0, padding:"0 14px", fontSize:14.3, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>{regZipBusy ? <>検索中<Dots /></> : "住所を検索"}</button>
          </div>
          {regZipError && <p className="f-sans" style={{ fontSize:12.1, fontWeight:700, color:"#111111", margin:"6px 0 0" }}>{regZipError}</p>}
        </div>
        {regField("addr_main", isCorp ? "本店所在地" : "住所", { ph:"例：徳島県〇〇市〇〇町" })}
        {regField("addr_detail", "番地・建物名", { ph:"例：123-4 〇〇ハイツ101" })}
        {isCorp && regField("full_name", "登録者氏名", { ph:"例：千歳 太郎" })}
        {regField("contact_phone", "電話番号", { ph:"例：090-1234-5678" })}
        {regField("contact_email", "メールアドレス", { ph:"例：taro@example.com" })}
        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button onClick={()=>{ setEditReg(false); consignScrollTop(); }} className="f-sans" style={{ flex:1, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#fff", color:"#111111", border:"1px solid #111111", cursor:"pointer" }}>キャンセル</button>
          <button onClick={saveRegEdit} disabled={regSaving} className="f-sans" style={{ flex:1.4, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: regSaving ? 0.6 : 1 }}>{regSaving ? <>保存中<Dots /></> : "保存する"}</button>
        </div>
      </div>
    );
  }
  const confirmGroups = ctype === "corporate"
    ? [["代表者・連絡担当者・インボイス", CONSIGNOR_CORP_FIELDS]]
    : [["個人事業者情報", CONSIGNOR_IND_FIELDS]];
  // 統合ボックス（2026-08-02たきと指示「3つのボックスを1つに」）：印字イメージ・入力内容・
  // 連絡先/通知先を罫線区切りのセクションで1枚に収める。確認ステップとプロフィール表示ページで共用
  const renderProfileBox = () => (
    <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
      <p className="f-sans" style={{ fontSize:12.1, fontWeight:800, color:"#111111", margin:"0 0 6px" }}>契約書の委託者欄（印字イメージ）</p>
      {consignorPartyRows({ consignor_type: ctype, consignor_data: d }, ahInfo).map(([l, v]) => (
        <p key={l} className="f-sans" style={{ fontSize:14.3, color:"#111111", margin:"0 0 2px" }}>{l}：{v}</p>
      ))}
      {confirmGroups.map(([gl, fields]) => {
        // 登録内容は全て出す（2026-07-31たきと指示）：未入力もグレーで明示。
        // 条件で無効な項目（事業所=自宅と同じ・現金払いの振込欄）と案内文は出さない
        // 確認ページは「項目名：値」形式で統一（2026-08-02たきと指示）＝質問文の項目は cl（確認用の短いラベル）で出す
        const rows = fields.filter(f => !f.h && !f.info && !f.staffAuto && !cfHidden(f)).map(f => [f.cl || f.l, d[f.k]]);
        if (!rows.length) return null;
        return (
          <div key={gl} style={{ borderTop:"1px solid #EBEBEB", marginTop:12, paddingTop:12 }}>
            <p className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", margin:"0 0 8px" }}>{gl}</p>
            <div style={{ display:"grid", gap:6 }}>
              {rows.map(([l, v]) => (
                <div key={l} style={{ display:"flex", gap:10 }}>
                  <span className="f-sans" style={{ fontSize:12.1, color:"#999999", minWidth:110, flexShrink:0 }}>{l}</span>
                  <span className="f-sans" style={{ fontSize:13.2, color: (v || "").trim() ? "#111111" : "#C0C0C0", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{(v || "").trim() || "未入力"}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {/* 連絡先・通知先＝登録情報から自動（このフローでは聞かない・2026-08-02たきと指示）。
          当日の現場連絡先の上書きは委託案件ごと（ウィザードの日程・安全） */}
      {(() => {
        const diffStaff = ctype === "corporate" && (d.staff_use_registrant || "登録者を使用") === "別の担当者";
        const cName = diffStaff ? (d.staff_name || "").trim() : (ahInfo?.full_name || "").trim();
        const cPhone = ctype === "corporate" ? ((ahInfo?.contact_phone || "").trim()) : (((ahInfo?.contact_phone || "").trim()) || (d.ind_phone || "").trim());
        const cMail = diffStaff ? (d.staff_email || "").trim() : "";
        return (
          <div style={{ borderTop:"1px solid #EBEBEB", marginTop:12, paddingTop:12 }}>
            <p className="f-sans" style={{ fontSize:12.1, fontWeight:800, color:"#111111", margin:"0 0 2px" }}>連絡先</p>
            <p className="f-sans" style={{ fontSize:13.2, color:"#111111", margin:0 }}>{cName || "未登録"}</p>
            {(cPhone || cMail) && <p className="f-sans" style={{ fontSize:13.2, color:"#111111", margin:0 }}>{cPhone || cMail}</p>}
            <p className="f-sans" style={{ fontSize:12.1, fontWeight:800, color:"#111111", margin:"8px 0 2px" }}>通知先</p>
            <p className="f-sans" style={{ fontSize:13.2, color:"#111111", margin:0 }}>登録メールアドレス</p>
            <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"6px 0 0" }}>変更は登録情報から行います。案件当日だけ別の連絡先を使う場合は、委託の作成時に指定できます。</p>
          </div>
        );
      })()}
    </div>
  );
  // ── 委託プロフィールページ（保存済みの表示・2026-08-02たきと指示「保存した後の名刺タップは
  //    委託プロフィールページに遷移」）。編集はここから明示的にウィザードへ入る ──
  if (viewing) return (
    <div>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>委託者情報</h2>
      <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 16px" }}>契約書・印刷仕様書に自動で反映される登録内容です。</p>
      {renderProfileBox()}
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={openRegEdit} className="f-sans" style={{ flex:1, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#fff", color:"#111111", border:"1px solid #111111", cursor:"pointer" }}>登録情報を修正</button>
        <button onClick={()=>{ setViewing(false); setCstep(steps.indexOf(ctype === "corporate" ? "corp" : "ind")); consignScrollTop(); }} className="f-sans" style={{ flex:1.4, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>内容を編集</button>
      </div>
    </div>
  );
  const meta = STEP_META[stepKey];
  return (
    <div>
      {/* 進捗（黒バー）＋ステップ見出し */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        {cstep > 0 && <button onClick={()=>{ setCstep(v => v - 1); consignScrollTop(); }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", flexShrink:0 }}>← 前へ</button>}
        <span className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111" }}>{cstep + 1}/{steps.length}　{meta.t}</span>
      </div>
      <div style={{ display:"flex", gap:4, marginBottom:18 }}>
        {steps.map((st, i) => <div key={st} style={{ flex:1, height:4, borderRadius:2, background: i <= cstep ? "#111111" : "#E5E5E5" }} />)}
      </div>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{meta.q}</h2>
      <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 18px" }}>{meta.de}</p>

      {/* 1. 委託者の種類（消費者としての個人と混ざらないよう「個人事業者」と表記） */}
      {/* ステップ1＝引き継ぎチェック（2026-08-02たきと指示）：引き継ぐ情報と利用・開示範囲を確認。
          同意ログは初回のみ記録（版数一致の同意があれば「次へ」だけ） */}
      {stepKey === "consent" && (() => {
        const isCorp = ahInfo?.entity_type === "corporate";
        const inheritRows = [
          ["区分", ahInfo?.entity_type ? (isCorp ? "法人" : "個人事業者") : ""],
          isCorp ? ["法人名", ahInfo?.company_name] : ["氏名", ahInfo?.full_name],
          ...(isCorp ? [["登録者氏名", ahInfo?.full_name], ["法人番号", ahInfo?.company_number]] : []),
          ["住所", ahInfo?.address],
          ["メールアドレス", ahInfo?.contact_email],
          ...((ahInfo?.contact_phone || "").trim() ? [["電話番号", ahInfo?.contact_phone]] : []),
        ].filter(r => (r[1] || "").trim());
        return (<>
          {ahInfo?.entity_type && (
            <p className="f-sans" style={{ fontSize:16.5, fontWeight:800, color:"#111111", margin:"0 0 6px" }}>{isCorp ? "法人として委託を掲載します" : "個人事業者として委託を掲載します"}</p>
          )}
          <p className="f-sans" style={{ fontSize:14.3, color:"#111111", lineHeight:1.8, margin:"0 0 14px" }}>{CONSIGNOR_CONSENT_TEXT}</p>
          <div className="f-sans" style={{ fontSize:13.2, color:"#111111", background:"#F7F7F7", border:"1px solid #111111", borderRadius:10, padding:"12px 14px", lineHeight:1.9, margin:"0 0 12px" }}>
            <span style={{ display:"block", fontWeight:800, marginBottom:2 }}>引き継ぐ登録情報</span>
            {inheritRows.map(([l, v]) => <span key={l} style={{ display:"block" }}>{l}：{v}</span>)}
            {inheritRows.length === 0 && <span style={{ display:"block", color:"#999999" }}>新規登録の情報が見つかりませんでした</span>}
          </div>
          <button type="button" onClick={()=>setScopeOpen(v => !v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border:"1px solid #111111", background:"#fff", color:"#111111", marginBottom: scopeOpen ? 8 : 12 }}>
            {scopeOpen ? "▾" : "▸"} 表示・開示される情報を確認
          </button>
          {scopeOpen && (
            <div style={{ border:"1px solid #111111", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
              {CONSIGNOR_DISCLOSURE_STAGES.map(st => (
                <div key={st.t} style={{ marginBottom:10 }}>
                  <p className="f-sans" style={{ fontSize:13.2, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{st.t}</p>
                  {st.items.map(it => <p key={it} className="f-sans" style={{ fontSize:13.2, color:"#111111", lineHeight:1.7, margin:0 }}>・{it}</p>)}
                </div>
              ))}
              <p className="f-sans" style={{ fontSize:12.1, color:"#999999", lineHeight:1.7, margin:0 }}>詳細な住所や電話番号を掲載と同時に公開することはありません。必要な相手へ、必要になった段階で開示します。</p>
            </div>
          )}
          {consentOk ? (
            <>
              <p className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", margin:"0 0 12px" }}>✓ 同意済みです（記録済み・{CONSIGNOR_CONSENT_VERSION}）</p>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={openRegEdit} className="f-sans" style={{ flex:1, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#fff", color:"#111111", border:"1px solid #111111", cursor:"pointer" }}>登録情報を修正</button>
                <button onClick={()=>{ setCstep(v => v + 1); consignScrollTop(); }} className="f-sans" style={{ flex:1.4, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>次へ →</button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={()=>setConsentChecked(v => !v)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"12px 14px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: consentChecked ? "2px solid #111111" : "1px solid #D0D0D0", background: consentChecked ? "#111111" : "#fff", color: consentChecked ? "#fff" : "#111111", marginBottom:12 }}>
                <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13.2, fontWeight:800, border: consentChecked ? "none" : "2px solid #C8C8C8", background: consentChecked ? "#fff" : "transparent", color:"#111111" }}>{consentChecked ? "✓" : ""}</span>
                新規登録時の情報を、委託者情報の作成、契約条件の明示および取引相手への必要な範囲での開示に利用することを確認しました
              </button>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={openRegEdit} className="f-sans" style={{ flex:1, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#fff", color:"#111111", border:"1px solid #111111", cursor:"pointer" }}>登録情報を修正</button>
                <button onClick={agreeConsent} disabled={consentSaving || !consentChecked} className="f-sans" style={{ flex:1.4, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor: consentChecked ? "pointer" : "not-allowed", opacity: (consentSaving || !consentChecked) ? 0.4 : 1 }}>{consentSaving ? <>記録中<Dots /></> : "委託掲載を始める"}</button>
              </div>
            </>
          )}
        </>);
      })()}
      {stepKey === "type" && (
        <div style={{ display:"grid", gap:12 }}>
          <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:0 }}>新規登録に区分が登録されていないため、ここで選択します（通常は表示されません）。</p>
          {[["individual","個人事業者","氏名で契約し、屋号を持てます。担当者ページは省略されます。"],["corporate","法人","契約の当事者は法人。法人情報は新規登録から引き継ぎます。"]].map(([t, l, de]) => (
            <button key={t} onClick={()=>pickType(t)} className="f-sans" style={{ textAlign:"left", background: ctype === t ? "#111111" : "#fff", border:"2px solid #111111", borderRadius:20, padding:"20px 18px", cursor:"pointer" }}>
              <span style={{ display:"block", fontSize:18.7, fontWeight:800, color: ctype === t ? "#fff" : "#111111" }}>{l}</span>
              <span style={{ display:"block", fontSize:13.2, color: ctype === t ? "#B9B9B9" : "#717171", marginTop:4, lineHeight:1.6 }}>{de}</span>
            </button>
          ))}
        </div>
      )}

      {stepKey === "ind" && (<>
        {/* 区分は読み取り専用ラベル（2026-08-02たきと指示・委託フロー内では変更させない） */}
        <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"0 0 12px" }}>現在の登録区分：個人事業者（区分の変更は登録情報から）</p>
        {CONSIGNOR_IND_FIELDS.map(renderCF)}
      </>)}
      {stepKey === "corp" && (<>
        <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"0 0 12px" }}>現在の登録区分：法人（区分の変更は登録情報から）</p>
        {/* 引き継ぎボックスは削除（2026-08-02たきと指示）＝引き継ぎ内容は初回の同意ゲートで既に提示済み。
            法人番号のチェックデジット警告だけは残す（公的情報との照合・不一致時のみ表示） */}
        {(() => { const cn = ((ahInfo?.company_number || d.corp_no || "") + "").trim(); return corpNoCheckOk(cn) === false && (
          <p className="f-sans" style={{ fontSize:12.1, fontWeight:700, color:"#111111", margin:"0 0 10px" }}>登録されている法人番号（{cn}）の検査用数字が合いません。修正は運営にお問い合わせください。</p>
        ); })()}
        {CONSIGNOR_CORP_FIELDS.map(renderCF)}
      </>)}
      {/* 登録内容確認（入力済みのみ表示）＋契約書の当事者欄プレビュー */}
      {stepKey === "confirm" && <div>{renderProfileBox()}</div>}

      {/* ナビ（次へ／保存する） */}
      {stepKey !== "type" && stepKey !== "consent" && (
        <div style={{ marginTop:20 }}>
          {stepKey !== "confirm" ? (
            <button onClick={()=>{ setCstep(v => v + 1); consignScrollTop(); }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>次へ →</button>
          ) : (<>
            {/* 最終同意（2026-07-31たきと指示）：チェックするまで保存できない */}
            <button type="button" onClick={()=>setConfirmAgree(v => !v)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"12px 14px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: confirmAgree ? "2px solid #111111" : "1px solid #D0D0D0", background: confirmAgree ? "#111111" : "#fff", color: confirmAgree ? "#fff" : "#111111", marginBottom:10 }}>
              <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13.2, fontWeight:800, border: confirmAgree ? "none" : "2px solid #C8C8C8", background: confirmAgree ? "#fff" : "transparent", color:"#111111" }}>{confirmAgree ? "✓" : ""}</span>
              この情報を委託者情報として使用します
            </button>
            <button onClick={save} disabled={saving || !confirmAgree} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor: confirmAgree ? "pointer" : "not-allowed", opacity: (saving || !confirmAgree) ? 0.4 : 1 }}>{saving ? <>保存中<Dots /></> : "保存する"}</button>
          </>)}
          {saved && <p className="f-sans" style={{ fontSize:13.2, color:"#111111", textAlign:"center", marginTop:10 }}>保存しました ✓</p>}
        </div>
      )}
    </div>
  );
}

// 背景の空（2026-07-31たきと指示「背景に太陽追加。朝昼夜を演出。時間によって太陽が左から右に移動」）。
// 入場演出（草・蔓・空） → features/consignment/entranceArt.js へ移設（2026-08-17）

export function ConsignmentRoom() {
  // 画面切替はURLで裏打ちする（2026-08-01たきと報告「スワイプで前のページに戻らない」の根治）：
  // 一覧=#/admin/consignment／新規=#/admin/consignment/new／案件=#/admin/consignment/deal/{id}／
  // 委託専用プロフィール=#/admin/consignment/profile（2026-07-31たきと指示）。
  // openDeal/newDeal/名刺タップはhashを進め、実際の画面切替はhashchangeが担う＝スワイプ・ブラウザ戻るが
  // そのまま「一覧へ戻る」になる（さがす→求人詳細と同じ作法）
  const readConsignView = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const m = h.match(/^admin\/consignment\/deal\/([0-9a-f-]+)$/);
    if (m) return { view: "deal", id: m[1] };
    if (h === "admin/consignment/new") return { view: "new" };
    if (h === "admin/consignment/profile") return { view: "profile" };
    // 受託面（2026-08-05たきと指示）：委託＝出す側／受託＝受ける側の2面。求人求職のトグルと同じ構造ので
    // 面ごとにURLを持たせる（#/profile/worker ⇄ #/profile/employer と同じ作法）＝戻る・スワイプ・直打ちが効く
    if (h === "admin/consignment/contractor") return { view: "contractor" };
    return { view: "list" };
  };
  const [cTab, setCTab] = useState(() => { const v = readConsignView().view; return v === "list" ? "list" : v === "contractor" ? "contractor" : v === "profile" ? "profile" : v === "new" ? "new" : "deal"; }); // list=委託面（一覧）/ contractor=受託面 / deal=案件ダッシュボード / profile=委託専用プロフィール
  // 委託⇄受託の反転アニメ（ProfileHubのpTab切替と同じ2段階：pflip-out 0.4s→面切替→pflip-in 0.4s）
  const [cAnim, setCAnim] = useState("");
  const [contractorFlip, setContractorFlip] = useState(false); // 「委託をさがす」カードの反転（掲載板は準備中）
  // 入場演出（ポケモンバトル風・2026-07-31たきと指示）：入室のたびに1回だけ再生。
  // ステップ展開（2026-07-31たきと指示・順序改定「まず太陽→草」／2026-08-05に草を3群へ）：
  // 線(0.22s)→①太陽・上段(0.10s〜)→②草・右下(0.45s〜)→③草・左中(0.80s〜)→④草・右上(1.15s〜)
  // →幕が開く(1.75s+0.5s)＝約2.25sで終演、2.5sでDOMから外す（2026-08-03・太陽→花火）。
  // ※幕が開く時刻の正はCSS（.consign-entrance-top/bottom の animation-delay 1.75s）。
  //   草の delay を足すときは、生え終わり（delay+0.12+0.34）が1.75sを超えないこと
  // 動きを減らす設定の端末では最初から出さない（CSS側のprefers-reduced-motionと二重の判定）
  const [entrance, setEntrance] = useState(() => {
    try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
  });
  // 草の配置は入室ごとに抽選（毎回違うパターン・たきと指示）。再レンダーでは変えない＝useStateの初期化で1回だけ
  const [entranceGrass] = useState(makeConsignGrass);
  const [vines] = useState(makeConsignVines); // 背景の蔓も入室ごとに抽選
  const [sky, setSky] = useState(() => computeSky(new Date())); // 背景の空（朝昼夜・太陽/月の位置）
  // 時間経過で太陽/月を動かす（2026-07-31たきと指示）：毎分再計算。移動はCSS transitionで滑らかに
  useEffect(() => {
    const iv = setInterval(() => setSky(computeSky(new Date())), 60000);
    return () => clearInterval(iv);
  }, []);
  // 入力中に背景がずれない固定（2026-07-31たきと報告「入力するとき背景が上にずれて太陽が見えない」）：
  // iOSはキーボードが開くと画面ごと上にパンし、fixedの背景（空・蔓）も一緒に押し上げられる。
  // visualViewport の offsetTop分だけ背景を下へ平行移動し、見えている画面に貼り付け直す＝背景は変わらない。
  // 四隅の蔓は容器をtransformするとfixedな子の基準が壊れるため対象外（額縁ので実害なし）
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const move = () => {
      const y = vv.offsetTop || 0;
      document.querySelectorAll(".consign-sky, .consign-vines").forEach(el => { el.style.transform = y ? `translateY(${y}px)` : ""; });
    };
    vv.addEventListener("resize", move);
    vv.addEventListener("scroll", move);
    return () => {
      vv.removeEventListener("resize", move);
      vv.removeEventListener("scroll", move);
      document.querySelectorAll(".consign-sky, .consign-vines").forEach(el => { el.style.transform = ""; });
    };
  }, []);
  // 夜の星（月を煌びやかに・2026-07-31たきと指示）：上空に瞬く星を入室ごとに抽選
  const [skyStars] = useState(() => Array.from({ length: 14 }, () => ({
    x: +(2 + Math.random() * 96).toFixed(1), y: +(2 + Math.random() * 30).toFixed(1),
    s: +(1.5 + Math.random() * 2.2).toFixed(1), dur: +(1.8 + Math.random() * 2.2).toFixed(1), delay: +(Math.random() * 3).toFixed(1),
  })));
  // 画面最上端（ステータスバー/ブラウザの帯）まで空に染める（2026-07-31たきと指示「背景を画面上限まで」）：
  // アプリが描けない上端の帯は theme-color と html背景から色を拾うOS/ブラウザが多い。
  // 委託ページ表示中だけ空の不透明色(chrome)に切替え、退室時に元へ戻す
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevMeta = meta ? meta.getAttribute("content") : null;
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const col = (cTab === "new" || cTab === "profile") ? "#FFFFFF" : sky.chrome; // ウィザード・プロフィールは背景ホワイト統一（2026-07-31/2026-08-02たきと指示）
    if (meta) meta.setAttribute("content", col);
    document.documentElement.style.backgroundColor = col;
    return () => {
      if (meta && prevMeta != null) meta.setAttribute("content", prevMeta);
      document.documentElement.style.backgroundColor = prevHtmlBg;
    };
  }, [cTab, sky.chrome]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wind, setWind] = useState(null); // 委託地の現在の風（Open-Meteo・{speed:km/h, dir:度(吹いてくる向き)}）
  // 四隅の蔓：大きさだけ隅ごとに抽選（140〜220px）。向きは四隅で固定＝反転で使い回す
  const [cornerSizes] = useState(() => Array.from({ length: 4 }, () => Math.round(140 + Math.random() * 80)));
  useEffect(() => {
    if (!entrance) return;
    const t = setTimeout(() => setEntrance(false), 2500); // 花火5〜7発ぶん延長（2026-08-03）
    return () => clearTimeout(t);
  }, [entrance]);
  // 委託地（徳島県吉野川市）の現在の風を取得（Open-Meteo・無料/キー不要/CORS可）。
  // 失敗時は wind=null のまま＝既定のゆるやかな揺れにフォールバック（zipcloudと同じくクライアント取得）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=34.066&longitude=134.366&current=wind_speed_10m,wind_direction_10m");
        const j = await res.json();
        const c = j && j.current;
        if (!cancelled && c) setWind({ speed: Number(c.wind_speed_10m) || 0, dir: Number(c.wind_direction_10m) || 0 });
      } catch { /* 取得失敗は既定の揺れのまま */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [spec, setSpec] = useState({ ...CONSIGN_EMPTY });
  const [editId, setEditId] = useState(null);
  const [curDeal, setCurDeal] = useState(null); // 開いている案件の全行（status/agreed_at/inspected_at/paid_at/spec_snapshot等）
  const [status, setStatus] = useState("draft");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showDeadlineCal, setShowDeadlineCal] = useState(false);
  const [wizStep, setWizStep] = useState(1); // 新規ウィザードの現在ステップ（1〜5・cTab==="new"時のみ有効）
  const [leaving, setLeaving] = useState(false); // 退場演出中（新しく委託を出す→蔓→太陽→中身の順に画面外へ・2026-07-31たきと指示）
  // 標準取引条件（支払期限・手数料負担・検収期間・キャンセル条件）は委託掲載を初めて行うときに
  // ウィザード内で設定する（2026-07-31たきと指示）。未設定の項目だけSTEP3に出し、掲載時に委託者情報へ保存
  const [stdTerms, setStdTerms] = useState({});
  const [returning, setReturning] = useState(false); // 帰還演出中（ウィザード→一覧に戻るとき、退場の逆再生＝中身→太陽→蔓・2026-07-31たきと指示）
  const [printOpen, setPrintOpen] = useState(false);
  // 前回内容で即描画→裏で最新に差し替え（2026-08-02たきと指示「委託ページの更新が遅い」）。
  // このページだけviewCache未導入で、引き下げ更新のたび台帳・進捗・名刺を白紙から取り直していた
  const [deals, setDeals] = useState(() => getCache("consign:deals") ?? []);
  const [progAgg, setProgAgg] = useState(() => getCache("consign:progAgg") ?? {}); // 台帳の要約用：deal_id→{hours,boxes,days}
  const [busy, setBusy] = useState(false);
  const todayJst = () => { try { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); } };
  // 日次進捗（作業中）
  const [prog, setProg] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pForm, setPForm] = useState({ work_date: "", hours: "", workers: "", yield_boxes: "", note: "" });
  const [inspectNote, setInspectNote] = useState("");
  const [reflection, setReflection] = useState("");
  const dealAreaA = (d) => { const v = d?.area_a != null ? d.area_a : (d?.spec || {}).area_a; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const hoursPer10a = (hours, area) => area ? Math.round(hours * 10 / area * 10) / 10 : null;
  const loadDeals = async () => {
    const [dl, pr] = await Promise.all([
      supabase.from("consignment_deals").select("*").order("created_at", { ascending: false }),
      supabase.from("consignment_progress").select("deal_id,hours,yield_boxes,work_date"),
    ]);
    setDeals(dl.data || []); setCache("consign:deals", dl.data || []);
    const agg = {};
    (pr.data || []).forEach(r => { const a = agg[r.deal_id] || { hours: 0, boxes: 0, days: new Set() }; a.hours += Number(r.hours || 0); a.boxes += Number(r.yield_boxes || 0); if (r.work_date) a.days.add(r.work_date); agg[r.deal_id] = a; });
    const out = {}; Object.entries(agg).forEach(([k, v]) => { out[k] = { hours: v.hours, boxes: v.boxes, days: v.days.size }; });
    setProgAgg(out); setCache("consign:progAgg", out);
    return dl.data || [];
  };
  const loadProgress = async (id) => {
    if (!id) { setProg([]); setSummary(null); return; }
    const [{ data: rows }, { data: sum }] = await Promise.all([
      supabase.from("consignment_progress").select("*").eq("deal_id", id).order("work_date", { ascending: false }),
      supabase.rpc("consignment_summary", { p_deal_id: id }),
    ]);
    setProg(rows || []);
    setSummary(sum && sum.ok ? sum : null);
  };
  // トップの大プロフィールカード用（農家プロフィール入口と同じ構造・2026-07-31たきと指示）。
  // 名刺の中身は employer_profiles の自分の行から（このページはprops無しなので自分で引く）
  // 名刺はviewCache→（アプリ再起動後は）FarmerDashboardが保存したsnapshot(empMini)→nullの順で即表示。
  // ここからsnapshotへは書かない（このページのempMiniは2列だけの縮小形ので、全列形の正本を上書きしない）
  const [empMini, setEmpMini] = useState(() => getCache("consign:empMini") ?? snapGet("empMini") ?? null);
  // 委託者情報（設定ページの保存値・確認STEP5と印刷仕様書へ自動反映）。設定ページから戻るたびに再読込。
  // 身元（氏名・法人名・住所）は account_holders＝唯一の正から並行取得（2026-08-02たきと確定指示）
  const [consignor, setConsignor] = useState(() => getCache("consign:consignor") ?? null);
  const [consignAh, setConsignAh] = useState(() => getCache("consign:ah") ?? null);
  // 委託圃場（2026-08-02たきと指示）：プロフィールのスワイプ2枚目で登録・管理。
  // ウィザードSTEP1の呼び出しと、掲載時の自動登録（同名upsert）で共用
  const [fields, setFields] = useState(() => getCache("consign:fields") ?? []);
  const loadFields = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from("consignment_fields").select("*").eq("auth_id", session.user.id).order("updated_at", { ascending: false });
      setFields(data || []); setCache("consign:fields", data || []);
    } catch {}
  };
  // 既存写真の自動軽量化（2026-08-03たきと指示「自動で圧縮処理」・手動操作ゼロ）：
  // 圧縮修理(c4b49b1)より前に原寸で上がった写真を、委託ページを開いたとき裏で1回だけ圧縮し直す。
  // HEADでサイズ確認→700KB超だけ対象。新URLへ差し替え成功後に旧ファイルを削除（孤児を残さない）。
  // 1セッション1回（sessionStorageフラグ）。以後のアップロードは常に自動圧縮ので新たな対象は増えない
  const healConsignPhotos = async () => {
    try {
      if (sessionStorage.getItem("cb_consignPhotoHeal_v1")) return;
      sessionStorage.setItem("cb_consignPhotoHeal_v1", "1");
    } catch {}
    const MARK = "/object/public/consignment-photos/";
    const heal = async (url) => {
      try {
        if (!url || !url.includes(MARK)) return null;
        const head = await fetch(url, { method: "HEAD" });
        const size = Number(head.headers.get("content-length") || 0);
        if (!size || size <= 700 * 1024) return null;
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" });
        const { url: newUrl } = await uploadJobPhoto(supabase, file, { bucket: "consignment-photos", pathPrefix: "consign_heal_", withThumb: false });
        return newUrl || null;
      } catch { return null; }
    };
    const dropOld = async (url) => {
      try { await supabase.storage.from("consignment-photos").remove([decodeURIComponent(url.split(MARK)[1])]); } catch {}
    };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // 圃場写真
      const { data: frows } = await supabase.from("consignment_fields").select("id,data").eq("auth_id", session.user.id);
      let touched = false;
      for (const f of (frows || [])) {
        const cur = (f.data || {}).photo || "";
        const nu = await heal(cur);
        if (!nu) continue;
        const { error } = await supabase.from("consignment_fields").update({ data: { ...(f.data || {}), photo: nu }, updated_at: new Date().toISOString() }).eq("id", f.id);
        if (!error) { dropOld(cur); touched = true; }
      }
      // 案件写真（spec.photos。合意後の比較対象は基本/テキスト項目のみので写真URL差し替えは無害）
      const { data: drows } = await supabase.from("consignment_deals").select("id,spec");
      for (const d of (drows || [])) {
        const ph = ((d.spec || {}).photos || []);
        const next = []; let changed = false; const olds = [];
        for (const pht of ph) {
          const nu = await heal(pht && pht.url);
          if (nu) { next.push({ ...pht, url: nu }); olds.push(pht.url); changed = true; }
          else next.push(pht);
        }
        if (changed) {
          const { error } = await supabase.from("consignment_deals").update({ spec: { ...(d.spec || {}), photos: next }, updated_at: new Date().toISOString() }).eq("id", d.id);
          if (!error) olds.forEach(dropOld);
        }
      }
      if (touched) loadFields();
    } catch {}
  };
  // 掲載・保存の成功時に、入力中の圃場情報を登録簿へ自動保存（呼び名が空なら何もしない）
  const saveFieldRegistry = async (sp) => {
    const name = (sp.field_name || "").trim();
    if (!name) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // 既存の圃場＝正式住所（region/zip/番地・圃場ペインで登録）を保持し、面積・設備だけ更新する。
      // ウィザードの地域欄は掲載用の粗い表記ので、正式住所を上書きしない（2026-08-02たきと指示）
      const existing = fields.find(x => x.name === name);
      const exd = (existing && existing.data) || {};
      await supabase.from("consignment_fields").upsert({
        auth_id: session.user.id, name,
        region: existing ? existing.region : (sp.region || "").trim(),
        area_a: String(sp.area_a || "").trim(),
        data: { ...exd },
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id,name" });
      loadFields();
    } catch {}
  };
  // プロフィールの2面（委託者情報⇄委託圃場）：スワイプと上部チップで切替
  const [profilePane, setProfilePane] = useState("info");
  const profTouchRef = useRef(null);
  // 登録済みの圃場をウィザードへ呼び出す（STEP1）。空欄は現在値を残す＝上書きは自由
  const applyField = (f) => {
    const fd = f.data || {};
    setSpec(p => {
      // 登録済みの圃場写真も呼び出して案件写真へ（1枚・既にあれば足さない）
      const photos = [...(p.photos || [])];
      if ((fd.photo || "").trim() && !photos.some(x => x && x.url === fd.photo)) photos.push({ url: fd.photo });
      return { ...p, field_name: f.name, region: f.region || p.region, area_a: f.area_a || p.area_a, photos };
    });
  };
  // 貸与できる道具・機械・設備（2026-08-02たきと指示・圃場の設備から移植）：委託者単位の登録簿。
  // 正本= consignment_profiles.consignor_data.cmn_lend_items。案件には掲載時に写し（spec.facility_lend）が凍結される
  const lendCatalog = normalizeLendItems(((consignor || {}).consignor_data || {}).cmn_lend_items);
  const lendItems = lendCatalog.map(x => x.n);        // 名前のみ（仕様書へ載る文字列＝従来どおり）
  const lendKindOf = (n) => (lendCatalog.find(x => x.n === n) || {}).k || "";
  // 委託機能利用特約（2026-08-02たきと指示）：「新しく委託を出す」タップで初回ゲートとして展開。
  // 同意済み（版数一致）なら右上の浮遊ボックスからいつでも再読できる
  const termsOk = !!(consignor && consignor.consignment_terms_consent && consignor.consignment_terms_consent_version === CONSIGN_TERMS_VERSION);
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);
  const [termsModal, setTermsModal] = useState(false);
  const [consignHelpKey, setConsignHelpKey] = useState(null); // ？で開いている説明（terms/cmn_inspect/cmn_cancel）
  // ？ボタン＋コメント式説明（委託者情報フローのrenderCFと同じ様式・2026-08-03たきと指示）
  const helpBtn = (key) => (
    <button type="button" onClick={()=>setConsignHelpKey(v => v === key ? null : key)} aria-label="説明を表示" className="f-sans" style={{ flexShrink:0, width:20, height:20, borderRadius:"50%", border:"1.5px solid #111111", background: consignHelpKey === key ? "#111111" : "#fff", color: consignHelpKey === key ? "#fff" : "#111111", fontSize:12.1, fontWeight:800, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}>？</button>
  );
  const helpNote = (key, text) => (consignHelpKey === key ? (
    <p className="f-sans" style={{ fontSize:12.1, color:"#111111", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"6px 0 8px", lineHeight:1.7 }}>{text}</p>
  ) : null);
  const agreeTerms = async () => {
    if (termsSaving || !termsChecked) return;
    setTermsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setTermsSaving(false); return; }
      const patch = {
        auth_id: session.user.id,
        consignment_terms_consent: true,
        consignment_terms_consent_at: new Date().toISOString(),
        consignment_terms_consent_version: CONSIGN_TERMS_VERSION,
        consignment_terms_consent_user_id: session.user.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("consignment_profiles").upsert(patch, { onConflict: "auth_id" });
      if (error) alert("同意の記録に失敗しました：" + error.message);
      else {
        const merged = { ...(consignor || {}), ...patch };
        setConsignor(merged); setCache("consign:consignor", merged);
        consignScrollTop();
      }
    } catch { alert("同意の記録に失敗しました。"); }
    setTermsSaving(false);
  };
  useEffect(() => {
    if (cTab === "profile") return; // 設定ページ自身はフォーム側が読む
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const [{ data }, { data: ah }] = await Promise.all([
          supabase.from("consignment_profiles").select("*").eq("auth_id", session.user.id).maybeSingle(),
          supabase.from("account_holders")
            .select("full_name,postal_code,address,entity_type,contact_email,contact_phone,company_name,company_number")
            .eq("auth_id", session.user.id).maybeSingle(),
        ]);
        setConsignor(data || null); setCache("consign:consignor", data || null);
        setConsignAh(ah || null); setCache("consign:ah", ah || null);
      } catch {}
    })();
  }, [cTab]);
  // ★mount時の読み込み（loadDeals・名刺・リロード復元）は openDealState の定義より後ろに置いた
  //   effectが担う（no-use-before-define対応＝「呼ぶ側・effectを下げる」の作法・2026-07-29教訓）
  const setF = (k, v) => setSpec(p => ({ ...p, [k]: v }));
  // 写真アップロード（consignment-photos バケット・管理者のみ書込＝RLSで担保）。
  // 複数選択可・spec.photos に {url} で追記。job-photos の作法に準拠
  const handlePhotoFiles = async (files) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setPhotoUploading(true);
    try {
      for (const file of list) {
        // 原寸のまま上げるとiPhone写真がバケット上限(5MB)を超える→求人写真と同じ共通ヘルパーで
        // HEIC変換＋1600px/0.8圧縮してからアップロード（2026-08-03バグ修理）
        try {
          const { url } = await uploadJobPhoto(supabase, file, { bucket: "consignment-photos", pathPrefix: "consign_", withThumb: false });
          setSpec(p => ({ ...p, photos: [...(p.photos || []), { url }] }));
        } catch (e) { alert("写真のアップロードに失敗しました：" + (e?.message || "不明なエラー")); }
      }
    } catch { alert("写真のアップロードに失敗しました。"); }
    setPhotoUploading(false);
  };
  const removePhoto = (i) => setSpec(p => ({ ...p, photos: (p.photos || []).filter((_, k) => k !== i) }));
  // 初回掲載で入力した標準取引条件を委託者情報(consignor_data)へ保存（空欄は書かない・既存値は上書きしない）
  const saveStdTerms = async () => {
    const entries = Object.entries(stdTerms).filter(([, v]) => (v || "").trim());
    if (!entries.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const merged = { ...((consignor && consignor.consignor_data) || {}) };
      entries.forEach(([k, v]) => { if (!(merged[k] || "").trim()) merged[k] = v.trim(); });
      await supabase.from("consignment_profiles").upsert({ auth_id: session.user.id, consignor_data: merged, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setConsignor(c => c ? { ...c, consignor_data: merged } : { consignor_data: merged });
    } catch {}
  };
  // 履行期限のカレンダー選択（1回目=開始／2回目=終了／開始より前=選び直し）。
  // raw(date_start/date_end)とラベル(deadline)を同時に更新
  const onDeadlineSelect = (dt) => {
    const ds = parseYmd(spec.date_start);
    const de = parseYmd(spec.date_end);
    let ns, ne;
    if (!ds || de) { ns = dt; ne = null; }
    else if (dt >= ds) { ns = ds; ne = dt; }
    else { ns = dt; ne = null; }
    const nds = ymdLocal(ns);
    const nde = ne ? ymdLocal(ne) : "";
    setSpec(p => ({ ...p, date_start: nds, date_end: nde, deadline: deadlineLabel(nds, nde) }));
  };
  const refreshCur = async (id) => {
    const { data } = await supabase.from("consignment_deals").select("*").eq("id", id).maybeSingle();
    if (data) { setCurDeal(data); setStatus(data.status || "draft"); }
    await loadDeals();
  };
  const save = async () => {
    if (saving) return false;
    if ((spec.photos || []).length < 3) { alert("掲載には写真が最低3枚必要です。"); return false; }
    setSaving(true);
    try {
      const payload = { spec: { ...spec, crop: CONSIGN_CROP, fixed_clauses: CONSIGN_FIXED_CLAUSES }, status, notes: memo.trim() || null, updated_at: new Date().toISOString() };
      if (editId) {
        const { error } = await supabase.from("consignment_deals").update(payload).eq("id", editId);
        if (error) { alert("保存に失敗しました：" + error.message); setSaving(false); return false; }
        await refreshCur(editId);
      } else {
        const { data, error } = await supabase.from("consignment_deals").insert(payload).select("*").single();
        if (error) { alert("保存に失敗しました：" + error.message); setSaving(false); return false; }
        if (data) {
          setEditId(data.id); setCurDeal(data);
          // URLを /new → /deal/{id} に置換（pushしない＝スワイプ/戻る1回で一覧へ帰れるまま）
          try { window.history.replaceState(null, "", "#/admin/consignment/deal/" + data.id); } catch {}
        }
        await loadDeals();
      }
    } catch { alert("保存に失敗しました。"); setSaving(false); return false; }
    saveFieldRegistry(spec); // 圃場を登録簿へ自動保存（2026-08-02たきと指示・失敗しても掲載は成立）
    setSaving(false);
    return true;
  };
  // 状態を1つ進める共通処理（合意/前金/作業中/検収/支払/完了）。パッチをupdate→現行行を取り直す
  const advance = async (patch, confirmMsg) => {
    if (busy || !editId) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const { error } = await supabase.from("consignment_deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", editId);
    if (error) { alert("更新に失敗しました：" + error.message); setBusy(false); return; }
    await refreshCur(editId);
    setBusy(false);
  };
  const makeAgreed = () => advance({ status: "agreed" }, "この内容で合意にしますか？\n合意すると、いまの仕様書が「合意時の仕様書」として凍結されます。");
  const receiveDeposit = async () => advance({ spec: { ...(curDeal?.spec || spec), deposit_received_at: todayJst() } }, "着手金を受領した記録を残しますか？");
  const startWork = () => advance({ status: "working" }, "作業中にしますか？");
  const doInspect = () => advance({ status: "inspected", inspected_at: todayJst(), notes: inspectNote.trim() || (curDeal?.notes || null) }, "検収を記録しますか？");
  const doPay = () => advance({ status: "paid", paid_at: todayJst() }, "残金の支払いを記録しますか？");
  const doComplete = () => advance({ status: "done", spec: { ...(curDeal?.spec || spec), reflection: reflection.trim() } }, "この委託を完了にしますか？");
  const addProgress = async () => {
    if (busy || !editId) return;
    const p = pForm;
    if (!p.hours && !p.yield_boxes && !p.workers && !p.note.trim()) { alert("実働時間・人数・収量箱・メモのいずれかを入力してください。"); return; }
    setBusy(true);
    const { error } = await supabase.from("consignment_progress").insert({
      deal_id: editId,
      work_date: p.work_date || todayJst(),
      hours: p.hours === "" ? null : Number(p.hours),
      workers: p.workers === "" ? null : parseInt(p.workers, 10),
      yield_boxes: p.yield_boxes === "" ? null : parseInt(p.yield_boxes, 10),
      note: p.note.trim() || "",
    });
    if (error) { alert("記録に失敗しました：" + error.message); setBusy(false); return; }
    setPForm({ work_date: "", hours: "", workers: "", yield_boxes: "", note: "" });
    await loadProgress(editId);
    setBusy(false);
  };
  const openDealState = (d) => { setSpec({ ...CONSIGN_EMPTY, ...(d.spec || {}) }); setEditId(d.id); setCurDeal(d); setStatus(d.status || "draft"); setMemo(d.notes || ""); setInspectNote(d.notes || ""); setReflection((d.spec || {}).reflection || ""); setCTab("deal"); loadProgress(d.id); };
  const newDealState = () => { setSpec({ ...CONSIGN_EMPTY }); setEditId(null); setCurDeal(null); setStatus("draft"); setMemo(""); setInspectNote(""); setReflection(""); setProg([]); setSummary(null); setWizStep(1); setCTab("new"); };
  const openDeal = (d) => { openDealState(d); window.location.hash = "/admin/consignment/deal/" + d.id; };
  // 新しく委託を出す：まず蔓が画面外へ→次に太陽→最後に名刺・ボックス・文言が退場→ウィザードへ（2026-07-31たきと指示）。
  // 振り付けはCSS（.consign-leaving）。動きを減らす設定の端末は演出なしで即遷移
  const newDeal = () => {
    if (leaving) return;
    let reduce = false; try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
    if (reduce) { newDealState(); window.location.hash = "/admin/consignment/new"; return; }
    setLeaving(true);
    setTimeout(() => { setLeaving(false); newDealState(); window.location.hash = "/admin/consignment/new"; }, 1250);
  };
  // 名刺タップ→委託プロフィールページ：新しく委託を出すと同じ退場演出（蔓→太陽→中身）で遷移し、
  // プロフィールは背景ホワイト（2026-08-02たきと指示）
  const openProfile = () => {
    if (leaving) return;
    let reduce = false; try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
    if (reduce) { setProfilePane("info"); setCTab("profile"); window.location.hash = "/admin/consignment/profile"; return; }
    setLeaving(true);
    setTimeout(() => { setLeaving(false); setProfilePane("info"); setCTab("profile"); window.location.hash = "/admin/consignment/profile"; }, 1250);
  };
  // mount時の読み込み：一覧＋名刺。URLが /deal/{id} のままのリロードは取得行でその案件を開き直す
  useEffect(() => {
    (async () => {
      // 案件ビューへの復元は、キャッシュにあれば一覧の取得を待たず即開く（2026-08-02）。
      // 開けた場合は取得後の再オープンをしない（開いた直後の入力を最新データで上書きしない）
      const c0 = readConsignView();
      let opened = false;
      if (c0.view === "deal") {
        const cached = (getCache("consign:deals") ?? []).find(x => x.id === c0.id);
        if (cached) { openDealState(cached); opened = true; }
      }
      const rows = await loadDeals();
      if (!opened) {
        const c1 = readConsignView();
        if (c1.view === "deal") { const d0 = (rows || []).find(x => x.id === c1.id); if (d0) openDealState(d0); }
      }
    })();
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("employer_profiles").select("nickname,avatar_url").eq("auth_id", session.user.id).maybeSingle();
        setEmpMini(data || null); setCache("consign:empMini", data || null);
      } catch {}
    })();
    loadFields(); // 委託圃場（2026-08-02）
    healConsignPhotos(); // 旧・原寸写真の自動軽量化（2026-08-03・1セッション1回）
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // スワイプ・戻る・URL直打ちの全部をここで受ける。dealsはクロージャで凍るためrefで最新を持つ
  const dealsRef = useRef([]);
  useEffect(() => { dealsRef.current = deals; }, [deals]);
  const cTabRef = useRef(cTab);
  useEffect(() => { cTabRef.current = cTab; }, [cTab]);
  useEffect(() => {
    const onHash = () => {
      const c = readConsignView();
      if (c.view === "list") {
        // ウィザードからの帰還＝退場演出の逆再生（中身→太陽→蔓）。戻るタップも指スワイプもhash経由でここに来る
        if (cTabRef.current === "new" || cTabRef.current === "profile") {
          let reduce = false; try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
          if (!reduce) { setReturning(true); setTimeout(() => setReturning(false), 1300); }
        }
        setCTab("list"); loadDeals();
      }
      else if (c.view === "new") { newDealState(); }
      else if (c.view === "profile") { setProfilePane("info"); setCTab("profile"); }
      // 受託面（2026-08-05）：委託面と同じ「一覧の世界」ので帰還演出（ウィザード・プロフィールからの逆再生）は挟まない
      else if (c.view === "contractor") { setCTab("contractor"); }
      else { const d = dealsRef.current.find(x => x.id === c.id); if (d) openDealState(d); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 合意後にフォームを変更したか（保存済みspec vs 凍結snapshot・基本/テキスト項目で比較）
  const specKeys = [...CONSIGN_BASIC_FIELDS.map(f => f.k), ...CONSIGN_TEXT_FIELDS.map(f => f.k)];
  const pick = (o) => specKeys.reduce((a, k) => { a[k] = (o || {})[k] || ""; return a; }, {});
  const changedAfterAgree = !!(curDeal && curDeal.spec_snapshot && JSON.stringify(pick(curDeal.spec)) !== JSON.stringify(pick(curDeal.spec_snapshot)));
  const snapAtLabel = curDeal?.snapshot_at ? new Date(curDeal.snapshot_at).toLocaleString("ja-JP") : "";
  const hasDeposit = !!(spec.advance && String(spec.advance).trim());
  // 風→蔓の靡き（2026-07-31たきと指示）：向き=東西成分で左右に傾け、強さ=風速で揺れ幅と速さを増す。
  // dir は「吹いてくる向き」ので東向きの押し＝-sin(dir)（西風→右へ／東風→左へ）。未取得は0＝従来のゆるやか
  const windSpeed = wind ? wind.speed : 0;                 // km/h
  const windEast = wind ? -Math.sin(wind.dir * Math.PI / 180) : 0; // +右 / -左
  const swayAmp = Math.min(16, 2.5 + windSpeed * 0.35);   // 揺れ幅（度）
  const swayCenter = +(windEast * Math.min(14, windSpeed * 0.5)).toFixed(1); // 傾き中心（度・風向き）
  const windMult = Math.min(3, 1 + windSpeed * 0.05);     // 揺れの速さ倍率（風速で速く）

  // 当日の現場連絡先（2026-08-02たきと指示）：恒久連絡先は登録情報から自動＝案件ごとに必要なときだけ上書き。
  // 法人では登録担当者と圃場へ来る担当者が違うことがある。個人でも当日だけ家族・従業員を連絡先にする場合がある
  const renderOnsiteContact = () => {
    const mode = spec.onsite_contact_mode || "登録情報を使用";
    return (
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">当日の現場連絡先</label>
        <div style={{ display:"flex", gap:8, marginBottom: mode === "別の連絡先を使用" ? 8 : 0 }}>
          {["登録情報を使用", "別の連絡先を使用"].map(opt => {
            const on = mode === opt;
            return (
              <button key={opt} type="button" onClick={()=>setF("onsite_contact_mode", opt)} className="f-sans" style={{ padding:"9px 14px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
            );
          })}
        </div>
        {mode === "別の連絡先を使用" && (<>
          <label className="lbl f-sans">氏名</label>
          <input className="field f-sans" value={spec.onsite_name || ""} onChange={e=>setF("onsite_name", e.target.value)} placeholder="例：千歳 花子" style={{ fontSize:15.4, marginBottom:8 }} />
          <label className="lbl f-sans">電話番号</label>
          <input className="field f-sans" value={spec.onsite_phone || ""} onChange={e=>setF("onsite_phone", e.target.value)} placeholder="例：090-1234-5678" style={{ fontSize:15.4, marginBottom:0 }} />
        </>)}
      </div>
    );
  };
  // 圃場設備（2026-07-31たきと指示「圃場設備は圃場登録時に設定」＝案件ごと・spec保存）
  const renderFacilities = () => (
    <div style={{ marginBottom:10 }}>
      <label className="lbl f-sans">圃場の設備</label>
      <div style={{ display:"grid", gap:8, marginBottom:10 }}>
        {[["facility_parking","駐車場"],["facility_toilet","トイレ"],["facility_rest","休憩場所"]].map(([k, l]) => (
          <div key={k} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span className="f-sans" style={{ fontSize:14.3, color:"#111111", minWidth:72 }}>{l}</span>
            {["あり","なし"].map(opt => {
              const on = spec[k] === opt;
              return (
                <button key={opt} type="button" onClick={()=>setF(k, on ? "" : opt)} className="f-sans" style={{ padding:"7px 16px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
              );
            })}
          </div>
        ))}
      </div>
      <label className="lbl f-sans">貸与・提供できるもの（道具・機械・設備・消耗品）</label>
      {/* 登録簿（貸与機材ページ）からの呼び出し（2026-08-03たきと指示）：タップで選択＝
          この委託で貸与するものだけが spec.facility_lend（仕様書）に載る。旧案件の残置値もピルに出す */}
      {(() => {
        const sel = (spec.facility_lend || "").split("・").filter(Boolean);
        const all = [...new Set([...lendItems, ...sel])];
        if (!all.length) return (
          <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:0 }}>未登録（名刺タップ→貸与・提供ページで登録すると、ここで呼び出せます）</p>
        );
        const toggle = (it) => {
          const next = sel.includes(it) ? sel.filter(x => x !== it) : [...sel, it];
          setF("facility_lend", all.filter(x => next.includes(x)).join("・"));
        };
        // 区分ごとに並べる（登録簿の区分・旧データや残置値は「その他」へ）
        const groups = [...CONSIGN_LEND_KINDS.map(k => [k, all.filter(n => lendKindOf(n) === k)]),
          ["その他", all.filter(n => !CONSIGN_LEND_KINDS.includes(lendKindOf(n)))]].filter(([, l]) => l.length);
        return (<>
          {groups.map(([g, list]) => (
            <div key={g} style={{ marginBottom:8 }}>
              <p className="f-sans" style={{ fontSize:12.1, fontWeight:700, color:"#999999", margin:"0 0 4px" }}>{g}</p>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {list.map(it => {
                  const on = sel.includes(it);
                  return (
                    <button key={it} type="button" onClick={()=>toggle(it)} className="f-sans" style={{ padding:"9px 16px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{it}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"6px 0 0" }}>タップで選択。選んだものだけがこの委託の仕様書に載ります。登録の追加は名刺タップ→貸与機材ページで。</p>
        </>);
      })()}
    </div>
  );
  // ── 入力部品（案件ダッシュボード(deal)と新規ウィザード(new)で共用・2026-07-31）──
  const renderBasicField = (f) => (
            <div key={f.k} style={{ marginBottom:10 }}>
              {f.help ? (
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {helpBtn(f.k)}
                    <label className="lbl f-sans" style={{ marginBottom:0 }}>{f.l}</label>
                  </div>
                  {helpNote(f.k, f.help)}
                </div>
              ) : (
              <label className="lbl f-sans">{f.l}</label>
              )}
              {f.k === "pay_method" ? (
                <div style={{ display:"flex", gap:8 }}>
                  {["銀行振込", "現金"].map(opt => {
                    const on = spec.pay_method === opt;
                    return (
                      <button key={opt} type="button" onClick={()=>setF("pay_method", on ? "" : opt)} className="f-sans" style={{ padding:"9px 18px", fontSize:15.4, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                    );
                  })}
                </div>
              ) : f.k === "crop" ? (
                // ブロッコリー固定（入力不可）。この委託はブロッコリーのみ
                <div><span className="f-sans" style={{ display:"inline-block", padding:"9px 18px", fontSize:15.4, fontWeight:700, borderRadius:10, background:"#111111", color:"#fff" }}>{CONSIGN_CROP}</span></div>
              ) : f.k === "deadline" ? (
                // 履行期限＝開始+終了の日付範囲。同じ欄をタップでカレンダー展開（ブラック）
                <div>
                  <button type="button" onClick={()=>setShowDeadlineCal(v => !v)} className="field f-sans" style={{ width:"100%", textAlign:"left", fontSize:15.4, marginBottom:0, cursor:"pointer", background:"#fff", color: spec.date_start ? "#111111" : "#999999" }}>
                    {spec.date_start ? deadlineLabel(spec.date_start, spec.date_end) : "タップして期間を選択"}
                  </button>
                  {showDeadlineCal && (
                    <CalendarView accent="#111111" accentSoft="#EEEEEE" hideHints start={parseYmd(spec.date_start)} end={parseYmd(spec.date_end)} onSelect={onDeadlineSelect} />
                  )}
                  <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"6px 0 0" }}>1回目のタップで開始日、2回目で終了日。終了日を選ばなければ開始日のみ。</p>
                </div>
              ) : f.k === "task" ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {CONSIGN_TASKS.map(t => {
                    const sel = (spec.task ? spec.task.split("・").filter(Boolean) : []).includes(t);
                    return (
                      <button key={t} type="button" onClick={()=>{
                        const cur = spec.task ? spec.task.split("・").filter(Boolean) : [];
                        const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
                        setF("task", CONSIGN_TASKS.filter(x => next.includes(x)).join("・"));
                      }} className="f-sans" style={{ padding:"9px 18px", fontSize:15.4, fontWeight:700, borderRadius:10, cursor:"pointer", border: sel ? "2px solid #111111" : "1px solid #D0D0D0", background: sel ? "#111111" : "#fff", color: sel ? "#fff" : "#111111" }}>{t}</button>
                    );
                  })}
                </div>
              ) : (
                <input className="field f-sans" value={spec[f.k]} onChange={e=>setF(f.k, e.target.value)} placeholder={f.ph || ""} style={{ fontSize:15.4, marginBottom:0 }} />
              )}
            </div>
  );
  const renderTextField = (f) => (
            <div key={f.k} style={{ marginBottom:10 }}>
              {f.help ? (
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {helpBtn(f.k)}
                    <label className="lbl f-sans" style={{ marginBottom:0 }}>{f.l}</label>
                  </div>
                  {helpNote(f.k, f.help)}
                </div>
              ) : (
              <label className="lbl f-sans">{f.l}</label>
              )}
              <textarea className="field f-sans" value={spec[f.k]} onChange={e=>setF(f.k, e.target.value)} placeholder={f.ph} rows={3} style={{ fontSize:14.3, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
            </div>
  );
  const renderHazards = () => (
          <div style={{ marginBottom:10 }}>
            <label className="lbl f-sans">危険情報</label>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {CONSIGN_HAZARDS.map(h => {
                const on = (spec.hazards || []).includes(h);
                return (
                  <button key={h} type="button" onClick={()=>{
                    const cur = spec.hazards || [];
                    setF("hazards", cur.includes(h) ? cur.filter(x => x !== h) : [...cur, h]);
                  }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, textAlign:"left", padding:"10px 14px", fontSize:15.4, fontWeight:600, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>
                    <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13.2, fontWeight:800, border: on ? "none" : "2px solid #C8C8C8", background: on ? "#fff" : "transparent", color:"#111111" }}>{on ? "✓" : ""}</span>
                    {h}
                  </button>
                );
              })}
              {(spec.hazards || []).includes("その他") && (
                <input className="field f-sans" value={spec.hazard_other || ""} onChange={e=>setF("hazard_other", e.target.value)} placeholder="その他の危険（自由記述）" style={{ fontSize:14.3, marginBottom:0 }} />
              )}
            </div>
          </div>
  );
  const renderPhotos = () => (
          <div style={{ marginBottom:10 }}>
            <label className="lbl f-sans">写真（最低3枚）</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {(spec.photos || []).map((ph, i) => (
                <div key={i} style={{ position:"relative", width:96, height:96, borderRadius:10, overflow:"hidden", border:"1px solid #E5E5E5" }}>
                  <img loading="lazy" src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                  <button type="button" onClick={()=>removePhoto(i)} className="f-sans" style={{ position:"absolute", top:2, right:2, width:22, height:22, borderRadius:"50%", background:"rgba(0,0,0,0.6)", color:"#fff", border:"none", fontSize:15.4, lineHeight:1, cursor:"pointer" }}>×</button>
                </div>
              ))}
              <label className="f-sans" style={{ width:96, height:96, borderRadius:10, border:"1px dashed #B0B0B0", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor: photoUploading ? "default" : "pointer", fontSize:13.2, color:"#111111", gap:2 }}>
                {photoUploading ? <Dots /> : (<><span style={{ fontSize:24.2, lineHeight:1 }}>＋</span>写真</>)}
                <input type="file" accept="image/*" multiple onChange={e=>{ handlePhotoFiles(e.target.files); e.target.value=""; }} style={{ display:"none" }} disabled={photoUploading} />
              </label>
            </div>
            <p className="f-sans" style={{ fontSize:12.1, margin:"6px 0 0", color: (spec.photos || []).length >= 3 ? "#999999" : "#111111", fontWeight: (spec.photos || []).length >= 3 ? 400 : 700 }}>
              {(spec.photos || []).length}枚（掲載には最低3枚必要です）
            </p>
          </div>
  );

  if (printOpen) {
    return (
      <div className="cb-consign-page" style={{ maxWidth:760, margin:"0 auto", padding:"24px 16px 120px", paddingTop:"calc(24px + env(safe-area-inset-top, 0px))" }}>
        <div className="no-print" style={{ display:"flex", gap:8, marginBottom:16 }}>
          <button onClick={()=>setPrintOpen(false)} className="f-sans" style={{ padding:"9px 16px", fontSize:14.3, fontWeight:600, background:"#fff", color:"#111111", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻る</button>
          <button onClick={()=>window.print()} className="f-sans" style={{ padding:"9px 20px", fontSize:14.3, fontWeight:700, borderRadius:10, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>印刷する</button>
        </div>
        <div className="consign-print" style={{ background:"#fff", border:"1px solid #DDD", borderRadius:4, padding:"32px 28px", fontFamily:"serif", color:"#111" }}>
          <h1 className="f-sans" style={{ fontSize:24.2, fontWeight:800, textAlign:"center", margin:"0 0 4px" }}>農作業委託 仕様書</h1>
          <p className="f-sans" style={{ fontSize:12.1, color:"#666", textAlign:"center", margin:"0 0 20px" }}>chitose-bank 委託準備室</p>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14.3, marginBottom:18 }}>
            <tbody>
              {CONSIGN_BASIC_FIELDS.map(f => [f.l, spec[f.k]]).map(([l, v]) => (
                <tr key={l}>
                  <td style={{ border:"1px solid #999", padding:"7px 10px", width:170, background:"#F5F5F5", fontWeight:700 }}>{l}</td>
                  <td style={{ border:"1px solid #999", padding:"7px 10px" }}>{v || "　"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {CONSIGN_TEXT_FIELDS.map(f => (
            <div key={f.k} style={{ marginBottom:14 }}>
              <p className="f-sans" style={{ fontSize:14.3, fontWeight:700, margin:"0 0 4px" }}>■ {f.l}</p>
              <p style={{ fontSize:14.3, lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", border:"1px solid #999", padding:"8px 10px", minHeight:36 }}>{spec[f.k] || "　"}</p>
            </div>
          ))}
          <div style={{ marginBottom:14 }}>
            <p className="f-sans" style={{ fontSize:14.3, fontWeight:700, margin:"0 0 4px" }}>■ 危険情報</p>
            <p style={{ fontSize:14.3, lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", border:"1px solid #999", padding:"8px 10px", minHeight:36 }}>{(spec.hazards || []).length ? (spec.hazards || []).map(h => h === "その他" && spec.hazard_other ? "その他（" + spec.hazard_other + "）" : h).join("・") : "特になし"}</p>
          </div>
          {consignorPartyRows(consignor, consignAh).length > 0 && (
            <div style={{ marginBottom:14 }}>
              <p className="f-sans" style={{ fontSize:14.3, fontWeight:700, margin:"0 0 4px" }}>■ 委託者（発注者）</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14.3 }}>
                <tbody>
                  {consignorPartyRows(consignor, consignAh).map(([l, v]) => (
                    <tr key={l}>
                      <td style={{ border:"1px solid #999", padding:"7px 10px", width:170, background:"#F5F5F5", fontWeight:700 }}>{l}</td>
                      <td style={{ border:"1px solid #999", padding:"7px 10px" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop:18 }}>
            <p className="f-sans" style={{ fontSize:14.3, fontWeight:700, margin:"0 0 6px" }}>■ 定型条項（全仕様書共通）</p>
            {CONSIGN_FIXED_CLAUSES.map(c => (
              <p key={c} style={{ fontSize:13.2, lineHeight:1.9, margin:0 }}>・{c}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"cb-consign-page fade-in" + (leaving ? " consign-leaving" : "") + (returning ? " consign-returning" : "")} style={{ maxWidth:640, margin:"0 auto", padding:"24px 16px 120px", paddingTop:"calc(24px + env(safe-area-inset-top, 0px))" }}>
      {/* 委託機能利用特約：同意後は右上の浮遊ボックスからいつでも再読できる（2026-08-02たきと指示） */}
      {termsOk && !leaving && (
        <button type="button" onClick={()=>setTermsModal(true)} className="f-sans" style={{ position:"fixed", top:"calc(12px + env(safe-area-inset-top, 0px))", right:12, zIndex:60, background:"#111111", color:"#fff", border:"none", borderRadius:12, padding:"8px 12px", fontSize:12.1, fontWeight:800, cursor:"pointer", boxShadow:"0 2px 10px rgba(0,0,0,0.25)" }}>利用特約</button>
      )}
      {/* 委託⇄受託の切替トグル（2026-08-05たきと指示「求人求職の切り替えトグルと同じ構造」）。
          ProfileHubの浮遊トグルと同じ振る舞い：両面の入口でだけ出す／連打ガード／
          pflip-out(0.4s)→hash書き換え→pflip-in、そして切替【先】をラベルと見た目で予告する。
          色相は持ち込まない（ブラックの世界）ので、予告は濃淡で行う＝
          受託者へ行くボタンは白地に黒枠／委託主へ戻るボタンは黒ベタ。
          演出中（退場・帰還）は出さない＝画面が飛んでいる最中に押させない */}
      {(cTab === "list" || cTab === "contractor") && !leaving && !returning && (
        <button type="button" onClick={()=>{
          if (cAnim === "pflip-out") return; // 連打ガード
          setCAnim("pflip-out");
          setTimeout(()=>{
            window.location.hash = cTab === "contractor" ? "/admin/consignment" : "/admin/consignment/contractor";
            setCAnim("pflip-in");
          }, 400);
        }} className="consign-role-fab f-sans"
          style={ cTab === "contractor"
            ? { background:"#111111", color:"#FFFFFF", border:"2px solid #111111" }
            : { background:"#FFFFFF", color:"#111111", border:"2px solid #111111" }}>
          {cTab === "contractor" ? "⇄ 委託（出す側）に切替" : "⇄ 受託（受ける側）に切替"}
        </button>
      )}
      {termsModal && (
        <div onClick={()=>setTermsModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:70, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, maxWidth:560, width:"100%", maxHeight:"80vh", overflowY:"auto", padding:"20px 18px", boxSizing:"border-box" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 10px" }}>
              <h3 className="f-sans" style={{ fontSize:17.6, fontWeight:800, color:"#111111", margin:0 }}>委託機能を利用する前に</h3>
              {helpBtn("terms")}
            </div>
            {helpNote("terms", CONSIGN_TERMS_HELP)}
            <ConsignTermsBody />
            {consignor?.consignment_terms_consent_at && (
              <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"0 0 12px" }}>✓ 同意済み：{new Date(consignor.consignment_terms_consent_at).toLocaleString("ja-JP")}（{consignor.consignment_terms_consent_version}）</p>
            )}
            <button onClick={()=>setTermsModal(false)} className="f-sans" style={{ width:"100%", padding:"13px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>閉じる</button>
          </div>
        </div>
      )}
      {/* 背景の空（2026-07-31たきと指示）：朝昼夜の色＋太陽/月が時刻で左→右に移動。
          蔓より奥（z-index:-2）に敷く。上端から色が差し込み、下は透明に抜ける */}
      {cTab !== "new" && cTab !== "profile" && (
      <div className="consign-sky" aria-hidden="true" style={{ background: `linear-gradient(to bottom, ${sky.skyTop} 0%, rgba(255,255,255,0) 44%)` }}>
        {sky.isNight && skyStars.map((st, i) => (
          <span key={i} className="consign-star" style={{ left: st.x + "%", top: st.y + "%", width: st.s, height: st.s, animationDuration: st.dur + "s", animationDelay: "-" + st.delay + "s" }} />
        ))}
        <div className={"consign-sky-orb" + (sky.isNight ? " consign-sky-orb--moon" : "")} style={{ left: sky.left + "%", top: sky.top + "%", background: sky.isNight ? "transparent" : sky.orb,
          boxShadow: sky.isNight
            ? `0 0 16px 4px rgba(255,255,255,0.55), 0 0 60px 18px ${sky.glow}, 0 0 130px 46px rgba(185,205,255,0.28)`
            : `0 0 44px 12px ${sky.glow}` }}>
          {/* 月の欠け加減（実際の月齢を再現）：右半円＋明暗境界の楕円弧で照面だけを描く。
              上弦（満ちる側）は右が照り、下弦（欠ける側）は左右反転。新月付近は地球照のうっすら円盤だけ残る */}
          {sky.isNight && (() => {
            const ph = sky.moonPhase;
            const k = Math.cos(2 * Math.PI * ph);      // 1=新月・-1=満月
            const rx = (Math.abs(k) * 30).toFixed(2);  // 明暗境界（楕円）の横半径
            return (
              <svg viewBox="-32 -32 64 64" style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible" }}>
                <g transform={ph < 0.5 ? undefined : "scale(-1 1)"}>
                  <circle r="30" fill="rgba(232,236,245,0.28)" />
                  <path d={`M 0 -30 A 30 30 0 0 1 0 30 A ${rx} 30 0 0 ${k > 0 ? 0 : 1} 0 -30 Z`} fill={sky.orb} />
                </g>
              </svg>
            );
          })()}
        </div>
      </div>
      )}
      {/* 背景の環境：画面上端から垂れ下がる黒い草の蔓（2026-07-31たきと指示）。
          z-index:-1でページ内容の下に敷く（白いカードの裏に自然に隠れる）。ゆっくり揺れる */}
      {cTab !== "new" && cTab !== "profile" && (
      <div className="consign-vines" aria-hidden="true" style={{ "--sway-center": swayCenter, "--sway-amp": swayAmp }}>
        {vines.map((sp, i) => {
          const d = CONSIGN_VINES[sp.v];
          return (
            <svg key={i} viewBox="0 0 60 120" style={{ left: sp.x + "%", height: sp.h, width: sp.h / 2, animationDuration: (sp.dur / windMult).toFixed(2) + "s", animationDelay: "-" + sp.delay + "s" }}>
              <g transform={sp.flip ? "translate(60 0) scale(-1 1)" : undefined}>
                {d.stems.map((st, k) => (
                  <path key={k} d={st} fill="none" stroke="#D0D0D0" strokeWidth="2.4" strokeLinecap="round" />
                ))}
                {d.leaves.map(([x, y, a], k) => (
                  <ellipse key={k} rx="7" ry="3" fill="#D0D0D0" transform={`translate(${x} ${y}) rotate(${a})`} />
                ))}
              </g>
            </svg>
          );
        })}
      </div>
      )}
      {/* 四隅の蔓（2026-07-31たきと指示）：角を抱くように這う。左上の形を反転で4隅に配る。
          -6pxのはみ出し＝紙の外から蔓が入り込んでいる見え方。揺らさない（額縁は静かに） */}
      {cTab !== "new" && cTab !== "profile" && (
      <div className="consign-corners" aria-hidden="true">
        {[
          { pos: { top: -6, left: -6 },     tr: "" },
          { pos: { top: -6, right: -6 },    tr: "scaleX(-1)" },
          { pos: { bottom: -6, left: -6 },  tr: "scaleY(-1)" },
          { pos: { bottom: -6, right: -6 }, tr: "scale(-1,-1)" },
        ].map((cn, i) => (
          <svg key={i} viewBox="0 0 120 120" style={{ ...cn.pos, width: cornerSizes[i], height: cornerSizes[i], transform: cn.tr || undefined }}>
            {CONSIGN_CORNER_VINE.stems.map((st, k) => (
              <path key={k} d={st} fill="none" stroke="#D0D0D0" strokeWidth="2.4" strokeLinecap="round" />
            ))}
            {CONSIGN_CORNER_VINE.leaves.map(([x, y, a], k) => (
              <ellipse key={k} rx="6.5" ry="2.8" fill="#D0D0D0" transform={`translate(${x} ${y}) rotate(${a})`} />
            ))}
          </svg>
        ))}
      </div>
      )}
      {/* 入場演出：黒幕＋白線→草の群れが右→左→右と下から上へ→幕が上下に開いてフィールド展開。
          群れは所属する幕の中に描く＝幕が開くと群れごと退場する */}
      {entrance && (
        <div className="consign-entrance" aria-hidden="true">
          {["top", "bottom"].map(panel => (
            <div key={panel} className={"consign-entrance-" + panel}>
              {panel === "bottom" && <div className="consign-entrance-line" />}
              {entranceGrass.filter(c => c.panel === panel).map((c, ci) => (
                c.kind === "sun" ? (
                  // 白い太陽が爛々と輝く（2026-07-31たきと指示・花火とランダムで交互）。
                  // 円盤＋放射する光条（長短交互＝きらめき）＋脈打つ光輪(glow)。回転と脈動はCSS側。
                  // 上幕の中に居るので、幕が開くと太陽ごとスライド退場する（草と同じ片付け不要の仕組み）
                  <div key={ci} className="consign-sun" style={{ top: c.sunTop + "%", left: c.sunLeft + "%", width: c.sunSize, height: c.sunSize, marginLeft: -c.sunSize / 2, animationDelay: c.delay + "s" }}>
                    <div className="consign-sun-glow" />
                    <svg className="consign-sun-rays" viewBox="-100 -100 200 200">
                      {Array.from({ length: 16 }, (_, k) => {
                        const long = k % 2 === 0;
                        return <line key={k} x1="0" y1={long ? -58 : -54} x2="0" y2={long ? -97 : -80} stroke="#fff" strokeWidth={long ? 5 : 3.4} strokeLinecap="round" transform={`rotate(${k * 22.5})`} />;
                      })}
                    </svg>
                    <svg className="consign-sun-disc" viewBox="-100 -100 200 200">
                      <circle cx="0" cy="0" r="40" fill="#fff" />
                    </svg>
                  </div>
                ) : c.kind === "fireworks" ? (
                  // 花火（2026-08-03たきと指示「太陽の代わりに花火を打ち上げる・5〜7発」）。
                  // 1発＝尾が昇る→閃光→光条と粒が開く→消える。上幕の中に居るので、
                  // 幕が開くと花火ごとスライド退場する（草・太陽と同じ片付け不要の仕組み）
                  <div key={ci}>
                    {c.shells.map((sh, k) => {
                      const burstAt = (sh.delay + sh.riseDur).toFixed(2) + "s";
                      return (
                        <div key={k} className="consign-fw" style={{ left: sh.left + "%", top: sh.top + "%" }}>
                          <div className="consign-fw-trail" style={{ "--rise": sh.rise + "px", "--rise-dur": sh.riseDur + "s", animationDelay: sh.delay + "s" }} />
                          <div className="consign-fw-flash" style={{ width: sh.size, height: sh.size, animationDelay: burstAt }} />
                          <div className="consign-fw-burst" style={{ width: sh.size, height: sh.size, animationDelay: burstAt, animationDuration: sh.burstDur + "s" }}>
                            <svg viewBox="-100 -100 200 200" style={{ width:"100%", height:"100%" }}>
                              <g transform={`rotate(${sh.spin})`}>
                                {Array.from({ length: sh.rays }, (_, j) => {
                                  const long = j % 2 === 0;                    // 長短交互＝菊の花びらの粗密
                                  const tip = long ? -94 : -74;
                                  return (
                                    <g key={j} transform={`rotate(${(360 / sh.rays) * j})`}>
                                      <line x1="0" y1="-14" x2="0" y2={tip + 8} stroke="#fff" strokeWidth={long ? 3.2 : 2.2} strokeLinecap="round" opacity=".9" />
                                      <circle cx="0" cy={tip} r={long ? 4.2 : 3} fill="#fff" />
                                    </g>
                                  );
                                })}
                              </g>
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                <div key={ci} className="consign-entrance-cluster" style={c.pos}>
                  {c.sprigs.map((sp, i) => {
                    const d = CONSIGN_SPRIGS[sp.v];
                    return (
                      // 株は群れの帯の中に絶対配置（根元は端の側=右左の分離・2026-07-31たきと指示）。
                      // flip/tiltはsvg内の<g>で行う（外のtransformはscaleYの生えるアニメが上書きしてしまうため）
                      <svg key={i} viewBox="0 0 40 80" style={{ position: "absolute", bottom: sp.y, [c.anchor]: sp.x + "%", height: sp.h, width: sp.h / 2, animationDelay: (c.delay + sp.d).toFixed(2) + "s" }}>
                        <g transform={`${sp.flip ? "translate(40 0) scale(-1 1) " : ""}rotate(${sp.tilt} 20 80)`}>
                          <path d={d.stem} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
                          {d.leaves.map(([x, y, a], k) => (
                            <ellipse key={k} rx="6.4" ry="2.6" fill="#fff" transform={`translate(${x} ${y}) rotate(${a})`} />
                          ))}
                        </g>
                      </svg>
                    );
                  })}
                </div>
                )
              ))}
            </div>
          ))}
        </div>
      )}
      {/* トップ画=一覧（さがすページと同じ設計・2026-07-31たきと指示）：カードの一覧→タップで
          案件ダッシュボード(deal)へ。←戻る・見出し・入口カードは一覧側だけに出す */}
      {/* 委託⇄受託の2面（2026-08-05たきと指示）。key={cTab}で包む＝切替のたびに再マウントされ
          pflip-in/fade-inが再生される（ProfileHubのpTab切替と同じ作法）。
          .consign-list-content は両面に付ける＝退場・帰還演出のCSS（子孫セレクタ）がそのまま効く */}
      {(cTab === "list" || cTab === "contractor") && (
      <div key={cTab} className={cAnim || undefined} onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && cAnim === "pflip-in") setCAnim(""); }}>
      {cTab === "list" && (<div className="consign-list-content">
      {/* 管理ページの共通ナビ（全ページ導線・2026-08-02）。一覧側だけに出す（ウィザード・印刷は出さない） */}
      <AdminNav current="consignment" />
      {/* 戻り先は雇い手プロフィール入口（2026-07-31たきと指示・管理タブではない）：
          入口カード「新しく委託を出す」が置いてある場所へ帰る。ラベルも「← 戻る」に */}
      <button onClick={()=>{ window.location.hash = "/profile/employer"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 戻る</button>
      {/* 大プロフィールカード（農家プロフィール入口と同じ構造・2026-07-31たきと指示。カラーはブラック：
          緑2px枠→黒2px枠・役割ピル「農家」→「委託主」。反転⇄はプレビュー相当が無いので置かない） */}
      {/* 名刺タップで委託専用プロフィールページへ遷移（2026-07-31たきと指示・雇い手プロフィールではない） */}
      <button type="button" onClick={openProfile} className="f-sans" style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid #111111", borderRadius:24, padding:"28px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box", marginBottom:12, cursor:"pointer" }}>
        <Avatar url={empMini?.avatar_url} name={empMini?.nickname} size={84} bg="#111111" />
        <span style={{ textAlign:"center" }}>
          <span className="f-sans" style={{ display:"block", fontSize:24.2, fontWeight:800, color:"#111111" }}>{empMini?.nickname || "名称未設定"}</span>
          <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:14.3, fontWeight:800, color:"#fff", background:"#111111", borderRadius:20, padding:"3px 14px" }}>委託主</span>
        </span>
      </button>

      {/* 新しく委託を出す（2026-07-31たきと指示・農家の「新しく求人を出す」と同じワイドカード）。
          配色はブラック＝委託・受託の世界（求人・求職のオレンジ／ミドリとは分ける）。アイコンは置かない。
          管理者のみ：この部屋自体が admin ゲートの内側で、consignment_deals のRLSも app_admins 限定。
          行き先は新規委託ウィザード（#/admin/consignment/new・思考順5ステップ） */}
      <button onClick={newDeal} className="f-sans" style={{ position:"relative", overflow:"hidden", width:"100%", margin:"0 0 16px", background:"#111111", border:"none", borderRadius:20, padding:"20px 18px", cursor:"pointer", display:"block", textAlign:"left" }}>
        {/* カードの角を這う白い蔓（2026-07-31たきと指示）。文字はzIndexで蔓の上に */}
        <VineCorner flip size={110} style={{ top:-6, right:-6, opacity:0.5 }} />
        <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:17.6, fontWeight:800, color:"#fff", letterSpacing:".02em" }}>新しく委託を出す</span>
        <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:14.3, color:"#B9B9B9", marginTop:4, lineHeight:1.6 }}>5つのステップで掲載まで進みます。</span>
      </button>
      </div>)}

      {/* ═══ 受託面（#/admin/consignment/contractor・2026-08-05たきと指示）═══
          委託面（出す側）の対になる「受ける側」の面。並びは委託面と同じ＝共通ナビ／戻る／名刺／
          ワイドカード／一覧、で骨を揃える（1アカウントが両面を持つ世界でUIの骨が変わらない・
          求人求職のカード対称性と同じ理屈）。
          ★ここは読み取り専用＝DBへの書き込み・入力は一切置かない。受託者情報の登録と掲載板は
          CLAUDE.md「保存・入力機能の取り扱い」に従い、たきとの確認を取ってから別途実装する。
          表示にダミーは置かない（憲法3条）＝実データが無い箇所は「まだありません」と理由を明記する */}
      {cTab === "contractor" && (<div className="consign-list-content">
      <AdminNav current="consignment" />
      {/* 戻り先は委託面と同じ雇い手プロフィール入口＝「新しく委託を出す」カードが置いてある場所 */}
      <button onClick={()=>{ window.location.hash = "/profile/employer"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 戻る</button>
      {/* 名刺（受託者）。委託面の名刺と同じ寸法・同じ枠で、役割ピルだけ濃淡を反転させる
          （委託主＝黒ベタ／受託者＝白地に黒枠）。受託者情報の登録ページはまだ無いのでタップ先を
          持たせない＝押せるのに何も起きないボタンにしない（2026-08-03「タップ不能はやめよう」の裏返しで、
          行き先の無いボタンを作らない）。div＝表示カードとして置く */}
      <div className="f-sans" style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid #111111", borderRadius:24, padding:"28px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box", marginBottom:12 }}>
        <Avatar url={empMini?.avatar_url} name={empMini?.nickname} size={84} bg="#111111" />
        <span style={{ textAlign:"center" }}>
          <span className="f-sans" style={{ display:"block", fontSize:24.2, fontWeight:800, color:"#111111" }}>{empMini?.nickname || "名称未設定"}</span>
          <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:14.3, fontWeight:800, color:"#111111", background:"#fff", border:"2px solid #111111", borderRadius:20, padding:"3px 14px" }}>受託者</span>
        </span>
      </div>

      {/* 「委託をさがす」＝委託面の「新しく委託を出す」と対になるワイドカード。
          掲載板（受託者が委託を探す市場）は手動1件目のあとに判断する方針（2026-07-19記載）なので、
          機能・入力・保存を持たないプレースホルダーにし、タップで反転して理由を明記する
          （ProfileHubの「新しく求職を出す」＝届出待ちカードと同じ作法） */}
      <div style={{ perspective:800, marginBottom:16 }}>
        <button onClick={()=>setContractorFlip(v=>!v)} className="f-sans" aria-label="委託をさがす（準備中）" style={{
          position:"relative", width:"100%", background:"transparent", border:"none", padding:0, cursor:"pointer",
          transformStyle:"preserve-3d", transition:"transform .5s", transform: contractorFlip ? "rotateY(180deg)" : "none", textAlign:"left",
        }}>
          {/* 表面 */}
          <span style={{ position:"relative", overflow:"hidden", display:"block", background:"#111111", borderRadius:20, padding:"20px 18px", boxSizing:"border-box", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
            <VineCorner flip size={110} style={{ top:-6, right:-6, opacity:0.5 }} />
            <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:17.6, fontWeight:800, color:"#fff", letterSpacing:".02em" }}>委託をさがす</span>
            <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:14.3, color:"#B9B9B9", marginTop:4, lineHeight:1.6 }}>出されている委託から、受けられる仕事を探します。</span>
          </span>
          {/* 裏面（タップで反転） */}
          <span style={{ position:"absolute", inset:0, display:"block", background:"#fff", border:"2px solid #111111", borderRadius:20, padding:"20px 18px", boxSizing:"border-box", transform:"rotateY(180deg)", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
            <span className="f-sans" style={{ display:"block", fontSize:15.4, fontWeight:800, color:"#111111" }}>準備中です</span>
            <span className="f-sans" style={{ display:"block", fontSize:13.2, color:"#111111", marginTop:4, lineHeight:1.6 }}>委託の掲載板は、手で進める1件目を終えてから開きます。開いたら、ここから受けられる委託を探せるようになります。</span>
          </span>
        </button>
      </div>

      {/* 受託した委託の一覧（委託面の案件カード一覧と対になる枠）。
          consignment_deals に受託者の列はまだ無く、受託側の案件は1件も存在しない＝
          ダミーを並べず、空であることとその理由を書く */}
      <p className="f-sans" style={{ fontSize:12.1, color:"#999999", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid #111111", paddingLeft:8 }}>受託した委託</p>
      <div style={{ background:"#fff", border:"1px solid #E5E5E5", borderRadius:16, padding:"20px 18px" }}>
        <p className="f-sans" style={{ fontSize:14.3, fontWeight:800, color:"#111111", margin:"0 0 6px" }}>受託した委託はまだありません</p>
        <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:0, lineHeight:1.8 }}>委託を受けると、その案件がここに並びます。進み具合（合意・着手金・作業中・検収・支払）も、委託面と同じ段階でこの面から追えるようにします。</p>
      </div>
      </div>)}
      </div>
      )}

      {/* 委託者情報の設定ページ（#/admin/consignment/profile・2026-07-31たきと指示）。
          原則変更しない本人・事業者情報を入力し、案件作成（確認STEP5・印刷仕様書）に自動反映する。
          保存先は consignment_profiles の consignor_* 列（雇い手プロフィールとは独立） */}
      {/* プロフィール2面（2026-08-02たきと指示）：トップ＝委託者情報／スワイプ（またはチップ）で委託圃場 */}
      {cTab === "profile" && (
        <div className="fade-in"
          onTouchStart={e => { const t = e.touches[0]; profTouchRef.current = { x: t.clientX, y: t.clientY }; }}
          onTouchEnd={e => {
            const s0 = profTouchRef.current; profTouchRef.current = null;
            if (!s0) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - s0.x, dy = t.clientY - s0.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              const panes = ["info", "fields", "lend"];
              const i = panes.indexOf(profilePane);
              setProfilePane(panes[Math.min(panes.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)))]);
            }
          }}>
          <button onClick={()=>{ setCTab("list"); window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 委託一覧</button>
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[["info","委託者情報"],["fields","委託圃場"],["lend","貸与機材"]].map(([k, l]) => {
              const on = profilePane === k;
              return (
                <button key={k} type="button" onClick={()=>setProfilePane(k)} className="f-sans" style={{ padding:"9px 18px", fontSize:14.3, fontWeight:700, borderRadius:20, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{l}</button>
              );
            })}
          </div>
          {profilePane === "info" && <ConsignorInfoEdit />}
          {profilePane === "fields" && <ConsignFieldsPane fields={fields} onReload={loadFields} />}
          {profilePane === "lend" && <ConsignLendPane consignor={consignor} onSaved={(merged)=>{ setConsignor(merged); setCache("consign:consignor", merged); }} />}
        </div>
      )}

      {/* 委託機能利用特約（2026-08-02たきと指示）：「新しく委託を出す」タップ時に展開する初回ゲート。
          本文はたきと起草の文言そのまま。同意で consignment_terms_consent* に版数付きで記録 */}
      {cTab === "new" && !termsOk && (
        <div className="fade-in">
          <button onClick={()=>{ window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 戻る</button>
          <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 4px" }}>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:0 }}>委託機能を利用する前に</h2>
            {helpBtn("terms")}
          </div>
          {helpNote("terms", CONSIGN_TERMS_HELP)}
          <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 18px" }}>業務委託の契約に関する大切な確認です。はじめに特約をご確認ください。</p>
          <ConsignTermsBody />
          <button type="button" onClick={()=>setTermsChecked(v => !v)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"12px 14px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: termsChecked ? "2px solid #111111" : "1px solid #D0D0D0", background: termsChecked ? "#111111" : "#fff", color: termsChecked ? "#fff" : "#111111", marginBottom:12, lineHeight:1.7 }}>
            <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13.2, fontWeight:800, border: termsChecked ? "none" : "2px solid #C8C8C8", background: termsChecked ? "#fff" : "transparent", color:"#111111" }}>{termsChecked ? "✓" : ""}</span>
            {CONSIGN_TERMS_CHECK}
          </button>
          <button onClick={agreeTerms} disabled={termsSaving || !termsChecked} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor: termsChecked ? "pointer" : "not-allowed", opacity: (termsSaving || !termsChecked) ? 0.4 : 1 }}>{termsSaving ? <>記録中<Dots /></> : "同意して進む"}</button>
        </div>
      )}

      {/* ═══ 新規委託ウィザード（#/admin/consignment/new・2026-07-31たきと指示）═══
          「入力順」でなく「契約が成立するまでの思考順」＝受託者の頭の中
          （何やる？→できる？→いくら？→いつ？→危なくない？→応募）に合わせた5ステップ。
          1ページ1つの問い。入力部品は案件ダッシュボードと共用（renderBasicField等） */}
      {cTab === "new" && termsOk && (
        <div className="fade-in">
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <button onClick={()=>{ if (wizStep === 1) { window.location.hash = "/admin/consignment"; } else { setWizStep(v => v - 1); consignScrollTop(); } }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", flexShrink:0 }}>← 戻る</button>
            <span className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111" }}>{wizStep}/5　{CONSIGN_WIZ_STEPS[wizStep-1].t}</span>
          </div>
          {/* 進捗（5分割の黒バー） */}
          <div style={{ display:"flex", gap:4, marginBottom:18 }}>
            {CONSIGN_WIZ_STEPS.map((st, i) => (
              <div key={st.t} style={{ flex:1, height:4, borderRadius:2, background: i < wizStep ? "#111111" : "#E5E5E5" }} />
            ))}
          </div>
          {/* 1ページ1つの問い */}
          <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{CONSIGN_WIZ_STEPS[wizStep-1].q}</h2>
          <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 18px" }}>{CONSIGN_WIZ_STEPS[wizStep-1].d}</p>

          {/* STEP1 案件概要：何を頼むのか */}
          {wizStep === 1 && (<>
            {/* 登録済みの圃場の呼び出し（2026-08-02たきと指示）：タップで圃場名・地域・面積・設備を流し込む */}
            {fields.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <label className="lbl f-sans">登録済みの圃場から呼び出す</label>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {fields.map(f => {
                    const on = (spec.field_name || "").trim() === f.name;
                    return (
                      <button key={f.id} type="button" onClick={()=>applyField(f)} className="f-sans" style={{ padding:"9px 16px", fontSize:14.3, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{f.name}{f.area_a ? "（" + f.area_a + "a）" : ""}</button>
                    );
                  })}
                </div>
                <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"6px 0 0" }}>呼び出した内容は自由に書き換えられます。掲載するとこの圃場の登録内容も更新されます。</p>
              </div>
            )}
            {["crop","task","field_name","region","area_a"].map(k => renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === k)))}
            {renderPhotos()}
          </>)}
          {/* STEP2 作業仕様：どう終われば完了か（圃場設備は圃場登録時＝ここで案件ごとに設定） */}
          {wizStep === 2 && (<>
            {CONSIGN_TEXT_FIELDS.filter(f => f.k !== "special").map(renderTextField)}
            {renderFacilities()}
            {CONSIGN_TEXT_FIELDS.filter(f => f.k === "special").map(renderTextField)}
          </>)}
          {/* STEP3 報酬：いくら払うのか */}
          {wizStep === 3 && (<>
            {["unit_price_10a","advance","pay_method"].map(k => renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === k)))}
            {/* 報酬イメージ（単価×面積の自動計算・派生表示ので保存しない） */}
            {(() => { const u = Number(spec.unit_price_10a), a = Number(spec.area_a);
              return (u > 0 && a > 0) ? (
                <div style={{ background:"#111111", borderRadius:12, padding:"14px 16px", marginTop:4 }}>
                  <p className="f-sans" style={{ fontSize:12.1, color:"#B9B9B9", margin:"0 0 2px" }}>報酬イメージ（単価 × 面積{a}a）</p>
                  <p className="f-sans" style={{ fontSize:24.2, fontWeight:800, color:"#fff", margin:0 }}>約 {Math.round(u * a / 10).toLocaleString()}円</p>
                </div>
              ) : (
                <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"4px 0 0" }}>単価を入れると、面積（{spec.area_a ? spec.area_a + "a" : "未入力"}）から報酬イメージを自動計算します。</p>
              ); })()}
          </>)}
          {/* 標準取引条件（初回のみ・2026-07-31たきと指示）：委託者情報では聞かず、
              初めての掲載時にここで設定→掲載と同時に委託者情報(consignor_data)へ保存＝次回から出ない */}
          {wizStep === 3 && (() => {
            const cd = (consignor && consignor.consignor_data) || {};
            const STD = [
              { k:"cmn_pay_due",    l:"標準支払期限", ph:"例：検収後7日以内" },
              { k:"cmn_fee_bearer", l:"振込手数料の負担", sel:["委託者負担","受託者負担"], cashSkip:true },
              { k:"cmn_inspect",    l:"標準検収期間", ph:"例：作業完了から3日以内", help:"検収とは、作業が依頼どおり完了しているかを委託者（あなた）が確認して、合否を伝える手続きです。ここで決めた期間内に確認と連絡を行います。報酬の支払期限は、検収の完了を起点に数えるのが一般的です。" },
              { k:"cmn_cancel",     l:"標準キャンセル条件", ta:true, ph:"例：開始3日前までの通知は無償、以後は着手金を上限に精算", help:"委託を取りやめる場合のルールです。いつまでの連絡なら無償か、それ以降は着手金や実費をどう精算するかを、あらかじめ示しておくことで取りやめ時のトラブルを防ぎます。" },
            ].filter(f => !(cd[f.k] || "").trim() && !(f.cashSkip && spec.pay_method === "現金"));
            if (!STD.length) return null;
            return (
              <div style={{ marginTop:18 }}>
                <p className="f-sans" style={{ fontSize:14.3, fontWeight:800, color:"#111111", margin:"0 0 2px" }}>標準取引条件（初回のみ設定）</p>
                <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"0 0 10px" }}>今後の委託にも自動で適用されます。</p>
                {STD.map(f => (
                  <div key={f.k} style={{ marginBottom:10 }}>
                    {f.help ? (
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          {helpBtn(f.k)}
                          <label className="lbl f-sans" style={{ marginBottom:0 }}>{f.l}</label>
                        </div>
                        {helpNote(f.k, f.help)}
                      </div>
                    ) : (
                    <label className="lbl f-sans">{f.l}</label>
                    )}
                    {f.sel ? (
                      <div style={{ display:"flex", gap:8 }}>
                        {f.sel.map(opt => {
                          const on = (stdTerms[f.k] || "") === opt;
                          return (
                            <button key={opt} type="button" onClick={()=>setStdTerms(p2 => ({ ...p2, [f.k]: on ? "" : opt }))} className="f-sans" style={{ padding:"9px 18px", fontSize:15.4, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                          );
                        })}
                      </div>
                    ) : f.ta ? (
                      <textarea className="field f-sans" value={stdTerms[f.k] || ""} onChange={e=>setStdTerms(p2 => ({ ...p2, [f.k]: e.target.value }))} placeholder={f.ph || ""} rows={3} style={{ fontSize:14.3, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
                    ) : (
                      <input className="field f-sans" value={stdTerms[f.k] || ""} onChange={e=>setStdTerms(p2 => ({ ...p2, [f.k]: e.target.value }))} placeholder={f.ph || ""} style={{ fontSize:15.4, marginBottom:0 }} />
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          {/* STEP4 日程・安全：いつ・危険情報 */}
          {wizStep === 4 && (<>
            {renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === "deadline"))}
            {renderHazards()}
            {renderOnsiteContact()}
          </>)}
          {/* STEP5 確認・掲載：公開前チェック（プレビュー＋定型条項＋掲載） */}
          {wizStep === 5 && (<>
            {(spec.photos || []).length > 0 && (
              <div style={{ display:"flex", gap:6, overflowX:"auto", marginBottom:12 }}>
                {(spec.photos || []).map((ph, i) => (
                  <img loading="lazy" key={i} src={ph.url} alt="" style={{ width:84, height:84, objectFit:"cover", borderRadius:10, flexShrink:0, border:"1px solid #E5E5E5" }} />
                ))}
              </div>
            )}
            <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12, display:"grid", gap:8 }}>
              {[...CONSIGN_BASIC_FIELDS.map(f => [f.l, spec[f.k]]),
                ...CONSIGN_TEXT_FIELDS.map(f => [f.l, spec[f.k]]),
                ["圃場の設備", [["駐車場", spec.facility_parking], ["トイレ", spec.facility_toilet], ["休憩場所", spec.facility_rest]].filter(([, v]) => v).map(([l, v]) => l + v).join("・")],
                ["貸与・提供できるもの", spec.facility_lend],
                ["危険情報", (spec.hazards || []).map(h => h === "その他" && spec.hazard_other ? "その他（" + spec.hazard_other + "）" : h).join("・")],
                ["当日の現場連絡先", spec.onsite_contact_mode === "別の連絡先を使用" ? [spec.onsite_name, spec.onsite_phone].map(x => (x || "").trim()).filter(Boolean).join(" ") : "登録情報を使用"],
                ["写真", (spec.photos || []).length > 0 ? (spec.photos || []).length + "枚" : ""],
              ].map(([l, v]) => (
                <div key={l} style={{ display:"flex", gap:10 }}>
                  <span className="f-sans" style={{ fontSize:12.1, color:"#999999", minWidth:96, flexShrink:0 }}>{l}</span>
                  <span className="f-sans" style={{ fontSize:13.2, color: v ? "#111111" : "#C0C0C0", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{v || "未入力"}</span>
                </div>
              ))}
            </div>
            {/* 委託者情報（設定ページから自動反映・2026-07-31たきと指示。緊急連絡先・振込情報は内部用ので出さない） */}
            {consignorPartyRows(consignor, consignAh).length > 0 && (
              <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
                <p className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", margin:"0 0 8px" }}>委託者（設定ページから自動反映・種別で印字を出し分け）</p>
                <div style={{ display:"grid", gap:6 }}>
                  {consignorPartyRows(consignor, consignAh).map(([l, v]) => (
                    <div key={l} style={{ display:"flex", gap:10 }}>
                      <span className="f-sans" style={{ fontSize:12.1, color:"#999999", minWidth:96, flexShrink:0 }}>{l}</span>
                      <span className="f-sans" style={{ fontSize:13.2, color:"#111111", overflowWrap:"break-word", wordBreak:"break-word" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
              <p className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", margin:"0 0 6px" }}>定型条項（編集不可・全仕様書に印字）</p>
              {CONSIGN_FIXED_CLAUSES.map(c => (
                <p key={c} className="f-sans" style={{ fontSize:13.2, color:"#111111", lineHeight:1.8, margin:0 }}>・{c}</p>
              ))}
            </div>
          </>)}

          <div style={{ marginTop:20 }}>
            {wizStep < 5 ? (
              <button onClick={()=>{ setWizStep(v => v + 1); consignScrollTop(); }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>次へ →</button>
            ) : (
              <button onClick={async ()=>{ const ok = await save(); if (ok) { await saveStdTerms(); window.location.hash = "/admin/consignment"; } }} disabled={saving} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: saving ? 0.6 : 1 }}>{saving ? <>掲載中<Dots /></> : "掲載する（募集を開始）"}</button>
            )}
          </div>
        </div>
      )}

      {cTab === "deal" && (
        <div className="fade-in">
          {/* ダッシュボードの戻り＝一覧へ（さがすの詳細→一覧と同じ動線）。一覧は開き直しで最新化 */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <button onClick={()=>{ window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:13.2, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px" }}>← 一覧</button>
            <span className="f-sans" style={{ fontSize:14.3, fontWeight:700, color:"#111111", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{editId ? ((spec.field_name || "（圃場未記入）") + "　" + [spec.crop, spec.task].filter(Boolean).join(" ")) : "新しい委託"}</span>
          </div>

          {/* ── 全行程の進行（保存済みの案件のみ）：ステッパー＋現在の状態に応じたアクション ── */}
          {editId && curDeal && (
            <div style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", marginBottom:16, background:"#fff" }}>
              <ConsignStepper deal={curDeal} />

              {/* 合意（下書き→合意）：仕様書を凍結 */}
              {curDeal.status === "draft" && (
                <button onClick={makeAgreed} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:15.4, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{busy ? "..." : "合意にする（仕様書を凍結）"}</button>
              )}

              {/* 合意時の仕様書（凍結・契約記録と同じ方式） */}
              {curDeal.spec_snapshot && (
                <details style={{ marginTop: curDeal.status === "draft" ? 12 : 0 }}>
                  <summary className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", cursor:"pointer" }}>合意時の仕様書（凍結・{snapAtLabel}）</summary>
                  <div style={{ marginTop:10, background:"#FAFAFA", border:"1px solid #E5E5E5", borderRadius:10, padding:"10px 12px", display:"grid", gap:6 }}>
                    {[...CONSIGN_BASIC_FIELDS, ...CONSIGN_TEXT_FIELDS].map(f => {
                      const v = (curDeal.spec_snapshot || {})[f.k];
                      return v ? (
                        <div key={f.k} style={{ display:"flex", gap:10 }}>
                          <span className="f-sans" style={{ fontSize:12.1, color:"#999999", minWidth:96, flexShrink:0 }}>{f.l}</span>
                          <span className="f-sans" style={{ fontSize:13.2, color:"#111111", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{v}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                  {changedAfterAgree && (
                    <p className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", margin:"8px 0 0" }}>※ 合意後の変更あり（上のフォームは凍結内容と異なります）</p>
                  )}
                </details>
              )}

              {/* 前金：deposit入力済みなら受領ボタン（合意〜作業前） */}
              {(curDeal.status === "agreed") && hasDeposit && (
                <div style={{ marginTop:12 }}>
                  {curDeal.spec?.deposit_received_at ? (
                    <p className="f-sans" style={{ fontSize:14.3, fontWeight:700, color:"#111111", margin:0 }}>✓ 着手金 受領済み（{curDeal.spec.deposit_received_at}）</p>
                  ) : (
                    <button onClick={receiveDeposit} disabled={busy} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:14.3, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>着手金を受領した（{Number(spec.advance).toLocaleString()}円）</button>
                  )}
                </div>
              )}

              {/* 作業を開始（合意→作業中） */}
              {curDeal.status === "agreed" && (
                <button onClick={startWork} disabled={busy} className="f-sans" style={{ width:"100%", marginTop:12, padding:"12px", fontSize:15.4, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>作業を開始する（作業中にする）</button>
              )}

              {/* 検収（作業中→検収済） */}
              {curDeal.status === "working" && (
                <div style={{ marginTop:12 }}>
                  <input className="field f-sans" value={inspectNote} onChange={e=>setInspectNote(e.target.value)} placeholder="検収メモ（任意・基準の可否など）" style={{ fontSize:14.3, marginBottom:8 }} />
                  <button onClick={doInspect} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:15.4, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>✓ 検収した</button>
                </div>
              )}

              {/* 支払（検収済→支払済） */}
              {curDeal.status === "inspected" && (
                <button onClick={doPay} disabled={busy} className="f-sans" style={{ width:"100%", marginTop:12, padding:"12px", fontSize:15.4, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>残金を支払った</button>
              )}

              {/* 完了（支払済→完了）＋振り返り */}
              {curDeal.status === "paid" && (
                <div style={{ marginTop:12 }}>
                  <textarea className="field f-sans" value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="振り返りメモ（次回への気づき・任意）" rows={2} style={{ fontSize:14.3, marginBottom:8, resize:"vertical" }} />
                  <button onClick={doComplete} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:15.4, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>完了にする</button>
                </div>
              )}
              {curDeal.status === "done" && (
                <p className="f-sans" style={{ fontSize:14.3, fontWeight:700, color:"#111111", margin:0, textAlign:"center" }}>この委託は完了しています{curDeal.spec?.reflection ? "" : ""}</p>
              )}
              {curDeal.status === "done" && curDeal.spec?.reflection && (
                <p className="f-sans" style={{ fontSize:13.2, color:"#111111", margin:"8px 0 0", whiteSpace:"pre-wrap" }}>振り返り：{curDeal.spec.reflection}</p>
              )}
            </div>
          )}

          {/* ── 日次進捗（作業中以降）：履行サマリー＋1行フォーム＋日別一覧 ── */}
          {editId && curDeal && ["working","inspected","paid","done"].includes(curDeal.status) && (
            <div style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", marginBottom:16, background:"#fff" }}>
              <p className="f-sans" style={{ fontSize:14.3, fontWeight:800, color:"#111111", margin:"0 0 10px" }}>日次進捗</p>
              {summary && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                  {[
                    ["実働合計", summary.total_hours != null ? `${summary.total_hours}h` : "—"],
                    ["稼働日数", `${summary.work_days ?? 0}日`],
                    ["延べ人数", `${summary.total_workers ?? 0}人`],
                    ["収量", `${summary.total_boxes ?? 0}箱`],
                    ["10aあたり", summary.hours_per_10a != null ? `${summary.hours_per_10a}h` : "—"],
                  ].map(([l, v]) => (
                    <div key={l} style={{ flex:"1 0 30%", background:"#F7F7F7", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                      <span className="f-sans" style={{ display:"block", fontSize:11, color:"#B0B0B0" }}>{l}</span>
                      <span className="f-sans" style={{ display:"block", fontSize:15.4, fontWeight:800, color:"#111111" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {curDeal.status === "working" && (
                <div style={{ background:"#F9FAFB", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                  {/* minmax(0,1fr)＝グリッドの子がトラック幅より小さくなれる（既定の 1fr は min-width:auto ので
                      input[type=date] の固有幅がトラックを超えると縮まず枠外へ出る・2026-08-16 打刻シートと同型） */}
                  <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:8, marginBottom:8 }}>
                    <div style={{ minWidth:0 }}><label className="lbl f-sans" style={{ fontSize:12.1 }}>日付</label><input type="date" className="field f-sans" value={pForm.work_date} onChange={e=>setPForm(p=>({...p, work_date:e.target.value}))} style={{ fontSize:14.3, marginBottom:0, width:"100%", maxWidth:"100%", minWidth:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:12.1 }}>実働時間(h)</label><input inputMode="decimal" className="field f-sans" value={pForm.hours} onChange={e=>setPForm(p=>({...p, hours:e.target.value.replace(/[^0-9.]/g,"")}))} placeholder="例：6.5" style={{ fontSize:14.3, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:12.1 }}>人数</label><input inputMode="numeric" className="field f-sans" value={pForm.workers} onChange={e=>setPForm(p=>({...p, workers:e.target.value.replace(/[^0-9]/g,"")}))} placeholder="例：3" style={{ fontSize:14.3, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:12.1 }}>収量（箱）</label><input inputMode="numeric" className="field f-sans" value={pForm.yield_boxes} onChange={e=>setPForm(p=>({...p, yield_boxes:e.target.value.replace(/[^0-9]/g,"")}))} placeholder="例：40" style={{ fontSize:14.3, marginBottom:0 }} /></div>
                  </div>
                  <input className="field f-sans" value={pForm.note} onChange={e=>setPForm(p=>({...p, note:e.target.value}))} placeholder="メモ（任意）" style={{ fontSize:14.3, marginBottom:8 }} />
                  <button onClick={addProgress} disabled={busy} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:14.3, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>＋ 進捗を記録</button>
                </div>
              )}
              {prog.length === 0 ? (
                <p className="f-sans" style={{ fontSize:13.2, color:"#B0B0B0", textAlign:"center", padding:"12px 0", margin:0 }}>日次の記録はまだありません</p>
              ) : (
                <div style={{ display:"grid", gap:6 }}>
                  {prog.map(r => (
                    <div key={r.id} style={{ display:"flex", gap:10, alignItems:"baseline", borderBottom:"1px solid #F7F7F7", paddingBottom:6 }}>
                      <span className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", minWidth:78, flexShrink:0 }}>{r.work_date}</span>
                      <span className="f-sans" style={{ fontSize:13.2, color:"#111111", flex:1, minWidth:0 }}>
                        {[r.hours != null ? `${r.hours}h` : null, r.workers != null ? `${r.workers}人` : null, r.yield_boxes != null ? `${r.yield_boxes}箱` : null].filter(Boolean).join("・")}
                        {r.note ? `　${r.note}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {CONSIGN_BASIC_FIELDS.map(renderBasicField)}
          {/* 検収基準・圃場条件（特約は危険情報の後・掲載順どおり） */}
          {CONSIGN_TEXT_FIELDS.filter(f => f.k !== "special").map(renderTextField)}
          {renderFacilities()}
          {/* 危険情報（チェック式・その他は自由記述を展開） */}
          {renderHazards()}
          {renderOnsiteContact()}
          {/* 写真（最低3枚・掲載の顔。consignment-photos バケット） */}
          {renderPhotos()}
          {/* 特約（掲載順の最後） */}
          {CONSIGN_TEXT_FIELDS.filter(f => f.k === "special").map(renderTextField)}
          <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", margin:"14px 0" }}>
            <p className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#111111", margin:"0 0 6px" }}>定型条項（編集不可・全仕様書に印字）</p>
            {CONSIGN_FIXED_CLAUSES.map(c => (
              <p key={c} className="f-sans" style={{ fontSize:13.2, color:"#111111", lineHeight:1.8, margin:0 }}>・{c}</p>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <label className="lbl f-sans">状態（手動上書き・通常は上のボタンで進める）</label>
              <select className="field f-sans" value={status} onChange={e=>setStatus(e.target.value)} style={{ fontSize:14.3, marginBottom:0 }}>
                {CONSIGN_STATUS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label className="lbl f-sans">メモ（内部用・仕様書には印字されない）</label>
            <textarea className="field f-sans" value={memo} onChange={e=>setMemo(e.target.value)} rows={2} style={{ fontSize:14.3, marginBottom:0, resize:"vertical" }} />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={save} disabled={saving} className="f-sans" style={{ flex:1, padding:"13px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: saving ? 0.6 : 1 }}>{saving ? <>保存中<Dots /></> : (editId ? "更新を保存" : "保存")}</button>
            <button onClick={()=>setPrintOpen(true)} className="f-sans" style={{ flex:1, padding:"13px", fontSize:15.4, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #222", borderRadius:12, cursor:"pointer" }}>印刷ビュー</button>
          </div>
        </div>
      )}

      {cTab === "list" && (
        <div className="fade-in consign-list-content">
          {deals.length === 0 ? (
            <p className="f-sans" style={{ fontSize:14.3, color:"#111111", textAlign:"center", padding:"32px 0" }}>まだ委託がありません。「新しく委託を出す」から始めましょう。</p>
          ) : (
          // さがす一覧と同じ構造（2026-08-03たきと指示）：枠なしカード・大きな角丸写真・
          // 写真の下にタイトル/地域/金額の3秒判断レイアウト（JobCardの型・カラーはブラック）。
          // 進行ステッパー・履行集計は管理情報のでカードから外し、タップ先の案件ページが担う
          // 列はminmax(0,1fr)固定（2026-08-03横はみ出し修理）：gridの既定min-width:autoだと
          // 1行省略のタイトルが列を押し広げ、画面幅を飛び出す
          <div style={{ display:"grid", gap:22, gridTemplateColumns:"minmax(0, 1fr)" }}>
          {deals.map(d => {
            const s = d.spec || {};
            const st = consignRecruitState(d.status);
            const photo = s.photos && s.photos[0] && s.photos[0].url;
            const dateChip = deadlineLabel(s.date_start, s.date_end) || s.deadline || "";
            return (
              <button key={d.id} onClick={()=>openDeal(d)} className="f-sans" style={{ display:"block", width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:0, textAlign:"left", cursor:"pointer", background:"transparent", border:"none", position:"relative", overflow:"hidden", borderRadius:16 }}>
                {/* 状態帯（募集中/募集終了/作業中/完了）＝写真左上 */}
                <span className="f-sans" style={{ position:"absolute", top:10, left:10, zIndex:2, padding:"4px 12px", borderRadius:8, fontSize:12.1, fontWeight:800, background:st.bg, color:st.fg, boxShadow:"0 1px 4px rgba(0,0,0,.18)" }}>{st.l}</span>
                {/* 履行期限チップ＝写真右下（さがすの開始日チップと同じ位置） */}
                {dateChip && (
                  <span className="f-sans" style={{ position:"absolute", top:186, right:8, zIndex:2, padding:"4px 10px", borderRadius:20, background:"rgba(255,255,255,0.92)", color:"#222", fontSize:12.1, fontWeight:700, boxShadow:"0 1px 4px rgba(0,0,0,.18)" }}>{dateChip}</span>
                )}
                {photo ? (
                  <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:220, objectFit:"cover", display:"block", borderRadius:16 }} />
                ) : (
                  <div style={{ width:"100%", height:220, borderRadius:16, background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center" }} />
                )}
                <div style={{ padding:"12px 4px 0" }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:4 }}>
                    <p className="f-sans" style={{ fontSize:17.6, fontWeight:600, color:"#222", margin:0, flex:"1 1 auto", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {s.field_name || "（圃場未記入）"}　{[s.crop, s.task].filter(Boolean).join(" ")}
                    </p>
                    <span className="f-sans" style={{ fontSize:12.1, color:"#B0B0B0", flexShrink:0, whiteSpace:"nowrap" }}>{s.region}</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:8 }}>
                    <p className="f-mono" style={{ fontSize:16.5, fontWeight:700, color:"#111111", margin:0 }}>
                      {s.unit_price_10a ? Number(s.unit_price_10a).toLocaleString() + "円/10a" : "単価未設定"}
                    </p>
                    {s.area_a && <span className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#717171", flexShrink:0 }}>{s.area_a}a</span>}
                  </div>
                  {(s.hazards || []).length > 0 && (
                    <div style={{ display:"flex", gap:4, marginTop:4, flexWrap:"wrap" }}>
                      {(s.hazards || []).map(h => (
                        <span key={h} className="f-sans" style={{ fontSize:12.1, fontWeight:700, color:"#111111", background:"#F0F0F0", padding:"2px 10px", borderRadius:20 }}>{h === "その他" && s.hazard_other ? "その他（" + s.hazard_other + "）" : h}</span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
