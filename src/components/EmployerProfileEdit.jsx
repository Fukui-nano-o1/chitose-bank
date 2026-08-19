// 分割3-B（2026-07-25）：App.jsxから移動。雇い手プロフィール編集＋プレビュー（FarmerProfilePreviewは本ファイル専用）。
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { zipLookup } from "../lib/zipLookup";
import { uploadAvatarResilient } from "../lib/avatarUpload";
import { INTERACTION_STYLE_OPTIONS, HOST_STYLE_QUESTIONS, farmIntroTopics, perkBadges, splitTextsForReview } from "../lib/utils";
import { Avatar, AutoSkeleton, Dots } from "./ui";
import { FarmerTrustCard } from "./TrustCards";
import { ToggleSwitch } from "./ToggleSwitch";
import { EmergencyContactBox } from "./EmergencyContactBox";
import { getCache, setCache } from "../lib/viewCache";
import { snapSet } from "../lib/snapshot";

// table/avatarDir で保存先を差し替え可能（2026-07-31たきと指示・委託専用プロフィールが同じ項目/配置で
// 別テーブルに保存するため）。既定は雇い手プロフィール（employer_profiles・avatarは avatars/employer/）＝現行不変
// black=委託の黒テーマ（2026-07-31たきと指示）：ボックスのアイコンを消し、縁をブラックに。既定false＝雇い手側は不変
// seedFrom=初回の引き継ぎ元テーブル（2026-07-31たきと指示「はじめは農家プロフィールの入力内容を引き継ぐ。保存先は別々」）。
// 自分の行が未作成のときだけ seedFrom から読んでフォームに初期値を入れる。保存は本人が押した時だけ・保存先は table のまま
export function EmployerProfileEdit({ me, onDone, onCancel, table = "employer_profiles", avatarDir = "employer", black = false, seedFrom = null }) {
  // アクセント色（2026-07-31たきと指示「すべて、ブラックで統一」）：black時は緑→黒・淡緑→淡グレー
  const AC = black ? "#111111" : "#00A86B";
  const ACS = black ? "#EEEEEE" : "#E6F7EF";
  const [nickname, setNickname] = useState("");
  const [pr, setPr] = useState(""); // 紹介・PRボックスは廃止（2026-07-16）。既存データ保全のためstateと保存は温存
  const [avatarUrl, setAvatarUrl] = useState("");
  // 作業場所（集合場所の既定値・紹介PRボックスの差し替え・2026-07-16）。求人フローstep3の復元ボタンがここを読む
  const [placeZip, setPlaceZip] = useState("");
  const [placePref, setPlacePref] = useState("");
  const [placeCity, setPlaceCity] = useState("");
  const [placeTown, setPlaceTown] = useState("");
  const [placeAddr, setPlaceAddr] = useState("");
  const approvedTextsRef = useRef({}); // 自由記述の承認済み（本公開）値の控え。保存時の差分判定に使う（2026-07-16）
  const [hasTransport, setHasTransport] = useState(false);
  const [hasParking, setHasParking] = useState(false);
  const [hasCommuteAllowance, setHasCommuteAllowance] = useState(false);
  const [hasBonus, setHasBonus] = useState(false);
  // 昇給・退職手当（2026-08-19たきと指示）：賞与と同じく有無だけの項目（自由記述は持たせない）
  const [hasRaise, setHasRaise] = useState(false);
  const [hasSeverancePay, setHasSeverancePay] = useState(false);
  const [employerPaysSupplies, setEmployerPaysSupplies] = useState(false);
  const [accessoryOk, setAccessoryOk] = useState(false);
  const [parkingCapacity, setParkingCapacity] = useState("");
  const [commuteAllowanceDetail, setCommuteAllowanceDetail] = useState("");
  const [suppliesCap, setSuppliesCap] = useState(""); // 持ち物農家負担の上限設定（例：上限1,000円まで・2026-07-16）
  const [transportArea, setTransportArea] = useState("");
  const [introPath, setIntroPath] = useState("");
  const [introJoy, setIntroJoy] = useState("");
  const [introCrops, setIntroCrops] = useState("");
  const [introAtmosphere, setIntroAtmosphere] = useState("");
  const [introMessage, setIntroMessage] = useState("");
  const [ownerComment, setOwnerComment] = useState("");
  // 募集者の情報（2026-07-27たきと指示）：氏名または名称／住所・所在地／連絡先。
  // ★求人ページの「募集者情報」として公開する（2026-07-27改定・法令上の明示事項）。
  //   経路は job_employer_profile（求人詳細用RPC）。一覧用のemployer_profiles_publicには載せない
  const [recruiterName, setRecruiterName] = useState("");
  const [recruiterNameKana, setRecruiterNameKana] = useState(""); // フリガナ（2026-08-03たきと指示・任意・引き継ぎ元なし＝本人入力）
  // 受動喫煙の状況（2026-08-03たきと指示「ありならどこか」）：求人の明示事項。選択＋「あり」のとき場所の自由記述
  const [smokingPolicy, setSmokingPolicy] = useState("");
  const [smokingArea, setSmokingArea] = useState("");
  const [recruiterAddress, setRecruiterAddress] = useState("");
  const [recruiterContact, setRecruiterContact] = useState("");
  // ── 住所・所在地の分割入力（2026-08-01たきと指示）────────────────────────
  // 分割値（郵便番号/都道府県/市区町村/町名・番地・建物名）が真実の座。保存時に1行へ合成して
  // recruiter_address に入れる＝表示経路（求人ページ「募集者情報」・求人フローの引用）は無改修。
  // 既存の1行値だけ持つ利用者は、分割欄が空の間は従来の1行値をそのまま維持する（消さない）
  const [recruiterZip, setRecruiterZip] = useState("");
  const [recruiterPref, setRecruiterPref] = useState("");
  const [recruiterCity, setRecruiterCity] = useState("");
  const [recruiterDetail, setRecruiterDetail] = useState("");
  const [rZipSearching, setRZipSearching] = useState(false);
  const [rZipError, setRZipError] = useState("");
  const composeRecruiterAddress = () => {
    const body = (recruiterPref + recruiterCity + recruiterDetail).trim();
    if (!recruiterZip.trim() && !body) return recruiterAddress.trim(); // 分割未入力＝既存の1行値を維持
    return [recruiterZip.trim() ? "〒" + recruiterZip.trim() : "", body].filter(Boolean).join(" ");
  };
  // 郵便番号→都道府県・市区町村を自動入力（zipLookup＝2系統レース＋タイムアウト＋キャッシュ・
  // 2026-08-02「数十秒」対策。求人フローstep3と同じ窓口）。
  // ★引数で郵便番号を受け取る理由も求人フローと同じ：入力欄のonChangeから呼ぶとき、stateはまだ更新前
  const searchRecruiterZip = async (zipRaw) => {
    const zip = String(zipRaw === undefined ? recruiterZip : zipRaw).replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setRZipError("郵便番号は7桁で入力してください"); return; }
    setRZipSearching(true); setRZipError("");
    const r = await zipLookup(zip);
    if (r.ok) {
      setRecruiterPref(r.prefecture); setRecruiterCity(r.city);
      // 町域が取れて番地欄が空なら初期値に（入力済みの値は上書きしない）
      setRecruiterDetail(prev => prev.trim() ? prev : (r.town || ""));
    } else setRZipError(r.reason === "notfound" ? "郵便番号が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
    setRZipSearching(false);
  };
  // 新規登録（account_holders）の1行住所を分割欄へ流し込む：郵便番号→都道府県・市区町村（zipLookup）、
  // 残りを町名・番地欄へ。都道府県・市区町村の先頭一致で剥がすだけ（推測パースはしない）。
  // 住所が引けなかったときは全文を町名・番地欄に入れる＝本人が確認して直せる形で残す
  const fillSplitFromAccount = async (ah) => {
    const zip = (ah.postal_code || "").trim().replace(/[^0-9]/g, "");
    const addr = (ah.address || "").trim();
    if (!zip && !addr) return false;
    if (zip) setRecruiterZip(zip);
    let pref = "", city = "";
    if (zip.length === 7) {
      const r = await zipLookup(zip);
      if (r.ok) { pref = r.prefecture; city = r.city; }
    }
    if (pref) setRecruiterPref(pref);
    if (city) setRecruiterCity(city);
    let rest = addr;
    if (pref && rest.startsWith(pref)) rest = rest.slice(pref.length);
    if (city && rest.startsWith(city)) rest = rest.slice(city.length);
    if (rest.trim()) setRecruiterDetail(rest.trim());
    return true;
  };
  const [carrying, setCarrying] = useState(false);
  // 新規登録①(account_holders)の内容を引き継ぐ（2026-07-27たきと指示）。
  // ★自動コピーにはしない：登録時の本人確認情報は「他の利用者に表示しない」と説明して集めたデータなので、
  //   黙って公開欄へ流し込まない。ボタンで持ってきて、本人が内容を確認して保存する＝本人の意思で公開する形にする。
  //   読めるのは本人の行だけ（RLS: auth.uid() = auth_id）
  const carryFromAccount = async () => {
    if (carrying) return;
    setCarrying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setCarrying(false); return; }
      const { data, error } = await supabase.from("account_holders")
        .select("full_name,company_name,postal_code,address,contact_phone,contact_email")
        .eq("auth_id", session.user.id).maybeSingle();
      setCarrying(false);
      if (error || !data) { alert("新規登録の情報が見つかりませんでした。"); return; }
      const name = (data.company_name || "").trim() || (data.full_name || "").trim();
      const contact = (data.contact_phone || "").trim() || (data.contact_email || "").trim();
      if (name) setRecruiterName(name);
      // 住所は分割欄へ流し込む（郵便番号→zipcloudで都道府県・市区町村を補完・2026-08-01）
      const gotAddr = await fillSplitFromAccount(data);
      if (contact) setRecruiterContact(contact);
      if (!name && !gotAddr && !contact) alert("引き継げる内容がありませんでした。");
    } catch { setCarrying(false); alert("読み込みに失敗しました。"); }
  };
  const [uniquePoint, setUniquePoint] = useState("");
  const [alwaysDo, setAlwaysDo] = useState("");
  const [breakStyle, setBreakStyle] = useState("");
  const [interactionStyle, setInteractionStyle] = useState("");
  // 関わり方の追加3問（2026-08-14たきと指示・選択式）。値の正はHOST_STYLE_QUESTIONS
  const [teachingStyle, setTeachingStyle] = useState("");
  const [chatStyle, setChatStyle] = useState("");
  const [questionStyle, setQuestionStyle] = useState("");
  const [introOpen, setIntroOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        let { data } = await supabase.from(table).select("*").eq("auth_id", session.user.id).maybeSingle();
        // 初回引き継ぎ：自分の行が無ければ seedFrom（農家プロフィール）を初期値として読む。
        // 行は作らない＝保存は本人が押した時だけ。承認済み控えは空にする（この表にはまだ何も保存されていない）
        let seeded = false;
        if (!data && seedFrom) {
          const { data: sd } = await supabase.from(seedFrom).select("*").eq("auth_id", session.user.id).maybeSingle();
          if (sd) { data = sd; seeded = true; }
        }
        if (data) {
          setNickname(data.nickname || ""); setPr(data.pr || ""); setAvatarUrl(data.avatar_url || "");
          setPlaceZip(data.place_zip || ""); setPlacePref(data.place_prefecture || ""); setPlaceCity(data.place_city || "");
          setPlaceTown(data.place_town || ""); setPlaceAddr(data.place_address || "");
          setHasTransport(data.has_transport ?? false);
          setHasParking(data.has_parking ?? false);
          setHasCommuteAllowance(data.has_commute_allowance ?? false);
          setHasBonus(data.has_bonus ?? false);
          setHasRaise(data.has_raise ?? false);
          setHasSeverancePay(data.has_severance_pay ?? false);
          setEmployerPaysSupplies(data.employer_pays_supplies ?? false);
          setAccessoryOk(data.accessory_ok ?? false);
          setParkingCapacity(data.parking_capacity != null ? String(data.parking_capacity) : "");
          // 自由記述は texts_pending 優先で編集欄へ＝自分が書いた最新が見える（2026-07-16）。
          // 承認プロセス削除後は保存の瞬間に畳まれるので実際は常に空だが、読み込み側は残しておく
          // ＝万一トリガーを外した時（審査を戻す時）に、書きかけが編集欄から消えない
          const tp = data.texts_pending || {};
          approvedTextsRef.current = {
            owner_comment: data.owner_comment ?? "", intro_path: data.intro_path ?? "", intro_joy: data.intro_joy ?? "",
            intro_crops: data.intro_crops ?? "", intro_atmosphere: data.intro_atmosphere ?? "", intro_message: data.intro_message ?? "",
            unique_point: data.unique_point ?? "", always_do: data.always_do ?? "", break_style: data.break_style ?? "",
            transport_area: data.transport_area ?? "", commute_allowance_detail: data.commute_allowance_detail ?? "", supplies_cap: data.supplies_cap ?? "",
          };
          if (seeded) approvedTextsRef.current = {};
          setCommuteAllowanceDetail(tp.commute_allowance_detail ?? (data.commute_allowance_detail || ""));
          setSuppliesCap(tp.supplies_cap ?? (data.supplies_cap || ""));
          setTransportArea(tp.transport_area ?? (data.transport_area || ""));
          setIntroPath(tp.intro_path ?? data.intro_path ?? "");
          setIntroJoy(tp.intro_joy ?? data.intro_joy ?? "");
          setIntroCrops(tp.intro_crops ?? data.intro_crops ?? "");
          setIntroAtmosphere(tp.intro_atmosphere ?? data.intro_atmosphere ?? "");
          setIntroMessage(tp.intro_message ?? data.intro_message ?? "");
          setOwnerComment(tp.owner_comment ?? data.owner_comment ?? "");
          setRecruiterName(data.recruiter_name || "");
          setRecruiterNameKana(data.recruiter_name_kana || "");
          setSmokingPolicy(data.smoking_policy || ""); setSmokingArea(data.smoking_area || "");
          setRecruiterAddress(data.recruiter_address || "");
          setRecruiterContact(data.recruiter_contact || "");
          setRecruiterZip(data.recruiter_zip || ""); setRecruiterPref(data.recruiter_prefecture || "");
          setRecruiterCity(data.recruiter_city || ""); setRecruiterDetail(data.recruiter_address_detail || "");
          // 未入力なら新規登録の内容を初期値として入れる（2026-07-27たきと指示「自動挿入」）。
          // 入っている値は上書きしない＝本人が直した内容を消さない。保存は本人が押した時だけ
          if (!(data.recruiter_name || "").trim() || !(data.recruiter_address || "").trim() || !(data.recruiter_contact || "").trim()) {
            try {
              const { data: ah } = await supabase.from("account_holders")
                .select("full_name,company_name,postal_code,address,contact_phone,contact_email")
                .eq("auth_id", session.user.id).maybeSingle();
              if (ah) {
                const nm = (ah.company_name || "").trim() || (ah.full_name || "").trim();
                const ct = (ah.contact_phone || "").trim() || (ah.contact_email || "").trim();
                if (!(data.recruiter_name || "").trim() && nm) setRecruiterName(nm);
                // 住所：分割欄も1行値も空のときだけ、新規登録の住所を分割欄へ流し込む（2026-08-01）
                const partsEmpty = !((data.recruiter_zip || "").trim() || (data.recruiter_prefecture || "").trim() || (data.recruiter_city || "").trim() || (data.recruiter_address_detail || "").trim());
                if (!(data.recruiter_address || "").trim() && partsEmpty) await fillSplitFromAccount(ah);
                if (!(data.recruiter_contact || "").trim() && ct) setRecruiterContact(ct);
              }
            } catch {}
          }
          setUniquePoint(tp.unique_point ?? data.unique_point ?? "");
          setAlwaysDo(tp.always_do ?? data.always_do ?? "");
          setBreakStyle(tp.break_style ?? data.break_style ?? "");
          setInteractionStyle(data.interaction_style ?? "");
          setTeachingStyle(data.teaching_style ?? ""); setChatStyle(data.chat_style ?? ""); setQuestionStyle(data.question_style ?? "");
          // 既に1つでも入力済みなら初期状態でアコーディオンを開く（値が見えず消えたと誤解されるのを防ぐ）
          const hasIntroContent = !!(data.intro_path || data.intro_joy || data.intro_crops || data.intro_atmosphere || data.intro_message || data.owner_comment || data.unique_point || data.always_do || data.break_style || data.interaction_style);
          if (hasIntroContent) setIntroOpen(true);
        } else {
          // プロフィール行がまだ無い新規の求人者（2026-08-03たきと指示「求人者のプロフィールも新規登録から引き継ごう」）：
          // 氏名・名称／住所（分割）／連絡先を新規登録①の内容で初期値プリフィルする。
          // 従来この自動挿入は「行がある場合の未入力欄」にしか効いておらず、初回は全欄空だった。
          // 保存は本人が押した時だけ＝本人が内容を確認して公開する形（2026-07-27の設計原則）は不変
          try {
            const { data: ah } = await supabase.from("account_holders")
              .select("full_name,company_name,postal_code,address,contact_phone,contact_email")
              .eq("auth_id", session.user.id).maybeSingle();
            if (ah) {
              const nm = (ah.company_name || "").trim() || (ah.full_name || "").trim();
              const ct = (ah.contact_phone || "").trim() || (ah.contact_email || "").trim();
              if (nm) setRecruiterName(nm);
              await fillSplitFromAccount(ah);
              if (ct) setRecruiterContact(ct);
            }
          } catch {}
        }
      } catch {}
      setLoading(false);
    })();
  }, []);
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
        const { data: olds } = await supabase.storage.from('avatars').list(avatarDir + "/" + session.user.id);
        if (olds && olds.length > 0) {
          const paths = olds.map(f => avatarDir + "/" + session.user.id + "/" + f.name);
          await supabase.storage.from('avatars').remove(paths);
        }
      } catch {}
      const path = avatarDir + "/" + session.user.id + "/avatar.jpg";
      const upErr = await uploadAvatarResilient(avatarDir + "/" + session.user.id, blob);
      if (upErr) { setUploading(false); alert("アップロードに失敗しました：" + upErr.message + "\n通信環境を確認して、もう一度お試しください。"); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = (urlData?.publicUrl || '') + "?t=" + Date.now();
      await supabase.from(table).upsert({ auth_id: session.user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl(url);
    } catch { alert("画像のアップロードに失敗しました。"); }
    setUploading(false);
  };
  const handleDeleteAvatar = async () => {
    if (!avatarUrl || uploading) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      const { data: files } = await supabase.storage.from('avatars').list(avatarDir + "/" + session.user.id);
      if (files && files.length > 0) {
        const paths = files.map(f => avatarDir + "/" + session.user.id + "/" + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from(table).upsert({ auth_id: session.user.id, avatar_url: '', updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl('');
    } catch { alert("削除に失敗しました。"); }
    setUploading(false);
  };
  // ホームの「🛡 保険の準備」から来た時は、その場で保険ボックスを開く（移植・2026-07-23）
  const [editBox, setEditBox] = useState(null);
  // 🆘緊急連絡先のカード表示用サマリー（2026-08-14たきと報告「保存しても空のまま」の修理）：
  // 別テーブル（emergency_contacts・self-only）のでこのページの本体読み込みとは独立に読む。
  // 従来は v:"" 固定＝保存してもカードが永久に「未設定」＋赤影のままだった
  const [emgSummary, setEmgSummary] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("emergency_contacts").select("name,relation").eq("auth_id", session.user.id).maybeSingle();
        if (data) setEmgSummary([data.relation, data.name].filter(x => (x || "").trim()).join("・"));
      } catch {}
    })();
  }, []);
  const [showPreview, setShowPreview] = useState(false); // 右上「プレビュー」→FarmerProfilePreviewをモーダル展開
  // editFromPreview（プレビュー発の編集の往復）は削除（2026-07-31）：プレビューの項目タップ編集の
  // 廃止（2026-07-25）で発火元が消え、永久にfalseの死に状態だった
  const closeEditBox = () => setEditBox(null);
  // 保存→次の未入力ボックスを自動展開（全て入力されるまでループ・2026-07-16・働き手側と同構造）
  // 保険の準備はホーム（面接の質問集の下）へ移植したため、格子の自動フロー(BOX_ORDER)には載せない（2026-07-23）
  // black（委託）では 関わり方・代表より・問いかけ を置かない（2026-07-31たきと指示）
  // 従業員数(staff)は全面削除（2026-08-01たきと指示）
  const BOX_ORDER = black ? ["avatar","nickname","place","perks"] : ["avatar","nickname","place","perks","intro","ask","style"];
  // 待遇ボックスの要約チップ。受動喫煙も他の待遇と同じ行になった（2026-08-19）ので、決めてあればここに出す
  const perksOn = [hasTransport&&"送迎", hasParking&&"駐車場", hasCommuteAllowance&&"通勤手当", hasBonus&&"賞与", hasRaise&&"昇給", hasSeverancePay&&"退職手当", employerPaysSupplies&&"持ち物負担", accessoryOk&&"アクセサリーOK", smokingPolicy && (smokingPolicy === "喫煙場所あり" ? "喫煙場所あり" : "禁煙")].filter(Boolean);
  const introFilled = [introPath, introJoy, introCrops, introAtmosphere, introMessage, ownerComment].filter(t => t && t.trim()).length;
  const askFilled = [uniquePoint, alwaysDo, breakStyle].filter(t => t && t.trim()).length;
  // 関わり方4問の回答済みラベル（格子サマリー用・2026-08-14）。ローカルstateから引く＝保存前でも即反映
  const styleLocal = { interaction_style: interactionStyle, teaching_style: teachingStyle, chat_style: chatStyle, question_style: questionStyle };
  const styleAnswered = HOST_STYLE_QUESTIONS.map(q => (q.options.find(o => o.value === styleLocal[q.k]) || {}).label).filter(Boolean);

  const boxFilled = (k) => (
    k === "avatar" ? !!avatarUrl : k === "nickname" ? !!recruiterName.trim() : k === "place" ? !!composeRecruiterAddress()
    : k === "perks" ? (perksOn.length > 0 || !!smokingPolicy)
    : k === "intro" ? introFilled > 0
    : k === "ask" ? askFilled > 0 : !!interactionStyle
  );
  const nextUnfilledBox = (afterKey) => {
    const start = Math.max(0, BOX_ORDER.indexOf(afterKey));
    for (let i = 1; i <= BOX_ORDER.length; i++) {
      const k = BOX_ORDER[(start + i) % BOX_ORDER.length];
      if (!boxFilled(k)) return k;
    }
    return null;
  };
  // 今日ページ「プロフィール入力」からの着地（2026-08-03たきと指示）：働き手側と同じ作法。
  // 最初の未入力ボックスをその場で開き、以後は保存のたびに次の未入力へ（既存の連鎖に乗る）。
  // 読み込み完了後に1回だけ判定する（読み込み前は全項目が空に見えるため）
  const fillGuideRef = useRef(false);
  useEffect(() => {
    if (loading || fillGuideRef.current) return;
    let want = false;
    try { want = sessionStorage.getItem("cb_fillProfile") === "1"; if (want) sessionStorage.removeItem("cb_fillProfile"); } catch {}
    if (!want) return;
    fillGuideRef.current = true;
    const k = BOX_ORDER.find(b => !boxFilled(b));   // 先頭から最初の未入力
    if (k) setEditBox(k);
  }, [loading]);   // eslint-disable-line react-hooks/exhaustive-deps -- 読み込み完了の1回だけ
  // 保存失敗を運営が追えるように記録（app_errors・システムページに出る）。失敗しても保存フローは妨げない
  const logSaveError = (msg) => {
    try {
      supabase.from("app_errors").insert({
        level: "error", source: "client", component: "EmployerProfileEdit", action: "profile_save",
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
      // 自由記述は、承認済み値と異なるキーだけを texts_pending に積む。
      // 2026-08-14の承認プロセス削除以降は、DBトリガー（trg_ep_z_publish_texts）が保存の瞬間に
      // 公開列へ畳む＝運営の承認を待たず即公開（NG検査＝電話・メール・URLはトリガー側で拒否）
      const desiredTexts = {
        owner_comment: ownerComment || "", intro_path: introPath || "", intro_joy: introJoy || "",
        intro_crops: introCrops || "", intro_atmosphere: introAtmosphere || "", intro_message: introMessage || "",
        unique_point: uniquePoint || "", always_do: alwaysDo || "", break_style: breakStyle || "",
        transport_area: hasTransport ? (transportArea || "") : "",
        commute_allowance_detail: hasCommuteAllowance ? (commuteAllowanceDetail || "") : "",
        supplies_cap: employerPaysSupplies ? (suppliesCap.trim() || "") : "",
      };
      // 空にした項目はその場で公開列を空にする（2026-08-03たきと指示「入力項目を空にするなら
      // 審査は必要ない」の名残）。承認プロセス削除後はどちらの経路でも即公開＝結果は同じ
      const { pending: textsPending, cleared: clearedTexts } = splitTextsForReview(desiredTexts, approvedTextsRef.current);
      // texts_pending 経由は employer_profiles 専用（このテーブルにだけ公開列へ畳むトリガーがある）。
      // 別テーブル（委託＝管理者専用レーン）は畳む相手がおらず pending が永久に滞留するため、
      // 自由記述を本欄へ直接保存する。※変数名の reviewFlow は審査時代の名残
      const reviewFlow = table === "employer_profiles";
      const payload = {
        auth_id: session.user.id,
        // 表示名(nickname)は既存の値を尊重し、空のときだけ氏名・名称で埋める（チャット等の「〇〇さん」が空にならないように）
        nickname: (nickname.trim() || recruiterName.trim()), pr: pr.trim(),
        place_zip: placeZip.trim(), place_prefecture: placePref.trim(), place_city: placeCity.trim(),
        place_town: placeTown.trim(), place_address: placeAddr.trim(),
        has_transport: hasTransport, has_parking: hasParking, has_commute_allowance: hasCommuteAllowance,
        has_bonus: hasBonus, has_raise: hasRaise, has_severance_pay: hasSeverancePay,
        employer_pays_supplies: employerPaysSupplies, accessory_ok: accessoryOk,
        parking_capacity: hasParking && parkingCapacity !== "" ? Number(parkingCapacity) : null,
        // 住所・所在地：分割値をそのまま保存し、表示用の1行（recruiter_address）は合成して保存（2026-08-01）。
        // 分割欄が全て空の既存利用者は composeRecruiterAddress が旧1行値を返す＝消えない
        recruiter_name: recruiterName.trim(), recruiter_name_kana: recruiterNameKana.trim(),
        recruiter_address: composeRecruiterAddress(), recruiter_contact: recruiterContact.trim(),
        // 受動喫煙：「あり」以外を選んだら場所の記述は保存しない（選び直しの残骸を残さない）
        smoking_policy: smokingPolicy || null,
        smoking_area: smokingPolicy === "喫煙場所あり" ? smokingArea.trim() : "",
        recruiter_zip: recruiterZip.trim(), recruiter_prefecture: recruiterPref.trim(),
        recruiter_city: recruiterCity.trim(), recruiter_address_detail: recruiterDetail.trim(),
        interaction_style: interactionStyle || null,
        teaching_style: teachingStyle || null, chat_style: chatStyle || null, question_style: questionStyle || null,
        ...(reviewFlow ? {
          ...clearedTexts, // 空にした項目は即その場で消す（審査を通さない）
          texts_pending: textsPending,
          texts_submitted_at: Object.keys(textsPending).length > 0 ? new Date().toISOString() : null,
          // 再提出で修正依頼フラグ（赤帯）を解除（2026-07-19）
          ...(Object.keys(textsPending).length > 0 ? { texts_revision_requested_at: null } : {}),
        } : {
          ...desiredTexts,
          texts_pending: {},
          texts_submitted_at: null,
        }),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from(table).upsert(payload, { onConflict: "auth_id" });
      setSaving(false);
      if (!error) {
        // 即反映した空欄は「承認済みの控え」も空にする（次の保存で再び差分と見なさないため）
        Object.keys(clearedTexts).forEach(k => { approvedTextsRef.current[k] = ""; });
        // 名刺裏面・確認ページが読むキャッシュ（farm:empMini＝FarmerDashboard/LandingFlowの正本）へ
        // 保存内容を即時反映（2026-08-14たきと報告「問いかけも保存しても反映されない」の修理）。
        // 自由記述は保存＝即公開（trg_ep_z_publish_texts）ので、公開後の姿＝desiredTexts で写す。
        // キャッシュが無い時は何もしない＝次の画面が新規に取得する（誤った部分行を正本にしない）
        if (table === "employer_profiles") {
          try {
            const cur = getCache("farm:empMini");
            if (cur) {
              const nx = { ...cur, ...payload, ...desiredTexts, texts_pending: {}, texts_submitted_at: null };
              setCache("farm:empMini", nx); snapSet("empMini", nx);
            }
          } catch {}
        }
        setSaved(true);
        if (stay === true) {
          // 保存→次の未入力ボックスへ（全て入力済みなら閉じる・2026-07-16）。
          // BOX_ORDER外のボックス（保険=ホームから開く移植分）は次へ送らず閉じる
          const nxt = BOX_ORDER.includes(editBox) ? nextUnfilledBox(editBox) : null;
          if (nxt) setEditBox(nxt); else closeEditBox();
          setTimeout(() => setSaved(false), 2200);
        }
        else setTimeout(() => { setSaved(false); if (typeof onDone === "function") onDone(); }, 900);
      }
      else { logSaveError(error.message); alert("保存に失敗しました：" + error.message); }
    } catch (e) { setSaving(false); logSaveError(e?.message || e); alert("保存に失敗しました。"); }
  };
  // 読み込み中は編集ボックスの仮配置（2026-07-27たきと指示）。骨は固定（編集ページは常に同じ並び）
  if (loading) return <div style={{ gridColumn:"1/-1" }}><AutoSkeleton fallbackHeight={92} fallbackCount={5} /></div>;
  return (
    <div style={{ gridColumn:"1/-1", maxWidth:680 }}>
      {/* 見出し・説明文・ページ全体の保存は削除済み（2026-07-25／2026-08-03）。
          プレビューは運営チャットと同じ浮遊ボックスへ移植（2026-08-03たきと指示）＝下部に固定・
          スクロールで格納（cb-float-box の作法をそのまま使う）。ページ先頭の行は無くなった */}
      <button onClick={()=>setShowPreview(true)} className="f-sans cb-float-box"
        style={{ position:"fixed", right:12, bottom:"calc(64px + 12px + env(safe-area-inset-bottom, 0px))", zIndex:1200, display:"flex", alignItems:"center", gap:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"10px 14px", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.15)" }}>
        <span style={{ fontSize:18, lineHeight:1 }}>👀</span>
        <span style={{ fontSize:13, fontWeight:700, color:"#222" }}>プレビュー</span>
      </button>

      {/* ═══ ボックス格子（働き手編集ページと全く同じ様式・タップでモーダル編集・2026-07-14） ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {[
          // req:true=看板の核（未入力なら浮遊アニメ）。それ以外は任意=未入力でも赤影のみ（2026-07-16）
          // 枠と値の色は AC（雇い手=緑／委託レーンのブラック世界=#111111）＝いまどちらの面にいるかが枠で分かる
          // （2026-08-19たきと指示「各カードの枠に色を配色」。ブラックの世界に役割色は持ち込まない・2026-07-31）
          // カードの絵文字・アバターのアイコンは削除＝テキストのみ（2026-08-14たきと指示）
          { k:"avatar",   l:"ロゴ・アイコン", v: avatarUrl ? "設定済み" : "" }, // 義務化解除（2026-07-25たきと指示）＝任意扱い（未入力は静止赤影のみ）
          { k:"nickname", l:"氏名・名称",     req:true, v: recruiterName },
          { k:"place",    l:"住所・所在地",   req:true, v: composeRecruiterAddress() },
          { k:"perks",    l:"待遇",           v: perksOn.join("・") },
          { k:"recruiter", l:"連絡先",         req:true, v: recruiterContact },
          // 緊急連絡先（2026-08-03）：別テーブル保存。カードのサマリーは emgSummary（2026-08-14修理）
          { k:"emergency", l:"緊急連絡先",     v: emgSummary },
          { k:"intro",    l:"代表より",       v: introFilled > 0 ? `${introFilled}件記入` : "" },
          { k:"ask",      l:"問いかけ",       v: askFilled > 0 ? `${askFilled}件記入` : "" },
          { k:"style",    l:"関わり方",       v: styleAnswered.join("・") },
        ].filter(b => !black || !["intro","ask","style"].includes(b.k)).map(b => (
          // 未入力ボックスは赤影アニメで促す（2026-07-16）。ロゴ・アイコンだけ1行まるごと（2026-08-14たきと指示）
          <button key={b.k} onClick={()=>setEditBox(b.k)} className={"f-sans" + (b.v ? "" : (b.req ? " cb-urgent-card" : " cb-urgent-still"))} style={{ background:"#fff", border: "1px solid " + AC, borderRadius:20, padding:"20px 10px 16px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0, ...(b.k === "avatar" ? { gridColumn:"1/-1" } : {}) }}>
            {/* ロゴ・アイコンだけはアイコン本体を大きく見せる（2026-08-14たきと指示）。他カードはテキストのみ */}
            {!black && b.k === "avatar" && <Avatar url={avatarUrl} name={nickname} size={72} ring={AC} />}
            <span style={{ fontSize:14, fontWeight:700, color:"#222" }}>{b.l}</span>
            <span style={{ fontSize:11, color: b.v ? AC : "#B0B0B0", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.v || "未設定"}</span>
          </button>
        ))}
      </div>
      {saved && (
        <p className="f-sans" style={{ fontSize:12, color:AC, textAlign:"center", marginTop:14 }}>保存しました ✓</p>
      )}
      {onCancel && (
        <button onClick={onCancel} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:14, background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#717171", textDecoration:"underline" }}>プレビューに戻る</button>
      )}

      {/* ═══ 編集モーダル（各ボックスの中身。保存はモーダル内の「保存する」＝全項目upsert） ═══ */}
      {/* document.bodyへポータル（2026-08-01）：祖先がtransformを持つとfixedの基準がその祖先になり、
          オーバーレイが画面下端まで届かず白い帯が出る（AdminJobPreviewと同じ不具合・同じ根治法） */}
      {editBox && createPortal(
      /* cb-lock-scroll＝展開中は背後ページのスクロールを固定し、下部バー・浮遊☰・役割トグルを隠す
         （2026-08-01たきと指示「ボックスが前面・展開中は画面スクロール停止」・FarmerDashboardの各シートと同作法） */
      <div onClick={closeEditBox} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 16px", animation:"fadeIn .2s ease" }}>{/* 上下40pxの余白を残して中央（2026-08-01たきと指示・30px→40px）。maxHeight:100%＝余白を差し引いた高さが上限 */}
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:520, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
      {/* ✕は削除（2026-08-14たきと指示）＝閉じるはボックス外タップ（overlayのonClick=closeEditBox・内側はstopPropagation） */}

      {editBox==="avatar" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>ロゴ・アイコン</label>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid " + AC, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
          <Avatar url={avatarUrl} name={nickname} size={64} bg={black ? "#111111" : undefined} />
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
      {/* 農園名から氏名・名称に差し替え（2026-07-27たきと指示）。労働者の募集広告に必要な明示事項なので、
          求人ページの「募集者情報」に出る。個人なら氏名、法人・屋号があればその名称 */}
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>氏名・名称</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>
        労働者の募集広告には募集者の氏名または名称の明示が必要です。<b>あなたの求人ページに「募集者情報」として表示されます。</b>
        新規登録で入力した内容を初期値にしています。
      </p>
      <button onClick={carryFromAccount} disabled={carrying} className="f-sans"
        style={{ width:"100%", padding:"11px", marginBottom:14, fontSize:13, fontWeight:700, background:"#fff", color:AC, border:"1px solid " + AC, borderRadius:10, cursor:"pointer" }}>
        {carrying ? <>読み込み中<Dots /></> : "新規登録の内容を引き継ぐ"}
      </button>
      <input value={recruiterName} onChange={e=>setRecruiterName(e.target.value)} placeholder="例：山田 太郎 ／ 千歳農園" maxLength={100}
        className="field f-sans" style={{ width:"100%", fontSize:16, boxSizing:"border-box", marginBottom:12 }} />
      {/* フリガナ（2026-08-03たきと指示・任意）。新規登録にカナは無いため引き継ぎ対象外＝本人入力 */}
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>フリガナ</label>
      <input value={recruiterNameKana} onChange={e=>setRecruiterNameKana(e.target.value)} placeholder="例：ヤマダ タロウ ／ チトセノウエン" maxLength={100}
        className="field f-sans" style={{ width:"100%", fontSize:16, boxSizing:"border-box", marginBottom:16 }} />
      </>)}

      {editBox==="place" && (<>
      {/* 作業場所（4分割）から住所・所在地に差し替え（2026-07-27たきと指示）。
          労働者の募集広告に必要な明示事項なので、求人ページの「募集者情報」に出る。
          求人ごとの集合場所は求人作成フローで入力する（ここは募集者＝あなたの所在地） */}
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>住所・所在地</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>
        労働者の募集広告には住所・所在地の明示が必要です。<b>あなたの求人ページに「募集者情報」として表示されます。</b>
        新規登録で入力した住所を初期値にしています。
      </p>
      <button onClick={carryFromAccount} disabled={carrying} className="f-sans"
        style={{ width:"100%", padding:"11px", marginBottom:14, fontSize:13, fontWeight:700, background:"#fff", color:AC, border:"1px solid " + AC, borderRadius:10, cursor:"pointer" }}>
        {carrying ? <>読み込み中<Dots /></> : "新規登録の内容を引き継ぐ"}
      </button>
      {/* 分割入力（2026-08-01たきと指示）：郵便番号→自動で都道府県・市区町村（求人フローstep3と同じ流儀）。
          保存時に1行へ合成して recruiter_address に入れる＝表示側は無改修 */}
      {recruiterAddress.trim() && !(recruiterZip + recruiterPref + recruiterCity + recruiterDetail).trim() && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", background:"#F7F7F7", borderRadius:8, padding:"8px 10px", margin:"0 0 12px", lineHeight:1.6 }}>現在の登録内容：{recruiterAddress}<br />郵便番号から入力し直すと、分割した内容に置き換わります。</p>
      )}
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>郵便番号</label>
      <div style={{ display:"flex", gap:8, alignItems:"stretch", marginBottom:10 }}>
        <input value={recruiterZip}
          onChange={e => { const v = e.target.value; setRecruiterZip(v); if (v.replace(/[^0-9]/g, "").length === 7) searchRecruiterZip(v); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchRecruiterZip(); } }}
          placeholder="例：779-3401" inputMode="numeric" maxLength={8}
          className="field f-sans" style={{ flex:1, minWidth:0, fontSize:16, marginBottom:0, boxSizing:"border-box" }} />
        {/* onClick={searchRecruiterZip} と書かないこと：Reactがイベントを第1引数で渡すため、
            それが郵便番号として解釈されてしまう（求人フローsearchZipと同じ注意） */}
        <button onClick={() => searchRecruiterZip()} disabled={rZipSearching} className="f-sans" style={{ padding:"0 14px", borderRadius:8, border:"1px solid #DADADA", background:"#fff", color:"#222", fontSize:13, fontWeight:600, cursor: rZipSearching ? "default" : "pointer", whiteSpace:"nowrap" }}>{rZipSearching ? <>検索中<Dots /></> : "住所を検索"}</button>
      </div>
      {rZipError && <p className="f-sans" style={{ fontSize:12, color:"#E53935", margin:"0 0 10px" }}>{rZipError}</p>}
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>都道府県</label>
      <input value={recruiterPref} readOnly placeholder="例：徳島県" className="field f-sans"
        style={{ width:"100%", fontSize:16, marginBottom:10, boxSizing:"border-box", background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }} />
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>市区町村</label>
      <input value={recruiterCity} readOnly placeholder="例：吉野川市" className="field f-sans"
        style={{ width:"100%", fontSize:16, marginBottom:4, boxSizing:"border-box", background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }} />
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 10px", lineHeight:1.5 }}>都道府県・市区町村は郵便番号から自動で入力されます。誤りがある場合は郵便番号を修正してください</p>
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>町名・番地・建物名</label>
      <input value={recruiterDetail} onChange={e=>setRecruiterDetail(e.target.value)} placeholder="例：山川町〇〇1-2-3" maxLength={200}
        className="field f-sans" style={{ width:"100%", fontSize:16, marginBottom:10, boxSizing:"border-box" }} />
      {!!(recruiterZip + recruiterPref + recruiterCity + recruiterDetail).trim() && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 16px", lineHeight:1.6 }}>求人ページの表示：{composeRecruiterAddress()}</p>
      )}
      </>)}

      {editBox==="perks" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>求人に共通する条件</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:8, lineHeight:1.6 }}>ここで設定した内容は、あなたが出す全ての求人に共通して表示されます。</p>
      <div style={{ marginBottom:16, borderTop:"1px solid #EBEBEB" }}>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch accent={AC} label="送迎" checked={hasTransport} onChange={setHasTransport} />
          {hasTransport && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={transportArea} onChange={e=>setTransportArea(e.target.value)} placeholder="例：吉野川市内" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch accent={AC} label="駐車場" checked={hasParking} onChange={setHasParking} />
          {hasParking && (
            <div style={{ marginLeft:16, paddingBottom:12, display:"flex", alignItems:"center", gap:8 }}>
              <input type="number" value={parkingCapacity} onChange={e=>setParkingCapacity(e.target.value)} placeholder="3" className="field f-sans" style={{ width:80, fontSize:13 }} />
              <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>台まで駐車できます</span>
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch accent={AC} label="通勤手当" checked={hasCommuteAllowance} onChange={setHasCommuteAllowance} />
          {hasCommuteAllowance && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={commuteAllowanceDetail} onChange={e=>setCommuteAllowanceDetail(e.target.value)} placeholder="例：上限500円 / 実費支給" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}><ToggleSwitch accent={AC} label="賞与" checked={hasBonus} onChange={setHasBonus} /></div>
        {/* 昇給・退職手当（2026-08-19たきと指示）：賞与と並ぶ労働条件の明示事項。有無だけを持つ */}
        <div style={{ borderBottom:"1px solid #EBEBEB" }}><ToggleSwitch accent={AC} label="昇給" checked={hasRaise} onChange={setHasRaise} /></div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}><ToggleSwitch accent={AC} label="退職手当" checked={hasSeverancePay} onChange={setHasSeverancePay} /></div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch accent={AC} label="持ち物は農家負担" checked={employerPaysSupplies} onChange={setEmployerPaysSupplies} />
          {employerPaysSupplies && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={suppliesCap} onChange={e=>setSuppliesCap(e.target.value)} placeholder="上限の設定（例：上限1,000円まで / 軍手・長靴のみ）" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}><ToggleSwitch accent={AC} label="アクセサリーOK" checked={accessoryOk} onChange={setAccessoryOk} /></div>
        {/* 受動喫煙の状況（2026-08-19たきと指示「他の待遇欄と同じ構造に」・元は2026-08-03のピル2択）：
            見た目・並びは他の待遇行と同じトグル。ONで喫煙場所ありとその場所、OFFで禁煙。
            ★ただし三つ目の状態＝「未設定」を残す（トグルはON/OFFしか表せないため、触るまで値を書かない）。
            掲載時のDBトリガーが smoking_policy の空を弾く壁は、この未設定があって初めて効く＝
            OFF＝禁煙として既定で保存すると、就業場所の実態と違う申告が黙って入り、壁も常に通ってしまう */}
        <div>
          <ToggleSwitch accent={AC} label="喫煙場所あり" checked={smokingPolicy === "喫煙場所あり"}
            onChange={(v)=>setSmokingPolicy(v ? "喫煙場所あり" : "禁煙（喫煙場所なし）")} />
          {smokingPolicy === "喫煙場所あり" && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={smokingArea} onChange={e=>setSmokingArea(e.target.value)} placeholder="喫煙場所（例：屋外の休憩小屋の横）" maxLength={100}
                className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
          {smokingPolicy === "禁煙（喫煙場所なし）" && (
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px 16px", lineHeight:1.6 }}>求人には「禁煙（喫煙場所なし）」と表示されます。</p>
          )}
          {!smokingPolicy && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <p className="f-sans" style={{ fontSize:12, color:"#C77700", margin:"0 0 8px", lineHeight:1.6 }}>
                未設定です。就業場所での受動喫煙の状況は求人の明示事項なので、どちらかを選ぶまで求人を掲載できません。
              </p>
              <button type="button" onClick={()=>setSmokingPolicy("禁煙（喫煙場所なし）")} className="f-sans"
                style={{ padding:"8px 12px", fontSize:13, fontWeight:700, background:"#fff", color:AC, border:"1px solid " + AC, borderRadius:10, cursor:"pointer" }}>
                禁煙（喫煙場所なし）にする
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ marginBottom:16 }} />
      </>)}

      {/* 旧「📝農園の紹介を書く」アコーディオンは廃止（2026-07-14）：中身を農園紹介/問いかけ/関わり方の各ボックスに分割 */}
      {/* 従業員数ボックスは削除（2026-08-01たきと指示）。DB列staff_countと既存データは残置 */}

      {editBox==="emergency" && (<>
      {/* 緊急連絡先（2026-08-03たきと指示）：採用成立後に相手方へのみ開示。保存はこの部品の中で完結
          （emergency_contacts テーブル・self-only）ので、下の共通「保存する」は押さなくてよい */}
      <EmergencyContactBox accent={AC} onSaved={({ name, relation }) => setEmgSummary([relation, name].filter(x => (x || "").trim()).join("・"))} />
      <div style={{ marginBottom:8 }} />
      </>)}

      {editBox==="recruiter" && (<>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>募集者の情報</label>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:14, lineHeight:1.6 }}>
              労働者の募集広告には、募集者の氏名または名称・住所・連絡先の明示が必要です。
              <b>入力した内容は、あなたの求人ページに「募集者情報」として表示されます。</b>
            </p>
            <button onClick={carryFromAccount} disabled={carrying} className="f-sans"
              style={{ width:"100%", padding:"11px", marginBottom:14, fontSize:13, fontWeight:700, background:"#fff", color:AC, border:"1px solid " + AC, borderRadius:10, cursor:"pointer" }}>
              {carrying ? <>読み込み中<Dots /></> : "新規登録の内容を引き継ぐ"}
            </button>
            {/* 氏名・名称は「✏️氏名・名称」ボックスへ移した（2026-07-27・重複解消） */}
            {/* 住所・所在地は「📍住所・所在地」ボックスへ移した（2026-07-27・重複解消） */}
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>連絡先</label>
            <input value={recruiterContact} onChange={e=>setRecruiterContact(e.target.value)} placeholder="例：088-000-0000" maxLength={100}
              className="field f-sans" style={{ fontSize:16, width:"100%", boxSizing:"border-box", marginBottom:8 }} />
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:16, lineHeight:1.7 }}>
              電話番号やメールアドレスなど、応募者が連絡できる手段を書いてください。
              日々のやり取りは引き続きサイト内チャットをお使いいただけます。
            </p>
      </>)}

      {editBox==="intro" && (<>
            {/* 農園紹介→代表よりに改名・代表よりの入力を最上段へ（2026-07-16） */}
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>代表より</label>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>働き手への一言と、書きたいお題だけ記入してください（任意）</p>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>代表より（任意）</label>
            <textarea
              value={ownerComment}
              onChange={e => setOwnerComment(e.target.value)}
              maxLength={1000}
              style={{ background:"#fff", color:"#222", width:"100%", minHeight:100, padding:"12px", fontSize:14, lineHeight:1.7, border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit", marginBottom:4 }}
            />
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:0, marginBottom:16, textAlign:"right" }}>{ownerComment.length} / 1000</p>
            <div className="employer-intro-grid" style={{ marginBottom:16 }}>
              {[
                { label:"就農するまで", value:introPath, set:setIntroPath },
                { label:"いま楽しいこと", value:introJoy, set:setIntroJoy },
                { label:"どんな作物を、どんな想いで", value:introCrops, set:setIntroCrops },
                { label:"職場の雰囲気", value:introAtmosphere, set:setIntroAtmosphere },
                { label:"初めての人へのメッセージ", value:introMessage, set:setIntroMessage },
              ].map((topic, i) => (
                <div key={i}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>{topic.label}（任意）</label>
                  <textarea
                    value={topic.value}
                    onChange={e => topic.set(e.target.value)}
                    maxLength={1000}
                    style={{ background:"#fff", color:"#222", width:"100%", minHeight:100, padding:"12px", fontSize:14, lineHeight:1.7, border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
                  />
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4, textAlign:"right" }}>{topic.value.length} / 1000</p>
                </div>
              ))}
            </div>
      </>)}

      {editBox==="ask" && (<>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>働き手への問いかけ</label>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>書きたい問いだけ、記入してください（任意）</p>
            <div className="employer-intro-grid" style={{ marginBottom:16 }}>
              {[
                { label:"うちの畑・農園のユニークなところ", placeholder:"例：吉野川の川霧が育てるナスです", value:uniquePoint, set:setUniquePoint },
                { label:"働きに来た人に、いつもしていること", placeholder:"例：最初に全体をひと回り案内します", value:alwaysDo, set:setAlwaysDo },
                { label:"休憩とお茶はどうしてる？", placeholder:"例：10時と15時に冷たいお茶を出します", value:breakStyle, set:setBreakStyle },
              ].map((topic, i) => (
                <div key={i}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>{topic.label}（任意）</label>
                  <textarea
                    value={topic.value}
                    onChange={e => topic.set(e.target.value)}
                    placeholder={topic.placeholder}
                    maxLength={1000}
                    style={{ background:"#fff", color:"#222", width:"100%", minHeight:100, padding:"12px", fontSize:14, lineHeight:1.7, border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
                  />
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4, textAlign:"right" }}>{topic.value.length} / 1000</p>
                </div>
              ))}
            </div>
      </>)}

      {editBox==="style" && (<>
            {/* 関わり方の質問セット（2026-08-14たきと指示で4問に拡充）。1問=1択・もう一度タップで解除。
                答えた質問だけがプレビューのチップに出る（未回答は出ない＝ダミー禁止） */}
            <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:14, lineHeight:1.6 }}>
              答えたい質問だけ選んでください（任意）。答えた内容はプロフィールにチップで表示されます。
            </p>
            {HOST_STYLE_QUESTIONS.map(q => {
              const cur = styleLocal[q.k];
              const set = { interaction_style: setInteractionStyle, teaching_style: setTeachingStyle, chat_style: setChatStyle, question_style: setQuestionStyle }[q.k];
              return (
                <div key={q.k} style={{ marginBottom:16 }}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>{q.label}（任意）</label>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {q.options.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set(c => c === opt.value ? "" : opt.value)}
                        className="f-sans"
                        style={{
                          padding:"8px 16px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                          border: cur === opt.value ? "1.5px solid " + AC : "1px solid #EBEBEB",
                          background: cur === opt.value ? ACS : "#fff",
                          color: cur === opt.value ? AC : "#222",
                        }}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>
              );
            })}
      </>)}

      {/* モーダルフッター：保存する（全項目upsert）→格子に戻る。
          緊急連絡先だけは別テーブル（emergency_contacts）で、ボックス内の「保存する」がDBに書く。
          両方出すと同じ文言のボタンが2つ並ぶので、ここでは出さない（2026-08-05たきと指示） */}
      {editBox !== "emergency" && (
        <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, marginTop:4 }}>{saving ? <>保存中<Dots /></> : "保存する"}</button>
      )}
      </div>
      </div>
      , document.body)}

      {/* ═══ プレビューモーダル（保存済みの内容を表示） ═══ */}
      {showPreview && (
        <div onClick={()=>setShowPreview(false)} className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
          {/* 求人・働き手プレビューと同型のボックス：ポップアップ0.8秒・下限=下部フッター+10px（2026-07-16） */}
          {/* touchAction/overscrollBehavior: iOSでスクロールが背面ページに奪われるのを防ぐ（2026-07-14） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"calc(48px + env(safe-area-inset-top, 0px))", bottom:"calc(48px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:"20px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
            <FarmerProfilePreview me={me} table={table} withTrust={table === "employer_profiles"} black={black} />
          </div>
        </div>
      )}
    </div>
  );
}

// プレビューの統一（2026-07-25たきと指示）：実際の求人詳細で雇い手アイコンをタップした時に出る
// EmployerPreviewSheet（App.jsx）と同一の情報・構造（農園紹介タイトル→信頼カード→待遇チップ→紹介お題）で表示する。
// データは本人行（employer_profiles）＋employer_trust_info＝働き手が見るものと同じ形。項目タップ編集は廃止（編集はボックス格子から）
function FarmerProfilePreview({ me, table = "employer_profiles", withTrust = true, black = false }) {
  const [data, setData] = useState(null);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data: ep } = await supabase.from(table).select("*").eq("auth_id", session.user.id).maybeSingle();
        if (ep) setData(ep);
        if (withTrust) {
          const { data: t } = await supabase.rpc('employer_trust_info', { p_farmer_id: session.user.id });
          setTrust(t && t.ok ? t : null);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);
  // 読み込み中は編集ボックスの仮配置（2026-07-27たきと指示）。骨は固定（編集ページは常に同じ並び）
  if (loading) return <div style={{ gridColumn:"1/-1" }}><AutoSkeleton fallbackHeight={92} fallbackCount={5} /></div>;
  const topics = (data && !black) ? farmIntroTopics(data) : []; // black（委託）は代表よりを出さない（2026-07-31たきと指示）
  return (
    <div style={{ gridColumn:"1/-1", maxWidth:400 }}>
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{data?.nickname ? `${data.nickname}の農園紹介` : "農園紹介"}</p>
      {data ? (
        <>
          <FarmerTrustCard profile={data} trust={trust} black={black} />
          {perkBadges(data).length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:14 }}>
              {perkBadges(data).map(b => (
                <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{black ? b.replace(/^\S+\s/, "") : b}</span>
              ))}
            </div>
          )}
          {topics.length > 0 && (
            <div style={{ display:"grid", gap:10, marginTop:16 }}>
              {topics.map(t => (
                <div key={t.label}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{t.label}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この農家のプロフィールは未設定です</p>
      )}
    </div>
  );
}
