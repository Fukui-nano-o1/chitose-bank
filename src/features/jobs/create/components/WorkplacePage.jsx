import { useEffect, useRef, useState } from "react";
import { NavIcon } from "../../../../components/NavIcons";
import { zipLookup } from "../../../../lib/zipLookup";
import { getSession, upsertEmployerProfile } from "../jobCreateApi";
import { isAllowedPrefecture } from "../model";

export function SavedWorkplaceCard({ address, status, onUse, onRegister, onRetry }) {
  const loading = status === "loading";
  const failed = status === "error";
  return (
    <button type="button" className="listing-workplace-card" disabled={loading}
      onClick={failed ? onRetry : address ? onUse : onRegister}>
      <NavIcon name="pin" size={32} />
      <span className="listing-workplace-copy">
        <strong>{loading ? "登録した作業場を確認中…" : failed ? "作業場を読み込めませんでした" : address ? "登録した作業場を使う" : "作業場を登録する"}</strong>
        <span>{loading ? "少しお待ちください" : failed ? "タップして、もう一度読み込む" : address ? [address.prefecture, address.city, address.town, address.address].filter(Boolean).join("") : "一度登録すると、次回から住所を入力せずに使えます。"}</span>
      </span>
      <svg className="listing-workplace-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </button>
  );
}

