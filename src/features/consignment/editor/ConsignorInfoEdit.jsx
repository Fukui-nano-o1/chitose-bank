// 委託者情報の設定フロー（ブラック・アイコンなし・1ページ1つの問い）。
// 第2次構造改革2026-08-17で ConsignmentRoom.jsx から分離・中身は不変。
// ★KYC（氏名・住所・電話・銀行口座）を扱う編集画面。開示範囲の正は model.js の
//   CONSIGNOR_DISCLOSURE_STAGES と CONSIGNOR_IDENTITY_KEYS＝ここで別解を作らない。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { zipLookup } from "../../../lib/zipLookup";
import { Dots } from "../../../components/ui";
import { CORP_KINDS, CONSIGNOR_IND_FIELDS, CONSIGNOR_CORP_FIELDS, corpNoCheckOk, consignorPartyRows,
  CONSIGNOR_CONSENT_VERSION, CONSIGNOR_CONSENT_TEXT, CONSIGNOR_DISCLOSURE_STAGES, seedConsignorData,
  stripConsignorIdentity, consignScrollTop } from "../model";

// 委託者情報の設定フロー（ブラック・アイコンなし・1ページ1つの問い）
export function ConsignorInfoEdit() {
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
        <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 16px" }}>新規登録の情報（唯一の正）を修正します。保存すると委託者情報にも反映されます。区分（個人事業者／法人）はここでは変更できません。</p>
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
