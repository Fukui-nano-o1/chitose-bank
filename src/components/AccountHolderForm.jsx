// 分割3-B（2026-07-25）：App.jsxから移動。新規登録①（本人確認・口座名義人情報）。
import { useState, useEffect, useId } from "react";
import { supabase } from "../lib/supabase";
import { zipLookup } from "../lib/zipLookup";
import { ROUTE_CHANGED } from "../lib/pushRoute";
import { THIS_YEAR, TERMS_VERSION, PRIVACY_VERSION } from "../lib/utils";
import { Dots } from "./ui";
import "./auth.css";

// ── AccountHolderForm — 新規登録①（本人確認・口座名義人情報）────
// 送信は届出完了までADMIN_EMAIL限定。一般ユーザーはボタン無効「準備中」表示（RLS側もadmin限定で二重ゲート）
export function AccountHolderForm({ onDone, onSessionExpired, onShowTerms, onShowPrivacy }) {
  // この画面はURLを変えずに出ることがある（登録直後の自動表示）＝出た瞬間に画面の合図を送り、
  // この画面の説明（PageGuide）が「本人情報の登録」の説明を出せるようにする（2026-09-02）
  useEffect(() => { try { window.dispatchEvent(new Event(ROUTE_CHANGED)); } catch {} }, []);
  const fieldId = useId();
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

  if (sess === undefined) return <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:13,color:"#B0B0B0"}}>確認中<Dots /></p></div>;

  return (
    <div data-guide="account-form" className="cb-auth-page f-sans">
      <section className="cb-auth-panel cb-account-panel" aria-labelledby={`${fieldId}-heading`}>
        <header className="cb-auth-header"><p>新規登録</p></header>
        <div className="cb-auth-body cb-auth-enter">
          <h1 id={`${fieldId}-heading`} className="cb-auth-heading">登録を完了しましょう</h1>
          <p className="cb-auth-description">ご本人の情報を入力してください。</p>
          <form onSubmit={e => { e.preventDefault(); if (!busy) submit(); }} aria-busy={busy}>
            <fieldset className="cb-account-fields" disabled={busy}>
              <section className="cb-account-section" aria-labelledby={`${fieldId}-type`}>
                <h2 id={`${fieldId}-type`}>登録区分</h2>
                <div className="cb-account-choice">
                  <button type="button" aria-pressed={entityType === "individual"} onClick={() => { setEntityType("individual"); setCompanyName(""); setCompanyNumber(""); }}>個人</button>
                  <button type="button" aria-pressed={entityType === "corporate"} onClick={() => setEntityType("corporate")}>法人</button>
                </div>
              </section>

              <section className="cb-account-section" aria-labelledby={`${fieldId}-person`}>
                <h2 id={`${fieldId}-person`}>本人情報</h2>
                <div className="cb-auth-field-group">
                  <div className="cb-auth-field">
                    <label htmlFor={`${fieldId}-name`}>{entityType === "corporate" ? "代表者氏名" : "氏名"}</label>
                    <input id={`${fieldId}-name`} data-guide="account-name" type="text" autoComplete="name" required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="山田 太郎" />
                  </div>
                  {entityType === "corporate" && <>
                    <div className="cb-auth-field">
                      <label htmlFor={`${fieldId}-company`}>法人名</label>
                      <input id={`${fieldId}-company`} type="text" autoComplete="organization" required value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="株式会社〇〇" />
                    </div>
                    <div className="cb-auth-field">
                      <label htmlFor={`${fieldId}-company-number`}>法人番号</label>
                      <input id={`${fieldId}-company-number`} type="text" inputMode="numeric" required value={companyNumber} onChange={e => setCompanyNumber(e.target.value)} placeholder="国税庁の法人番号（13桁）" />
                    </div>
                  </>}
                </div>
                <div className="cb-account-gap">
                  <span className="cb-account-label" id={`${fieldId}-birthday`}>生年月日</span>
                  <div className="cb-account-birthday" role="group" aria-labelledby={`${fieldId}-birthday`}>
                    <div className="cb-auth-field">
                      <label htmlFor={`${fieldId}-year`}>年</label>
                      <select id={`${fieldId}-year`} autoComplete="bday-year" required value={birthYear} onChange={e => {
                        const y = e.target.value; setBirthYear(y);
                        if (y && birthMonth) { const dim = new Date(Number(y), Number(birthMonth), 0).getDate(); if (Number(birthDay) > dim) setBirthDay(""); }
                      }}>
                        <option value="">選択</option>
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="cb-auth-field">
                      <label htmlFor={`${fieldId}-month`}>月</label>
                      <select id={`${fieldId}-month`} autoComplete="bday-month" required value={birthMonth} onChange={e => {
                        const m = e.target.value; setBirthMonth(m);
                        if (birthYear && m) { const dim = new Date(Number(birthYear), Number(m), 0).getDate(); if (Number(birthDay) > dim) setBirthDay(""); }
                      }}>
                        <option value="">選択</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="cb-auth-field">
                      <label htmlFor={`${fieldId}-day`}>日</label>
                      <select id={`${fieldId}-day`} autoComplete="bday-day" required value={birthDay} onChange={e => setBirthDay(e.target.value)}>
                        <option value="">選択</option>
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  <p className="cb-auth-note">18歳以上の方がご登録いただけます。</p>
                  {birthDateStr && !isAdult && <p className="cb-auth-error" role="alert">18歳未満はご登録いただけません</p>}
                </div>
              </section>

              <section className="cb-account-section" aria-labelledby={`${fieldId}-address-heading`}>
                <h2 id={`${fieldId}-address-heading`}>{entityType === "corporate" ? "本店所在地" : "住所"}</h2>
                <div className="cb-account-zip">
                  <div className="cb-auth-field">
                    <label htmlFor={`${fieldId}-zip`}>郵便番号</label>
                    <input id={`${fieldId}-zip`} type="text" inputMode="numeric" autoComplete="postal-code" required value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="7790000" />
                  </div>
                  <button type="button" className="cb-auth-secondary" onClick={searchAccountZip} disabled={zipSearching}>{zipSearching ? <>検索中<Dots /></> : "住所を検索"}</button>
                </div>
                {zipError && <p className="cb-auth-error" role="alert">{zipError}</p>}
                {!zipError && zipNotSevenDigits && <p className="cb-auth-error">郵便番号は7桁で入力してください</p>}
                <div className="cb-auth-field-group cb-account-gap">
                  <div className="cb-auth-field">
                    <label htmlFor={`${fieldId}-address`}>都道府県・市区町村</label>
                    <input id={`${fieldId}-address`} type="text" autoComplete="address-line1" required value={addressAuto} onChange={e => setAddressAuto(e.target.value)} placeholder="徳島県吉野川市" />
                  </div>
                  <div className="cb-auth-field">
                    <label htmlFor={`${fieldId}-address-detail`}>町名・番地・建物名</label>
                    <input id={`${fieldId}-address-detail`} type="text" autoComplete="address-line2" required value={addressDetail} onChange={e => setAddressDetail(e.target.value)} placeholder="〇〇町1-2-3" />
                  </div>
                </div>
                {addressAuto.trim() && addressAutoHasAlphabet && <p className="cb-auth-error">住所は日本語で入力してください</p>}
                {addressAuto.trim() && missingPrefectureWord && <p className="cb-auth-error">都道府県が含まれていません</p>}
                {addressAuto.trim() && missingCityWord && <p className="cb-auth-error">市区町村が含まれていません</p>}
                {addressAuto.trim() && !addressAutoHasAlphabet && !missingPrefectureWord && !missingCityWord && zipAddressMismatch && <p className="cb-auth-error">郵便番号と住所が一致しません。「住所を検索」で確認してください。</p>}
                {addressDetail.trim() && addressDetailHasAlphabet && <p className="cb-auth-error">住所は日本語で入力してください</p>}
              </section>

              <section className="cb-account-section" aria-labelledby={`${fieldId}-contact`}>
                <h2 id={`${fieldId}-contact`}>連絡先</h2>
                <p className="cb-account-contact">{sess?.user?.email || sess?.user?.phone || "登録中のアカウント"}</p>
                <p className="cb-auth-note">ご登録の連絡先に通知をお送りします。</p>
              </section>

              <section className="cb-account-section" aria-label="規約の確認">
                <p><button type="button" className="cb-auth-link" onClick={onShowTerms}>利用規約</button>・<button type="button" className="cb-auth-link" onClick={onShowPrivacy}>プライバシーポリシー</button></p>
                <label className="cb-account-consent">
                  <input type="checkbox" required checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                  <span>利用規約・プライバシーポリシーに同意します</span>
                </label>
              </section>
              {err && <p className="cb-auth-error" role="alert">{err}</p>}
              <div>
                <button data-guide="account-submit" className="cb-auth-primary" disabled={!canSubmit || busy}>
                  {isAllowed === null ? <>確認中<Dots /></> : !isAllowed ? "準備中" : busy ? <>登録中<Dots /></> : "同意して登録する"}
                </button>
                {isAllowed === false && <p className="cb-auth-note cb-auth-center" role="status">現在準備中です。もうしばらくお待ちください。</p>}
              </div>
            </fieldset>
          </form>
        </div>
      </section>
    </div>
  );
}
