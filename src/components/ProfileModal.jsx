// 分割3-B（2026-07-25）：App.jsxから移動。プロフィールモーダル（自分の看板＋道具箱）。
import { useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { compressImage } from "../lib/image";

const CROP_EMOJIS = ['🥦','🍅','🍆','🥕','🌽','🥬','🍓','🥒','🧅','🥔','🍈','🌶️','🥜','🫛','🧄'];
function getDefaultAvatar(farmerId) {
  const index = farmerId ? farmerId.charCodeAt(0) % CROP_EMOJIS.length : 0;
  return CROP_EMOJIS[index];
}

// ── ProfileModal ─────────────────────────────────────────────
export function ProfileModal({ me, recs, isContributor, avatarUrl, onClose, onEditProfile, onLogout, onAvatarChange }) {
  const [delConfirm, setDelConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const fileRef = useRef(null);

  const fid = me.id;
  const myRecs = Object.entries(recs)
    .filter(([k]) => k.startsWith(fid + "_"))
    .flatMap(([, v]) => v);
  const recCount = myRecs.length;
  const lastDates = myRecs.map(r => r.created_at).filter(Boolean);
  const lastDate = lastDates.length > 0
    ? new Date(Math.max(...lastDates.map(d => new Date(d)))).toLocaleDateString("ja-JP")
    : "未入力";

  const crops = Array.isArray(me.planned_crops) ? me.planned_crops : [];
  const farmType = me.farming_type || localStorage.getItem('ob_farming_type') || "";
  const areaTan = me.area_tan || localStorage.getItem('ob_area_tan') || "";
  const salesChannels = (me.sales_channels && Array.isArray(me.sales_channels) && me.sales_channels.length > 0)
    ? me.sales_channels
    : (() => { try { return JSON.parse(localStorage.getItem('ob_sales_channels') || '[]'); } catch { return []; } })();

  const SALES_LABELS = { ja:"JA出荷", market:"市場出荷", direct_store:"直売所", direct_trade:"直接取引", online:"ネット販売", undecided:"未定" };
  const TIER_LABELS = { "0":"未就農", "1-3":"1〜3年", "4-10":"4〜10年", "10+":"10年以上" };

  const displayUrl = avatarUrl || me.avatar_url || null;

  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    // アイコンは表示84px級ので512pxに圧縮してから上げる（働き手・雇い手アイコンと同じ扱い・2026-07-26）
    const upFile = await compressImage(file, 512, 0.8);
    const ext = upFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = me.id + '/avatar.' + ext;
    await supabase.storage.from('avatars').upload(path, upFile, { upsert: true });
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = urlData?.publicUrl || '';
    await supabase.from('farmers').update({ avatar_url: url }).eq('auth_id', me.id);
    try { localStorage.setItem('avatarUrl_' + me.id, url); } catch {}
    onAvatarChange(url);
    setUploading(false);
  };

  const handleDeleteAvatar = async () => {
    if (!displayUrl) return;
    setUploading(true);
    try {
      const { data: files } = await supabase.storage.from('avatars').list(me.id + '/');
      if (files && files.length > 0) {
        const paths = files.map(f => me.id + '/' + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from('farmers').update({ avatar_url: '' }).eq('auth_id', me.id);
      try { localStorage.removeItem('avatarUrl_' + me.id); } catch {}
      onAvatarChange("");
    } catch (err) { console.error('Avatar delete error:', err); }
    setUploading(false);
  };

  const uniqueMonths = new Set(myRecs.map(r => r.year + "-" + r.month)).size;
  const uniqueDests = new Set(myRecs.map(r => r.destId).filter(Boolean)).size;

  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9000, overflowY:"auto" }}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display:"none" }} onChange={handleFile} />

      {/* ヘッダーバー */}
      <div style={{
        position:"sticky", top:0, zIndex:1, background:"#fff",
        borderBottom:"1px solid #EBEBEB",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"12px 20px", height:56,
      }}>
        <button onClick={onClose} style={{
          background:"none", border:"none", fontSize:15, color:"#222",
          cursor:"pointer", padding:"4px 0", fontFamily:"inherit",
        }}>← 戻る</button>
        <span className="f-sans" style={{ fontSize:14, fontWeight:600, color:"#222" }}>プロフィール</span>
        <button onClick={onEditProfile} style={{
          background:"none", border:"none", fontSize:13, color:"#00A86B",
          cursor:"pointer", fontWeight:600, fontFamily:"inherit",
        }}>編集</button>
      </div>

      <div style={{ maxWidth:480, margin:"0 auto", padding:"24px 20px 40px" }}>

        {/* アバター + 名前 */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:28 }}>
          <div style={{ position:"relative", marginBottom:16 }}>
            <div
              onClick={displayUrl ? () => setShowLightbox(true) : undefined}
              style={{
                width:120, height:120, borderRadius:"50%",
                background:"#F7F7F7", border:"3px solid #fff",
                boxShadow:"0 4px 20px rgba(0,0,0,0.1)",
                display:"flex", alignItems:"center", justifyContent:"center",
                overflow:"hidden", fontSize:56, cursor: displayUrl ? "pointer" : "default",
              }}
            >
              {displayUrl
                ? <img src={displayUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                : getDefaultAvatar(me.id)
              }
            </div>
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
              position:"absolute", bottom:4, right:4,
              width:34, height:34, borderRadius:"50%",
              background:"#222", border:"2px solid #fff", color:"#fff",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:15, cursor:"pointer",
            }}>📷</button>
          </div>
          <h1 className="f-sans" style={{ fontSize:26, fontWeight:700, color:"#222", margin:"0 0 4px", textAlign:"center" }}>{me.name}</h1>
          <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", margin:0 }}>{me.email}</p>

          {/* バッジ */}
          <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap", justifyContent:"center" }}>
            <span style={{
              padding:"5px 14px", borderRadius:20, fontSize:11, fontWeight:700,
              background: isContributor ? "#E6F7EF" : "#FEF3E2",
              color: isContributor ? "#00A86B" : "#F5A623",
              border: isContributor ? "1px solid #00A86B33" : "1px solid #F5A62333",
            }}>{isContributor ? "✅ 貢献者" : "⚠ 入力で復活"}</span>
            <span style={{
              padding:"5px 14px", borderRadius:20, fontSize:11, fontWeight:600,
              background:"#F7F7F7", color:"#717171",
            }}>📧 メール認証済み</span>
          </div>
        </div>

        {/* 実績カード */}
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10, marginBottom:24,
        }}>
          {[
            { label:"入力データ", value:recCount + "件", icon:"📋" },
            { label:"入力月数", value:uniqueMonths + "ヶ月", icon:"📅" },
            { label:"出荷先数", value:uniqueDests + "件", icon:"🚚" },
            { label:"最終入力日", value:lastDate, icon:"🕐" },
          ].map(stat => (
            <div key={stat.label} style={{
              padding:"16px", background:"#F7F7F7", borderRadius:16, textAlign:"center",
            }}>
              <div style={{ fontSize:22, marginBottom:6 }}>{stat.icon}</div>
              <p className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#222", margin:"0 0 2px" }}>{stat.value}</p>
              <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:0 }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {/* 基本情報セクション */}
        <div style={{ marginBottom:20 }}>
          <h2 className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12 }}>基本情報</h2>
          <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, overflow:"hidden" }}>
            {[
              { icon:"🗾", label:"地域", value:(me.prefecture || "") + (me.municipality ? " " + me.municipality : "") || "未設定" },
              { icon:"📅", label:"就農歴", value:TIER_LABELS[me.experience_tier] || "未設定" },
              { icon:"🏠", label:"専業/兼業", value:farmType === "fulltime" ? "専業農家" : farmType === "parttime" ? "兼業農家" : "未設定" },
              { icon:"📐", label:"経営面積", value:areaTan ? areaTan + " 反" : "未設定" },
            ].map((item, i, arr) => (
              <div key={item.label} style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"14px 18px",
                borderBottom: i < arr.length - 1 ? "1px solid #F7F7F7" : "none",
              }}>
                <span style={{ fontSize:18, width:24, textAlign:"center", flexShrink:0 }}>{item.icon}</span>
                <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{item.label}</span>
                <span className="f-sans" style={{ fontSize:14, color:"#222", fontWeight:500 }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 栽培作物セクション */}
        <div style={{ marginBottom:20 }}>
          <h2 className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12 }}>栽培作物</h2>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {crops.length > 0
              ? crops.map(c => (
                  <span key={c} style={{
                    padding:"8px 16px", borderRadius:20,
                    background:"#E6F7EF", color:"#00A86B",
                    fontSize:13, fontWeight:600,
                  }}>{c}</span>
                ))
              : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
            }
          </div>
        </div>

        {/* 販売先セクション */}
        <div style={{ marginBottom:28 }}>
          <h2 className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12 }}>販売先</h2>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {salesChannels.length > 0
              ? salesChannels.map(v => (
                  <span key={v} style={{
                    padding:"8px 16px", borderRadius:20,
                    background:"#F7F7F7", color:"#222",
                    fontSize:13, fontWeight:500,
                  }}>{SALES_LABELS[v] || v}</span>
                ))
              : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
            }
          </div>
        </div>

        {/* アクションセクション */}
        <div style={{ display:"grid", gap:10, marginBottom:20 }}>
          <button onClick={onEditProfile} className="btn-primary" style={{
            width:"100%", padding:"15px", fontSize:14, borderRadius:14,
          }}>プロフィールを編集する</button>


          {displayUrl && (
            <button onClick={handleDeleteAvatar} disabled={uploading} style={{
              width:"100%", padding:"13px", fontSize:13,
              background:"#fff", border:"1px solid #EBEBEB", borderRadius:14,
              color:"#717171", cursor:"pointer", fontFamily:"inherit",
            }}>プロフィール写真を削除</button>
          )}

        </div>

        {/* 退会セクション */}
        <div style={{ borderTop:"1px solid #EBEBEB", paddingTop:20 }}>
          {!delConfirm
            ? <button onClick={() => setDelConfirm(true)} className="f-sans" style={{
                width:"100%", padding:"12px", border:"none", background:"none",
                fontSize:13, color:"#E24B4A", cursor:"pointer", textAlign:"center",
              }}>退会する</button>
            : <div style={{ padding:20, background:"#FCEBEB", borderRadius:14, border:"1px solid #E24B4A22" }}>
                <p className="f-sans" style={{ fontSize:13, color:"#E24B4A", marginBottom:14, lineHeight:1.7, textAlign:"center" }}>
                  本当に退会しますか？<br/>データは30日以内に削除されます。
                </p>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setDelConfirm(false)} style={{
                    flex:1, padding:"11px", background:"#fff", border:"1px solid #EBEBEB",
                    borderRadius:12, fontSize:13, cursor:"pointer", fontFamily:"inherit", color:"#222",
                  }}>キャンセル</button>
                  <button onClick={async () => {
                    // 退会申し出を記録（プラポリv3第7条1：申し出から30日以内に運営が削除）。
                    // insert失敗でもsignOutは実行する＝退会の意思表示を通信エラーで妨げない
                    try {
                      const { data:{ user } } = await supabase.auth.getUser();
                      if (user) {
                        const { error } = await supabase.from("withdrawal_requests").insert({ auth_id: user.id });
                        if (error) console.error("退会申請の記録に失敗:", error.message);
                      }
                    } catch (e) { console.error("退会申請の記録に失敗:", e); }
                    await supabase.auth.signOut(); onLogout();
                  }} style={{
                    flex:1, padding:"11px", background:"#E24B4A", color:"#fff", border:"none",
                    borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                  }}>退会する</button>
                </div>
              </div>
          }
          <button onClick={() => { if (window.confirm("ログアウトしますか？")) onLogout(); }} className="f-sans" style={{
            width:"100%", padding:"12px", border:"none", background:"none",
            fontSize:12, color:"#B0B0B0", cursor:"pointer", textAlign:"center", marginTop:8,
          }}>ログアウト</button>
        </div>
      </div>

      {/* ライトボックス */}
      {showLightbox && displayUrl && (
        <div className="cb-lock-scroll" onClick={() => setShowLightbox(false)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease",
        }}>
          <img src={displayUrl} alt="avatar full" onClick={e => e.stopPropagation()}
            style={{ maxWidth:"90vw", maxHeight:"90vh", objectFit:"contain", borderRadius:4, cursor:"default" }} />
        </div>
      )}
    </div>
  );
}