export function WorkplacePage({ initialAddress, onBack, onSaved, draftOnly = false }) {
  const zip = initialAddress.zip || "", prefecture = initialAddress.prefecture || "";
  const city = initialAddress.city || "", town = initialAddress.town || "", street = initialAddress.address || "";
  const [address, setAddress] = useState({ zip, prefecture, city, town, address: street });
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lookupVersion = useRef(0);
  const savingRef = useRef(false);
  const editedRef = useRef(false);
  const activeRef = useRef(true);
  const titleRef = useRef(null);
  const streetRef = useRef(null);

  useEffect(() => {
    activeRef.current = true;
    titleRef.current?.focus({ preventScroll: true });
    return () => { activeRef.current = false; lookupVersion.current += 1; };
  }, []);
  // 編集求人をURLから開いた場合も、遅れて読み込んだ住所を引き継ぐ。手入力開始後は上書きしない。
  useEffect(() => {
    if (!editedRef.current) setAddress({ zip, prefecture, city, town, address: street });
  }, [zip, prefecture, city, town, street]);

  const change = (key, value) => {
    editedRef.current = true;
    lookupVersion.current += 1;
    setSearching(false);
    setAddress(previous => ({ ...previous, [key]: value }));
    setError("");
  };
  const search = async () => {
    const postalCode = address.zip.replace(/[^0-9]/g, "");
    if (postalCode.length !== 7) { setError("郵便番号は7桁で入力してください。"); return; }
    const version = ++lookupVersion.current;
    editedRef.current = true;
    setSearching(true);
    setError("");
    try {
      const result = await zipLookup(postalCode);
      if (version !== lookupVersion.current) return;
      if (!result.ok) {
        setError(result.reason === "notfound" ? "郵便番号が見つかりませんでした。住所を直接入力することもできます。" : "住所を検索できませんでした。もう一度試すか、住所を直接入力してください。");
        return;
      }
      setAddress(previous => ({ ...previous, prefecture: result.prefecture, city: result.city, town: result.town || "" }));
      streetRef.current?.focus();
    } catch {
      if (version === lookupVersion.current) setError("住所を検索できませんでした。もう一度試すか、住所を直接入力してください。");
    } finally {
      if (version === lookupVersion.current) setSearching(false);
    }
  };
  const complete = address.zip.replace(/[^0-9]/g, "").length === 7 &&
    isAllowedPrefecture(address.prefecture) && [address.city, address.town, address.address].every(value => value.trim());
  const save = async event => {
    event.preventDefault();
    if (savingRef.current || searching || !complete) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const saved = Object.fromEntries(Object.entries(address).map(([key, value]) => [key, value.trim()]));
    if (draftOnly || navigator.onLine === false) {
      onSaved(saved, { local: true });
      savingRef.current = false;
      setSaving(false);
      return;
    }
    try {
      const { data: { session } } = await getSession();
      if (!session) throw new Error("ログイン状態を確認できませんでした。再度ログインしてください。");
      const result = await upsertEmployerProfile({
        auth_id: session.user.id,
        place_zip: saved.zip, place_prefecture: saved.prefecture, place_city: saved.city,
        place_town: saved.town, place_address: saved.address,
        updated_at: new Date().toISOString(),
      });
      if (result.error) throw new Error("保存できませんでした。入力内容はそのままです。もう一度お試しください。");
      if (activeRef.current) onSaved(saved);
    } catch (failure) {
      if (activeRef.current) setError(failure.message || "保存できませんでした。もう一度お試しください。");
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };

  return <>
    <header className="listing-header">
      <span className="listing-brand">chitose-bank</span>
      <span className="listing-header-title">作業場の登録</span>
      <button type="button" className="listing-save" onClick={onBack} disabled={saving}>キャンセル</button>
    </header>
    <div className="listing-scroll">
      <main className="listing-page listing-motion" data-page="workplace">
        <p className="listing-stage-caption">集合場所 · 作業場の登録</p>
        <h2 ref={titleRef} tabIndex={-1}>作業場を登録しましょう</h2>
        <p>保存すると、集合場所の入力画面に戻り、住所が自動で入ります。次回の求人でも使えます。</p>
        <form id="listing-workplace-form" onSubmit={save} aria-describedby={error ? "listing-workplace-error" : undefined}>
          <fieldset className="listing-workplace-fields" disabled={saving}>
            <legend className="listing-workplace-legend">作業場の住所</legend>
            <label htmlFor="workplace-zip">郵便番号</label>
            <div className="listing-postcode-row">
              <input id="workplace-zip" className="field f-sans" value={address.zip} inputMode="numeric" autoComplete="postal-code"
                onChange={event => change("zip", event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); search(); } }} placeholder="例：779-3401" required />
              <button type="button" className="listing-address-search" disabled={searching} onClick={search}>{searching ? "検索中…" : "住所を検索"}</button>
            </div>
            <label htmlFor="workplace-prefecture">都道府県</label>
            <input id="workplace-prefecture" className="field f-sans" value={address.prefecture} onChange={event => change("prefecture", event.target.value)} placeholder="例：徳島県" autoComplete="address-level1" required />
            {address.prefecture.trim() && !isAllowedPrefecture(address.prefecture) && <p className="listing-workplace-error">現在、求人を掲載できる地域は徳島県です。</p>}
            <label htmlFor="workplace-city">市区町村</label>
            <input id="workplace-city" className="field f-sans" value={address.city} onChange={event => change("city", event.target.value)} placeholder="例：吉野川市" autoComplete="address-level2" required />
            <label htmlFor="workplace-town">町域</label>
            <input id="workplace-town" className="field f-sans" value={address.town} onChange={event => change("town", event.target.value)} placeholder="例：山川町〇〇" autoComplete="address-line1" required />
            <label htmlFor="workplace-address">番地・建物名</label>
            <input ref={streetRef} id="workplace-address" className="field f-sans" value={address.address} onChange={event => change("address", event.target.value)} placeholder="例：1-2-3 〇〇ハイツ101" autoComplete="address-line2" required />
          </fieldset>
          <p className="listing-workplace-note">農家プロフィールの「作業場所」にも保存されます。</p>
          {error && <p id="listing-workplace-error" className="listing-workplace-error" role="alert">{error}</p>}
        </form>
      </main>
    </div>
    <footer className="listing-footer listing-workplace-footer">
      <div className="listing-footer-actions">
        <button type="button" className="listing-back" onClick={onBack} disabled={saving}>戻る</button>
        <button type="submit" form="listing-workplace-form" className="listing-next" disabled={!complete || searching || saving}>{saving ? "保存中…" : "保存して戻る"}</button>
      </div>
    </footer>
  </>;
}
