import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEmployerProfile, fetchAccountHolder, getSession, upsertEmployerProfile } from "./jobCreateApi";
import { logAppError } from "../../../app/diagnostics/errorLog";
import { normalizeRecruiterDraft, recruiterKeys, recruiterValues, missingRecruiterPages, profileText, recruiterPageValid } from "./listingPublicationPages";

// 表示キャッシュを掲載判断には使わない。既存の本人プロフィールAPIを使い、対象列だけ明示保存する。
export function useListingRecruiter({ ownerId, initialDraft, onProfile }) {
  const [draft, setDraft] = useState(() => normalizeRecruiterDraft(initialDraft));
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(true), lock = useRef(false), generation = useRef(0);
  const current = useRef({ ownerId, draft, profile });
  current.current = { ownerId, draft, profile };
  const callback = useRef(onProfile); callback.current = onProfile;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const accept = useCallback(row => {
    setProfile(row || {}); setStatus("ready");
    callback.current?.(row || {});
  }, []);
  const report = (reason) => {
    void logAppError({ component: "ListingFlow", page: "listing_publish", action: "recruiter_save", operation: "profile_save",
      error: { message: "募集者情報の保存を確認できません: " + reason, code: reason }, metadata: { reason_code: reason } });
  };
  const load = useCallback(async () => {
    const token = ++generation.current;
    if (!ownerId) { setStatus("signed_out"); return; }
    setStatus("loading"); setError("");
    try {
      const result = await fetchEmployerProfile(ownerId);
      if (!live.current || token !== generation.current || current.current.ownerId !== ownerId) return;
      if (result.error || (result.data?.auth_id && result.data.auth_id !== ownerId)) throw new Error("profile_read");
      accept(result.data);
    } catch {
      if (live.current && token === generation.current) {
        setStatus("error"); setError("登録情報を確認できませんでした。入力を保持したまま、もう一度読み込めます。");
      }
    }
  }, [ownerId, accept]);
  useEffect(() => {
    load();
    window.addEventListener("online", load);
    return () => window.removeEventListener("online", load);
  }, [load]);
  const change = (key, value) => setDraft(previous => ({ ...previous,
    [key]: { value, base: previous[key]?.base ?? profileText(current.current.profile, key) },
  }));
  const restore = useCallback(value => setDraft(previous => ({ ...normalizeRecruiterDraft(value), ...previous })), []);
  const useLatest = id => {
    const keys = recruiterKeys(id);
    setDraft(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.includes(key))));
    setError("");
  };
  const useRegistration = async id => {
    if (!ownerId || lock.current) return;
    const entry = current.current.draft[id];
    const token = generation.current;
    try {
      const { data, error: readError } = await fetchAccountHolder(ownerId);
      if (!live.current || current.current.ownerId !== ownerId || generation.current !== token || lock.current || current.current.draft[id] !== entry) return;
      if (readError) throw readError;
      const value = id === "recruiter_name" ? data?.company_name || data?.full_name
        : id === "recruiter_address" ? [data?.postal_code ? "〒" + data.postal_code : "", data?.address].filter(Boolean).join(" ")
          : data?.contact_phone || data?.contact_email;
      if (value) change(id, value); else setError("登録情報にこの項目がありません。直接入力してください。");
    } catch { if (live.current) setError("登録情報を読み込めませんでした。直接入力するか、再度お試しください。"); }
  };
  const save = async id => {
    if (lock.current || status !== "ready") return false;
    const keys = recruiterKeys(id), values = recruiterValues(profile, draft);
    if (!recruiterPageValid(id, values)) { setError("この項目を入力してください。"); return false; }
    const owner = ownerId, token = generation.current;
    const active = () => live.current && generation.current === token && current.current.ownerId === owner;
    const proposed = Object.fromEntries(keys.map(key => [key, profileText(values, key)]));
    if (id === "smoking_policy" && proposed.smoking_policy !== "喫煙場所あり") proposed.smoking_area = "";
    lock.current = true; setBusy(true); setError("");
    try {
      const session = (await getSession()).data?.session;
      if (!session || session.user.id !== owner) throw new Error("authentication");
      const before = await fetchEmployerProfile(owner);
      if (!active()) return false;
      if (before.error || (before.data?.auth_id && before.data.auth_id !== owner)) throw new Error("profile_read");
      const matches = row => keys.every(key => profileText(row, key) === proposed[key]);
      // 再試行では先に読む。前回の応答だけが失われた場合は同じ保存を繰り返さない。
      if (!matches(before.data)) {
        if (keys.some(key => profileText(before.data, key) !== (draft[key]?.base ?? profileText(profile, key)) && profileText(before.data, key) !== proposed[key])) {
          accept(before.data);
          throw new Error("profile_conflict");
        }
        try { await upsertEmployerProfile({ auth_id: owner, ...proposed, updated_at: new Date().toISOString() }); }
        catch { /* 応答紛失でも、本人の行を1回読み直して保存結果を確かめる。 */ }
        if (!active()) return false;
        const verified = await fetchEmployerProfile(owner);
        if (!active()) return false;
        if (verified.error || !verified.data || (verified.data.auth_id && verified.data.auth_id !== owner) || !matches(verified.data)) throw new Error("save_unconfirmed");
        accept(verified.data);
      } else accept(before.data);
      setDraft(previous => Object.fromEntries(Object.entries(previous).filter(([key, entry]) => !keys.includes(key) || entry.value !== draft[key]?.value)));
      return true;
    } catch (failure) {
      if (!active()) return false;
      const code = ["authentication", "profile_read", "profile_conflict", "save_unconfirmed"].includes(failure.message) ? failure.message : "unexpected";
      setError(code === "profile_conflict" ? "登録情報が別の操作で変更されています。上書きしていません。最新の登録内容を確認してください。"
        : code === "authentication" ? "ログイン状態を確認できません。入力は下書きに残っています。ログインし直してからお試しください。"
          : "募集者情報の保存を確認できませんでした。入力は残っています。通信が戻ってから、もう一度保存してください。");
      report(code); return false;
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return { draft, restore, values: recruiterValues(profile, draft), profile, status, error, busy, change, save, reload: load,
    useLatest, useRegistration, missing: status === "ready" ? missingRecruiterPages(profile, draft) : [] };
}
