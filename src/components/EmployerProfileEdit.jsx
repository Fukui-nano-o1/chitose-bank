// 分割3-B（2026-07-25）：App.jsxから移動。雇い手プロフィール編集＋プレビュー（FarmerProfilePreviewは本ファイル専用）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { uploadAvatarResilient } from "../lib/avatarUpload";
import { INTERACTION_STYLE_OPTIONS, farmHostQa } from "../lib/utils";
import { Avatar } from "./ui";
import { FarmerTrustCard } from "./TrustCards";
import { ToggleSwitch } from "./ToggleSwitch";

export function EmployerProfileEdit({ me, onDone, onCancel }) {
  const [nickname, setNickname] = useState("");
  const [pr, setPr] = useState(""); // 紹介・PRボックスは廃止（2026-07-16）。既存データ保全のためstateと保存は温存
  const [avatarUrl, setAvatarUrl] = useState("");
  // 作業場所（集合場所の既定値・紹介PRボックスの差し替え・2026-07-16）。求人フローstep3の復元ボタンがここを読む
  const [placeZip, setPlaceZip] = useState("");
  const [placePref, setPlacePref] = useState("");
  const [placeCity, setPlaceCity] = useState("");
  const [placeTown, setPlaceTown] = useState("");
  const [placeAddr, setPlaceAddr] = useState("");
  const [placeZipBusy, setPlaceZipBusy] = useState(false);
  const [placeZipError, setPlaceZipError] = useState("");
  const approvedTextsRef = useRef({}); // 自由記述の承認済み（本公開）値の控え。保存時の差分判定に使う（2026-07-16）
  const searchPlaceZip = async () => {
    const zip = placeZip.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setPlaceZipError("郵便番号は7桁で入力してください"); return; }
    setPlaceZipBusy(true); setPlaceZipError("");
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const data = await res.json();
      if (data.status === 200 && data.results) {
        const r = data.results[0];
        setPlacePref(r.address1); setPlaceCity(r.address2); setPlaceTown(r.address3 || "");
      } else { setPlaceZipError("郵便番号が見つかりませんでした"); }
    } catch { setPlaceZipError("検索に失敗しました。通信環境をご確認ください"); }
    setPlaceZipBusy(false);
  };
  const [hasTransport, setHasTransport] = useState(false);
  const [hasParking, setHasParking] = useState(false);
  const [hasCommuteAllowance, setHasCommuteAllowance] = useState(false);
  const [hasBonus, setHasBonus] = useState(false);
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
  const [staffCount, setStaffCount] = useState("");
  const [uniquePoint, setUniquePoint] = useState("");
  const [alwaysDo, setAlwaysDo] = useState("");
  const [breakStyle, setBreakStyle] = useState("");
  const [interactionStyle, setInteractionStyle] = useState("");
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
        const { data } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) {
          setNickname(data.nickname || ""); setPr(data.pr || ""); setAvatarUrl(data.avatar_url || "");
          setPlaceZip(data.place_zip || ""); setPlacePref(data.place_prefecture || ""); setPlaceCity(data.place_city || "");
          setPlaceTown(data.place_town || ""); setPlaceAddr(data.place_address || "");
          setHasTransport(data.has_transport ?? false);
          setHasParking(data.has_parking ?? false);
          setHasCommuteAllowance(data.has_commute_allowance ?? false);
          setHasBonus(data.has_bonus ?? false);
          setEmployerPaysSupplies(data.employer_pays_supplies ?? false);
          setAccessoryOk(data.accessory_ok ?? false);
          setParkingCapacity(data.parking_capacity != null ? String(data.parking_capacity) : "");
          // 自由記述は審査待ち（texts_pending）優先で編集欄へ＝自分が書いた最新が見える。承認済み値は差分判定用に控える（2026-07-16）
          const tp = data.texts_pending || {};
          approvedTextsRef.current = {
            owner_comment: data.owner_comment ?? "", intro_path: data.intro_path ?? "", intro_joy: data.intro_joy ?? "",
            intro_crops: data.intro_crops ?? "", intro_atmosphere: data.intro_atmosphere ?? "", intro_message: data.intro_message ?? "",
            unique_point: data.unique_point ?? "", always_do: data.always_do ?? "", break_style: data.break_style ?? "",
            transport_area: data.transport_area ?? "", commute_allowance_detail: data.commute_allowance_detail ?? "", supplies_cap: data.supplies_cap ?? "",
          };
          setCommuteAllowanceDetail(tp.commute_allowance_detail ?? (data.commute_allowance_detail || ""));
          setSuppliesCap(tp.supplies_cap ?? (data.supplies_cap || ""));
          setTransportArea(tp.transport_area ?? (data.transport_area || ""));
          setIntroPath(tp.intro_path ?? data.intro_path ?? "");
          setIntroJoy(tp.intro_joy ?? data.intro_joy ?? "");
          setIntroCrops(tp.intro_crops ?? data.intro_crops ?? "");
          setIntroAtmosphere(tp.intro_atmosphere ?? data.intro_atmosphere ?? "");
          setIntroMessage(tp.intro_message ?? data.intro_message ?? "");
          setOwnerComment(tp.owner_comment ?? data.owner_comment ?? "");
          setStaffCount(data.staff_count != null ? String(data.staff_count) : "");
          setUniquePoint(tp.unique_point ?? data.unique_point ?? "");
          setAlwaysDo(tp.always_do ?? data.always_do ?? "");
          setBreakStyle(tp.break_style ?? data.break_style ?? "");
          setInteractionStyle(data.interaction_style ?? "");
          // 既に1つでも入力済みなら初期状態でアコーディオンを開く（値が見えず消えたと誤解されるのを防ぐ）
          const hasIntroContent = !!(data.intro_path || data.intro_joy || data.intro_crops || data.intro_atmosphere || data.intro_message || data.owner_comment || (data.staff_count != null && data.staff_count !== "") || data.unique_point || data.always_do || data.break_style || data.interaction_style);
          if (hasIntroContent) setIntroOpen(true);
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
        const { data: olds } = await supabase.storage.from('avatars').list("employer/" + session.user.id);
        if (olds && olds.length > 0) {
          const paths = olds.map(f => "employer/" + session.user.id + "/" + f.name);
          await supabase.storage.from('avatars').remove(paths);
        }
      } catch {}
      const path = "employer/" + session.user.id + "/avatar.jpg";
      const upErr = await uploadAvatarResilient("employer/" + session.user.id, blob);
      if (upErr) { setUploading(false); alert("アップロードに失敗しました：" + upErr.message + "\n通信環境を確認して、もう一度お試しください。"); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = (urlData?.publicUrl || '') + "?t=" + Date.now();
      await supabase.from('employer_profiles').upsert({ auth_id: session.user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
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
      const { data: files } = await supabase.storage.from('avatars').list("employer/" + session.user.id);
      if (files && files.length > 0) {
        const paths = files.map(f => "employer/" + session.user.id + "/" + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from('employer_profiles').upsert({ auth_id: session.user.id, avatar_url: '', updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl('');
    } catch { alert("削除に失敗しました。"); }
    setUploading(false);
  };
  // ホームの「🛡 保険の準備」から来た時は、その場で保険ボックスを開く（移植・2026-07-23）
  const [editBox, setEditBox] = useState(null);
  const [showPreview, setShowPreview] = useState(false); // 右上「プレビュー」→FarmerProfilePreviewをモーダル展開
  const [editFromPreview, setEditFromPreview] = useState(false); // プレビュー発の編集：閉じたらプレビューへ戻る（往復・働き手側と同構造）
  const closeEditBox = () => {
    setEditBox(null);
    if (editFromPreview) { setEditFromPreview(false); setShowPreview(true); }
  };
  // 保存→次の未入力ボックスを自動展開（全て入力されるまでループ・2026-07-16・働き手側と同構造）
  // 保険の準備はホーム（面接の質問集の下）へ移植したため、格子の自動フロー(BOX_ORDER)には載せない（2026-07-23）
  const BOX_ORDER = ["avatar","nickname","place","perks","staff","intro","ask","style"];
  const boxFilled = (k) => (
    k === "avatar" ? !!avatarUrl : k === "nickname" ? !!nickname.trim() : k === "place" ? !!placeCity.trim()
    : k === "perks" ? perksOn.length > 0
    : k === "staff" ? staffCount !== "" : k === "intro" ? introFilled > 0
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
  const save = async (stay = false) => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // 自由記述は直接公開しない（2026-07-16・憲法5条）：承認済み値と異なるキーだけをtexts_pendingに積み、運営承認で公開される
      const desiredTexts = {
        owner_comment: ownerComment || "", intro_path: introPath || "", intro_joy: introJoy || "",
        intro_crops: introCrops || "", intro_atmosphere: introAtmosphere || "", intro_message: introMessage || "",
        unique_point: uniquePoint || "", always_do: alwaysDo || "", break_style: breakStyle || "",
        transport_area: hasTransport ? (transportArea || "") : "",
        commute_allowance_detail: hasCommuteAllowance ? (commuteAllowanceDetail || "") : "",
        supplies_cap: employerPaysSupplies ? (suppliesCap.trim() || "") : "",
      };
      const textsPending = {};
      Object.keys(desiredTexts).forEach(k => { if (desiredTexts[k] !== (approvedTextsRef.current[k] ?? "")) textsPending[k] = desiredTexts[k]; });
      const { error } = await supabase.from("employer_profiles").upsert({
        auth_id: session.user.id, nickname: nickname.trim(), pr: pr.trim(),
        place_zip: placeZip.trim(), place_prefecture: placePref.trim(), place_city: placeCity.trim(),
        place_town: placeTown.trim(), place_address: placeAddr.trim(),
        has_transport: hasTransport, has_parking: hasParking, has_commute_allowance: hasCommuteAllowance,
        has_bonus: hasBonus, employer_pays_supplies: employerPaysSupplies, accessory_ok: accessoryOk,
        parking_capacity: hasParking && parkingCapacity !== "" ? Number(parkingCapacity) : null,
        staff_count: staffCount === "" ? null : Number(staffCount),
        interaction_style: interactionStyle || null,
        texts_pending: textsPending,
        texts_submitted_at: Object.keys(textsPending).length > 0 ? new Date().toISOString() : null,
        // 再提出で修正依頼フラグ（赤帯）を解除（2026-07-19）
        ...(Object.keys(textsPending).length > 0 ? { texts_revision_requested_at: null } : {}),
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      setSaving(false);
      if (!error) {
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
      else alert("保存に失敗しました：" + error.message);
    } catch { setSaving(false); alert("保存に失敗しました。"); }
  };
  if (loading) return <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  const perksOn = [hasTransport&&"送迎", hasParking&&"駐車場", hasCommuteAllowance&&"通勤手当", hasBonus&&"賞与", employerPaysSupplies&&"持ち物負担", accessoryOk&&"アクセサリーOK"].filter(Boolean);
  const introFilled = [introPath, introJoy, introCrops, introAtmosphere, introMessage, ownerComment].filter(t => t && t.trim()).length;
  const askFilled = [uniquePoint, alwaysDo, breakStyle].filter(t => t && t.trim()).length;
  return (
    <div style={{ gridColumn:"1/-1", maxWidth:680 }}>
      {/* 見出し「雇い手プロフィール」とページ全体の保存ボタンは削除（2026-07-25たきと指示・保存は各ボックスのモーダル内に一本化）。プレビューのみ残す */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:8, marginBottom:4 }}>
        <button onClick={()=>setShowPreview(true)} className="f-sans" style={{ padding:"9px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#222", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>プレビュー</button>
      </div>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>求人に掲載したとき、働き手に伝わる紹介です。タップして入力できます。</p>

      {/* ═══ ボックス格子（働き手編集ページと全く同じ様式・タップでモーダル編集・2026-07-14） ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {[
          // req:true=看板の核（未入力なら浮遊アニメ）。それ以外は任意=未入力でも赤影のみ（2026-07-16）
          { k:"avatar",   e:"🖼️", l:"ロゴ・アイコン", v: avatarUrl ? "設定済み" : "" }, // 義務化解除（2026-07-25たきと指示）＝任意扱い（未入力は静止赤影のみ）
          { k:"nickname", e:"✏️", l:"農園名",         req:true, v: nickname },
          { k:"place",    e:"📍", l:"作業場所",       req:true, v: [placePref, placeCity, placeTown].filter(Boolean).join("") },
          { k:"perks",    e:"🎁", l:"待遇",           v: perksOn.join("・") },
          { k:"staff",    e:"👥", l:"従業員数",       v: staffCount !== "" ? `${staffCount}人` : "" },
          { k:"intro",    e:"🏡", l:"代表より",       v: introFilled > 0 ? `${introFilled}件記入` : "" },
          { k:"ask",      e:"💬", l:"問いかけ",       v: askFilled > 0 ? `${askFilled}件記入` : "" },
          { k:"style",    e:"🤝", l:"関わり方",       v: (INTERACTION_STYLE_OPTIONS.find(o => o.value === interactionStyle) || {}).label || "" },
        ].map(b => (
          // 未入力ボックスは赤影アニメで促す（2026-07-16）
          <button key={b.k} onClick={()=>setEditBox(b.k)} className={"f-sans" + (b.v ? "" : (b.req ? " cb-urgent-card" : " cb-urgent-still"))} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"20px 10px 16px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0 }}>
            {b.k === "avatar" ? <Avatar url={avatarUrl} name={nickname} size={36} /> : <span style={{ fontSize:34, lineHeight:1 }}>{b.e}</span>}
            <span style={{ fontSize:14, fontWeight:700, color:"#222" }}>{b.l}</span>
            <span style={{ fontSize:11, color: b.v ? "#00A86B" : "#B0B0B0", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.v || "未設定"}</span>
          </button>
        ))}
      </div>
      {saved && (
        <p className="f-sans" style={{ fontSize:12, color:"#00A86B", textAlign:"center", marginTop:14 }}>保存しました ✓</p>
      )}
      {onCancel && (
        <button onClick={onCancel} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:14, background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#717171", textDecoration:"underline" }}>プレビューに戻る</button>
      )}

      {/* ═══ 編集モーダル（各ボックスの中身。保存はモーダル内の「保存する」＝全項目upsert） ═══ */}
      {editBox && (
      <div onClick={closeEditBox} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px 16px calc(64px + 10px + env(safe-area-inset-bottom, 0px))", animation:"fadeIn .2s ease" }}>{/* 下余白=下部フッター64px+10px：編集ボックスがフッターに重ならない（2026-07-16） */}
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:520, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
      <button onClick={closeEditBox} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer", zIndex:1 }}>✕</button>

      {editBox==="avatar" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>ロゴ・アイコン</label>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid #00A86B", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
          <Avatar url={avatarUrl} name={nickname} size={64} />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <label className="f-sans" style={{ padding:"10px 16px", border:"1px solid #EBEBEB", borderRadius:10, background:"#fff", fontSize:13, color:"#222", cursor:"pointer", textAlign:"center" }}>
            {uploading ? "処理中..." : avatarUrl ? "画像を変更" : "画像を選ぶ"}
            <input type="file" accept="image/*" onChange={handleAvatar} disabled={uploading} style={{ display:"none" }} />
          </label>
          {avatarUrl && (
            <button onClick={handleDeleteAvatar} disabled={uploading} className="f-sans" style={{ padding:"8px 16px", border:"1px solid #EBEBEB", borderRadius:10, background:"#fff", fontSize:12, color:"#717171", cursor:"pointer" }}>削除</button>
          )}
        </div>
      </div>
      </>)}

      {editBox==="nickname" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>農園名・屋号・社名</label>
      <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="例：山川ファーム / 千歳農園" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="place" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>作業場所（集合場所の既定値）</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:10, lineHeight:1.6 }}>求人作成の集合場所で「復元」を押すと、ここの住所が入ります。番地・建物名は公開されません。</p>
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>郵便番号</label>
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <input value={placeZip} onChange={e=>{ setPlaceZip(e.target.value); setPlaceZipError(""); }} placeholder="例：779-3401" className="field f-sans" style={{ flex:1, fontSize:14, marginBottom:0 }} />
        <button onClick={searchPlaceZip} disabled={placeZipBusy} className="f-sans" style={{ padding:"0 14px", borderRadius:8, border:"1px solid #DADADA", background:"#fff", color:"#222", fontSize:12, fontWeight:600, cursor: placeZipBusy ? "default" : "pointer", whiteSpace:"nowrap" }}>{placeZipBusy ? "検索中..." : "住所を検索"}</button>
      </div>
      {placeZipError && <p className="f-sans" style={{ fontSize:12, color:"#E53935", marginBottom:8 }}>{placeZipError}</p>}
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>都道府県</label>
      <input value={placePref} onChange={e=>setPlacePref(e.target.value)} placeholder="例：徳島県" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>市区町村</label>
      <input value={placeCity} onChange={e=>setPlaceCity(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>町域</label>
      <input value={placeTown} onChange={e=>setPlaceTown(e.target.value)} placeholder="例：山川町〇〇" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>番地・建物名</label>
      <input value={placeAddr} onChange={e=>setPlaceAddr(e.target.value)} placeholder="例：1-2-3 〇〇ハイツ101" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="perks" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>求人に共通する条件</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:8, lineHeight:1.6 }}>ここで設定した内容は、あなたが出す全ての求人に共通して表示されます。</p>
      <div style={{ marginBottom:16, borderTop:"1px solid #EBEBEB" }}>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="送迎" checked={hasTransport} onChange={setHasTransport} />
          {hasTransport && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={transportArea} onChange={e=>setTransportArea(e.target.value)} placeholder="例：吉野川市内" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="駐車場" checked={hasParking} onChange={setHasParking} />
          {hasParking && (
            <div style={{ marginLeft:16, paddingBottom:12, display:"flex", alignItems:"center", gap:8 }}>
              <input type="number" value={parkingCapacity} onChange={e=>setParkingCapacity(e.target.value)} placeholder="3" className="field f-sans" style={{ width:80, fontSize:13 }} />
              <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>台まで駐車できます</span>
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="通勤手当" checked={hasCommuteAllowance} onChange={setHasCommuteAllowance} />
          {hasCommuteAllowance && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={commuteAllowanceDetail} onChange={e=>setCommuteAllowanceDetail(e.target.value)} placeholder="例：上限500円 / 実費支給" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}><ToggleSwitch label="賞与" checked={hasBonus} onChange={setHasBonus} /></div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="持ち物は農家負担" checked={employerPaysSupplies} onChange={setEmployerPaysSupplies} />
          {employerPaysSupplies && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={suppliesCap} onChange={e=>setSuppliesCap(e.target.value)} placeholder="上限の設定（例：上限1,000円まで / 軍手・長靴のみ）" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div><ToggleSwitch label="アクセサリーOK" checked={accessoryOk} onChange={setAccessoryOk} /></div>
      </div>
      </>)}

      {/* 旧「📝農園の紹介を書く」アコーディオンは廃止（2026-07-14）：中身を従業員数/農園紹介/問いかけ/関わり方の各ボックスに分割 */}
      {editBox==="staff" && (<>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>従業員数（任意）</label>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
              <input type="number" value={staffCount} onChange={e=>setStaffCount(e.target.value)} placeholder="例：3" className="field f-mono" style={{ fontSize:16, maxWidth:100 }} />
              <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>人</span>
            </div>
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
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>作業中の関わり方（任意）</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
              {INTERACTION_STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInteractionStyle(cur => cur === opt.value ? "" : opt.value)}
                  className="f-sans"
                  style={{
                    padding:"8px 16px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                    border: interactionStyle === opt.value ? "1.5px solid #00A86B" : "1px solid #EBEBEB",
                    background: interactionStyle === opt.value ? "#E6F7EF" : "#fff",
                    color: interactionStyle === opt.value ? "#00A86B" : "#222",
                  }}
                >{opt.label}</button>
              ))}
            </div>
      </>)}

      {/* モーダルフッター：保存する（全項目upsert）→格子に戻る */}
      <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, marginTop:4 }}>{saving ? "保存中..." : "保存する"}</button>
      </div>
      </div>
      )}

      {/* ═══ プレビューモーダル（保存済みの内容を表示） ═══ */}
      {showPreview && (
        <div onClick={()=>setShowPreview(false)} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
          {/* 求人・働き手プレビューと同型のボックス：ポップアップ0.8秒・下限=下部フッター+10px（2026-07-16） */}
          {/* touchAction/overscrollBehavior: iOSでスクロールが背面ページに奪われるのを防ぐ（2026-07-14） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:"20px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
            <button onClick={()=>setShowPreview(false)} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer", zIndex:1 }}>✕</button>
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"0 0 8px" }}>プレビュー（保存済みの内容）・項目をタップで編集できます</p>
            <FarmerProfilePreview me={me} onEdit={()=>setShowPreview(false)}
              onEditItem={(key)=>{ setShowPreview(false); setEditFromPreview(true); setEditBox(key); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function FarmerProfilePreview({ me, onEdit, onEditItem }) {
  const [data, setData] = useState(null);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data: ep } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (ep) setData(ep);
        const { data: t } = await supabase.rpc('employer_trust_info', { p_farmer_id: session.user.id });
        setTrust(t || null);
      } catch {}
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  const isEmpty = !data || (!data.nickname && !data.pr && !data.avatar_url);
  const topics = data ? [
    { label:"就農するまで", body: data.intro_path },
    { label:"いま楽しいこと", body: data.intro_joy },
    { label:"どんな作物を、どんな想いで", body: data.intro_crops },
    { label:"職場の雰囲気", body: data.intro_atmosphere },
    { label:"初めての人へのメッセージ", body: data.intro_message },
  ].filter(t => t.body && t.body.trim()) : [];
  const comment = data?.owner_comment && data.owner_comment.trim();
  const qa = data ? farmHostQa(data) : [];
  const hasTrustCard = data ? (qa.length > 0 || !!data.interaction_style || !!(trust && trust.ok)) : false;
  return (
    <div style={{ gridColumn:"1/-1", maxWidth:680 }}>
      {/* 上部カード（説明文・アバター・農園名・代表より抜粋・待遇バッジ）は削除（2026-07-25たきと指示）。
          代表よりは下の農園紹介の先頭カードに移植。待遇は実際の求人詳細ではタイトル下バッジ（perkBadges）で出るため情報の欠落なし */}
      {isEmpty && (
        <div style={{ textAlign:"center", padding:"32px 20px", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:20 }} className="f-sans">
          <div style={{ fontSize:32, marginBottom:10 }}>🧑‍🌾</div>
          <p style={{ fontSize:13, color:"#717171", margin:0, lineHeight:1.7 }}>まだプロフィールがありません。紹介を書くと、働き手に安心して応募してもらいやすくなります。</p>
        </div>
      )}
      {(topics.length > 0 || comment || hasTrustCard) && (
        <div style={{ marginBottom:20 }}>
          <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:16 }}>
            {data.nickname ? `${data.nickname}の農園紹介` : "農園紹介"}
          </h3>
          {hasTrustCard && (
            <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom: (topics.length > 0 || comment) ? 16 : 0 }}>
              <FarmerTrustCard profile={data} trust={trust} onEditItem={onEditItem} />
            </div>
          )}
          {/* 代表より（owner_comment）は農園紹介の先頭カードに移植（2026-07-25たきと指示） */}
          {(topics.length > 0 || comment) && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(100%,280px), 1fr))", gap:16, marginBottom:0 }}>
              {[...(comment ? [{ label:"代表より", body: comment }] : []), ...topics].map((t, i) => (
                <div key={i} onClick={onEditItem ? ()=>onEditItem("intro") : undefined} role={onEditItem ? "button" : undefined} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", ...(onEditItem ? { cursor:"pointer" } : {}) }}>
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>{t.label}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* 「編集する」ボタンは削除（2026-07-16）：項目タップ編集に一本化 */}
    </div>
  );
}
