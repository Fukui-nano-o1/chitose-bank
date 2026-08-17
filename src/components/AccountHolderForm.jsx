// 分割3-B（2026-07-25）：App.jsxから移動。新規登録①（本人確認・口座名義人情報）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { zipLookup } from "../lib/zipLookup";
import { C, THIS_YEAR, TERMS_VERSION, PRIVACY_VERSION } from "../lib/utils";
import { Dots } from "./ui";

// ── AccountHolderForm — 新規登録①（本人確認・口座名義人情報）────
// 送信は届出完了までADMIN_EMAIL限定。一般ユーザーはボタン無効「準備中」表示（RLS側もadmin限定で二重ゲート）
export function AccountHolderForm({ onDone, onSessionExpired, onShowTerms, onShowPrivacy }) {
  const [sess, setSess] = useState(undefined); // undefined=確認中 / null=未ログイン
  const [fullName, setFullName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressAuto, setAddressAuto] = useState("");   // 郵便番号検索で埋まる部分
  const [addressDetail, setAddressDetail] = useState(""); // 番地・建物名(手入力)
  const [apiAddress, setApiAddress] = useState("");       // 郵便番号検索で返ったAPI住所(都道府県+市区町村)。addressAutoとの前方一致照合用
  const [apiAddressZip, setApiAddressZip] = useState(""); // apiAddressが対応する郵便番号(7桁)。postalCode変更後の未再検索を検知するガード
  const [zipSearching, setZipSearching] = useState(false);
  const [zipError, setZipError] = useState("");
  const [entityType, setEntityType] = useState("individual");
  const [companyName, setCompanyName] = useState("");
  const [companyNumber, setCompanyNumber] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSess(session ?? null));
  }, []);

  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
  const yearOptions = []; for (let y = THIS_YEAR - 18; y >= 1930; y--) yearOptions.push(y);
  const daysInMonth = (birthYear && birthMonth) ? new Date(Number(birthYear), Number(birthMonth), 0).getDate() : 31;
  const birthDateStr = (birthYear && birthMonth && birthDay)
    ? `${birthYear}-${String(birthMonth).padStart(2,'0')}-${String(birthDay).padStart(2,'0')}`
    : "";
  const isAdult = !!birthDateStr && new Date(birthDateStr) <= cutoff;

  // 住所バリデーション（入力チェックのみ・account_holdersの構造やinsertには関与しない）
  const ALPHABET_RE = /[a-zA-Zａ-ｚＡ-Ｚ]/;
  const addressAutoHasAlphabet = ALPHABET_RE.test(addressAuto);
  const addressDetailHasAlphabet = ALPHABET_RE.test(addressDetail);
  const missingPrefectureWord = !!addressAuto.trim() && !/[都道府県]/.test(addressAuto);
  const missingCityWord = !!addressAuto.trim() && !/[市区町村]/.test(addressAuto);
  const zipDigits = postalCode.replace(/[^0-9]/g, "");
  const zipNotSevenDigits = !!postalCode.trim() && zipDigits.length !== 7;
  // 郵便番号と住所の前方一致検証。apiAddressZipが現在のzipDigitsと食い違う場合は
  // 郵便番号変更後の未再検索とみなし未検証扱い（=不一致エラー）にする
  const zipAddressVerified = zipDigits.length === 7 && apiAddressZip === zipDigits
    && !!apiAddress.trim() && addressAuto.startsWith(apiAddress);
  const zipAddressMismatch = !!addressAuto.trim() && zipDigits.length === 7 && !zipAddressVerified;

  const [isAllowed, setIsAllowed] = useState(null);  // null=判定中
  useEffect(() => {
    let cancelled = false;
    if (!sess?.user) { setIsAllowed(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase.rpc('am_i_account_allowed');
        if (!cancelled) setIsAllowed(error ? false : !!data);
      } catch { if (!cancelled) setIsAllowed(false); }
    })();
    return () => { cancelled = true; };
  }, [sess?.user?.id]);
  const formValid = !!(fullName.trim() && isAdult && postalCode.trim() && addressAuto.trim() && addressDetail.trim()
    && entityType && (entityType === "individual" || (companyName.trim() && companyNumber.trim())) && agreed
    && !addressAutoHasAlphabet && !addressDetailHasAlphabet && !missingPrefectureWord && !missingCityWord
    && zipDigits.length === 7 && !zipAddressMismatch);
  const canSubmit = isAllowed === true && formValid;

  // ① 非公開情報(送達先)用の住所検索。求人フローsearchZip(②公開情報)とは
  // 情報の層が異なるため意図的に分離。共通化しない。
  // 通信部のみ共通のzipLookup（2系統レース＋タイムアウト＋キャッシュ・2026-08-02「数十秒」対策）
  const searchAccountZip = async () => {
    const zip = postalCode.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipSearching(true); setZipError("");
    const r = await zipLookup(zip);
    if (r.ok) {
      const full = (r.prefecture || "") + (r.city || "");
      setAddressAuto(full);
      setApiAddress(full);
      setApiAddressZip(zip);
      setZipError("");
    } else {
      setZipError(r.reason === "notfound" ? "郵便番号が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
    }
    setZipSearching(false);
  };

  const submit = async () => {
    if (!canSubmit || !sess) return;
    setBusy(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBusy(false);
      if (onSessionExpired) onSessionExpired();
      else window.location.hash = "/login";
      return;
    }
    const { error } = await supabase.from("account_holders").insert({
      auth_id: session.user.id,
      full_name: fullName.trim(),
      birth_date: birthDateStr,
      postal_code: postalCode.trim(),
      address: (addressAuto.trim() + " " + addressDetail.trim()).trim(),
      entity_type: entityType,
      company_name: entityType === "corporate" ? companyName.trim() : null,
      company_number: entityType === "corporate" ? companyNumber.trim() : null,
      contact_email: session.user.email || null,
      contact_phone: session.user.phone || null,
      agreed_terms_version: TERMS_VERSION,
      agreed_privacy_version: PRIVACY_VERSION,
    });
    setBusy(false);
    if (error) { setErr("登録に失敗しました：" + error.message); return; }
    onDone();
  };

  if (sess === undefined) return <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:13,color:"#B0B0B0"}}>確認中…</p></div>;

  return (
    <div className="fade-in" style={{ minHeight:"80vh", padding:"28px 24px 64px" }}>
      <div style={{ width:"100%", maxWidth:"100%", margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:36, marginBottom:12 }}>📝</div>
          <div className="f-sans" style={{ fontSize:20, fontWeight:700, color:C.ink }}>新規登録：本人情報の入力</div>
          <p className="f-sans" style={{ fontSize:11, color:C.dim, marginTop:6 }}>ご利用のために、登録情報をご入力ください</p>
        </div>

        <div className="ledger-card" style={{ padding:28, display:"grid", gap:28 }}>
          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:10 }}>区分</div>
            <div style={{ display:"flex", gap:8 }}>
              <button type="button" onClick={()=>{ setEntityType("individual"); setCompanyName(""); setCompanyNumber(""); }} className="f-sans" style={{
                flex:1, padding:"10px 0", borderRadius:8,
                border: entityType==="individual" ? `2px solid ${C.bamboo}` : "1px solid #DADADA",
                background: entityType==="individual" ? C.bambooPl : "#fff",
                color: entityType==="individual" ? C.bamboo : "#717171",
                fontSize:13, fontWeight:700, cursor:"pointer",
              }}>個人</button>
              <button type="button" onClick={()=>setEntityType("corporate")} className="f-sans" style={{
                flex:1, padding:"10px 0", borderRadius:8,
                border: entityType==="corporate" ? `2px solid ${C.bamboo}` : "1px solid #DADADA",
                background: entityType==="corporate" ? C.bambooPl : "#fff",
                color: entityType==="corporate" ? C.bamboo : "#717171",
                fontSize:13, fontWeight:700, cursor:"pointer",
              }}>法人</button>
            </div>
          </div>

          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:14 }}>本人情報</div>
            <div style={{ marginBottom:16 }}>
              <label className="lbl f-sans">{entityType==="corporate" ? "代表者氏名" : "氏名"}</label>
              <input className="field f-sans" type="text" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="山田 太郎" />
            </div>
            {entityType === "corporate" && (
              <div className="fade-in" style={{ marginBottom:16 }}>
                <label className="lbl f-sans">法人名</label>
                <input className="field f-sans" type="text" value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="株式会社〇〇" />
              </div>
            )}
            {entityType === "corporate" && (
              <div className="fade-in" style={{ marginBottom:16 }}>
                <label className="lbl f-sans">法人番号</label>
                <input className="field f-sans" type="text" value={companyNumber} onChange={e=>setCompanyNumber(e.target.value)} placeholder="1234567890123（13桁）" />
                <p className="f-sans" style={{ marginTop:6, fontSize:11, color:"#717171" }}>国税庁の法人番号13桁</p>
              </div>
            )}
            <div>
              <label className="lbl f-sans">生年月日</label>
              <p className="f-sans" style={{ marginTop:0, marginBottom:6, fontSize:11, color:"#717171" }}>18歳未満は登録できません</p>
              <div style={{ display:"flex", gap:8 }}>
                <select className="field f-sans" style={{ flex:1.3 }} value={birthYear} onChange={e=>{
                  const y = e.target.value; setBirthYear(y);
                  if (y && birthMonth) { const dim = new Date(Number(y), Number(birthMonth), 0).getDate(); if (Number(birthDay) > dim) setBirthDay(""); }
                }}>
                  <option value="">年</option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select className="field f-sans" style={{ flex:1 }} value={birthMonth} onChange={e=>{
                  const m = e.target.value; setBirthMonth(m);
                  if (birthYear && m) { const dim = new Date(Number(birthYear), Number(m), 0).getDate(); if (Number(birthDay) > dim) setBirthDay(""); }
                }}>
                  <option value="">月</option>
                  {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="field f-sans" style={{ flex:1 }} value={birthDay} onChange={e=>setBirthDay(e.target.value)}>
                  <option value="">日</option>
                  {Array.from({length:daysInMonth},(_,i)=>i+1).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {birthDateStr && !isAdult && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>18歳未満はご登録いただけません</p>}
            </div>
          </div>

          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:14 }}>送達先</div>
            <div style={{ marginBottom:16 }}>
              <label className="lbl f-sans">郵便番号</label>
              <div style={{ display:"flex", gap:8 }}>
                <input className="field f-sans" type="text" value={postalCode} onChange={e=>setPostalCode(e.target.value)} placeholder="7790000" style={{ flex:1 }} />
                <button type="button" onClick={searchAccountZip} disabled={zipSearching} className="f-sans" style={{
                  padding:"0 16px", borderRadius:8, border:"1px solid #DADADA",
                  background:"#fff", color:"#222", fontSize:13, fontWeight:600,
                  cursor: zipSearching ? "default" : "pointer", whiteSpace:"nowrap",
                }}>{zipSearching ? <>検索中<Dots /></> : "住所を検索"}</button>
              </div>
              {zipError && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>{zipError}</p>}
              {!zipError && zipNotSevenDigits && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>郵便番号は7桁で入力してください</p>}
            </div>
            <div style={{ marginBottom:16 }}>
              <label className="lbl f-sans">{entityType==="corporate" ? "本店所在地" : "住所"}</label>
              <input className="field f-sans" type="text" value={addressAuto} onChange={e=>setAddressAuto(e.target.value)} placeholder="例：徳島県吉野川市（町名から先はご自身で入力してください）" />
              {addressAuto.trim() && addressAutoHasAlphabet && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>住所は日本語で入力してください</p>}
              {addressAuto.trim() && missingPrefectureWord && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>都道府県が含まれていません</p>}
              {addressAuto.trim() && missingCityWord && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>市区町村が含まれていません</p>}
              {addressAuto.trim() && !addressAutoHasAlphabet && !missingPrefectureWord && !missingCityWord && zipAddressMismatch && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>郵便番号と住所が一致しません</p>}
            </div>
            <div>
              <label className="lbl f-sans">番地・建物名</label>
              <input className="field f-sans" type="text" value={addressDetail} onChange={e=>setAddressDetail(e.target.value)} placeholder="1-2-3 ○○マンション101" />
              {addressDetail.trim() && addressDetailHasAlphabet && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>住所は日本語で入力してください</p>}
            </div>
          </div>

          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:14 }}>連絡先</div>
            <p className="f-sans" style={{ fontSize:12, color:C.mid }}>
              {sess?.user?.email || sess?.user?.phone || "登録中のアカウント"} 宛に通知します
            </p>
          </div>

          <div>
            <label className="f-sans" style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:C.mid, cursor:"pointer", lineHeight:1.6 }}>
              <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{ marginTop:2 }} />
              <span>
                <span onClick={e=>{ e.stopPropagation(); if (onShowTerms) onShowTerms(); }} style={{ color:C.bamboo, textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>利用規約</span>
                ・
                <span onClick={e=>{ e.stopPropagation(); if (onShowPrivacy) onShowPrivacy(); }} style={{ color:C.bamboo, textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>プライバシーポリシー</span>
                に同意します
              </span>
            </label>
          </div>

          {err && <p className="f-sans" style={{ fontSize:12, color:C.shu }}>{err}</p>}

          <div>
            <button className="btn-primary" style={{ width:"100%" }} disabled={!canSubmit || busy} onClick={submit}>
              {isAllowed === null ? "確認中…" : !isAllowed ? "準備中" : busy ? "登録中…" : "登録する"}
            </button>
            {isAllowed === false && (
              <p className="f-sans" style={{ fontSize:11, color:C.dim, textAlign:"center", marginTop:10 }}>
                現在準備中です。もうしばらくお待ちください
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
