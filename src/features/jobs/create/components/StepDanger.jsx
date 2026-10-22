import { ListingPhoto } from "../../../../components/ListingPhoto.jsx";
// 農家 step9: 危険な場所・危険な作業（安全配慮義務の告知欄）（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// 写真の選択は同期ロックし、最新の配列で重複と枚数上限を確認してから追加する。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { useEffect, useRef } from "react";
import { mergePastPhotos } from "../model";
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";
import { uploadPhoto } from "../jobCreateApi";
import { NavIcon } from "../../../../components/NavIcons";

export function StepDanger({ jobDangerPlaces, setJobDangerPlaces, jobDangerTasks, setJobDangerTasks, showPlace2, setShowPlace2, showTask2, setShowTask2, photoUploading, setPhotoUploading, ownerId, currentJobNumber }) {
  const lock = useRef(false), alive = useRef(true), scope = useRef("");
  scope.current = `${ownerId || ""}:${currentJobNumber || "new"}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const upload = async (event, kind, index) => {
    const input = event.target, files = Array.from(input.files || []);
    input.value = "";
    if (lock.current || !files.length) return;
    const rows = kind === "place" ? jobDangerPlaces : jobDangerTasks;
    const setter = kind === "place" ? setJobDangerPlaces : setJobDangerTasks;
    const queue = files.slice(0, Math.max(0, 2 - (rows[index]?.photos?.length || 0)));
    if (!queue.length) return;
    const target = scope.current;
    lock.current = true; setPhotoUploading(true);
    try {
      const results = await Promise.allSettled(queue.map(file => uploadPhoto(file, { pathPrefix: "danger_", withThumb: false, ownerId })));
      if (!alive.current || scope.current !== target) return;
      const uploaded = results.filter(r => r.status === "fulfilled" && r.value?.url).map(r => ({ url: r.value.url }));
      setter(prev => prev.map((row, i) => i === index ? { ...row, photos: mergePastPhotos(row.photos || [], uploaded, 2) } : row));
      if (uploaded.length < queue.length) alert("一部の写真の保存を確認できません。同じ写真を選び直して再試行してください。");
    } finally { lock.current = false; setPhotoUploading(false); }
  };
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>危険な作業・場所</h2>
    <p className="f-sans" style={lfStyles.subtitle}>危険な場所や作業を正直に伝えましょう。写真や補足を添えると正確に伝わります。</p>
    <LFWizCard>
      {photoUploading && <p role="status" className="f-sans">写真を保存しています…</p>}
      <fieldset disabled={photoUploading} style={{ border:0, padding:0, margin:0, minWidth:0 }}>
      <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な場所（任意）</label>
        <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な場所があれば入力してください。</p>
        {jobDangerPlaces.slice(0, showPlace2 ? 2 : 1).map((place, i) => (
          <div key={i} style={{ marginBottom:8 }}>
            <input value={place.label} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))} placeholder={`危険な場所${i + 1}（例：ぬかるみ）`} className="field f-sans" style={{ fontSize:14, marginBottom:4 }} />
            <input value={place.desc} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, desc: e.target.value } : p))} placeholder="補足説明（例：雨上がりは特に滑りやすい）" className="field f-sans" style={{ fontSize:13 }} />
                <div style={{ display:"flex", gap:8, marginTop:6 }}>
                  {[0,1].map(k => {
                    const ph = place.photos?.[k];
                    return ph ? (
                      <div key={k} style={{ position:"relative", flex:1, height:90, borderRadius:10, overflow:"hidden", border:"1px solid #EEE" }}>
                        <ListingPhoto loading="lazy" src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                        <button onClick={() => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, photos: p.photos.filter((_, x) => x !== k) } : p))} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                      </div>
                    ) : (
                      <label key={k} style={{ flex:1, height:90, border:"2px dashed #D8D8D8", borderRadius:10, background:"#FAFAFA", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, cursor:"pointer" }}>
                        <NavIcon name="camera" size={22} style={{ opacity:0.6 }} />
                        <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>写真を追加</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} onChange={e => upload(e, "place", i)} />
                      </label>
                    );
                  })}
                </div>
          </div>
        ))}
            {!showPlace2 ? (
              <button onClick={() => setShowPlace2(true)} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"10px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600 }}>＋ 危険な場所をもう1つ追加</button>
            ) : (
              <button onClick={() => { setShowPlace2(false); setJobDangerPlaces(prev => prev.map((p, j) => j === 1 ? { ...p, label:"", desc:"", photos:[] } : p)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
            )}
      </div>
      <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な作業（任意）</label>
        <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な作業があれば入力してください。</p>
        {jobDangerTasks.slice(0, showTask2 ? 2 : 1).map((task, i) => (
          <div key={i} style={{ marginBottom:8 }}>
            <input value={task.label} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, label: e.target.value } : t))} placeholder={`危険な作業${i + 1}（例：重いコンテナの運搬）`} className="field f-sans" style={{ fontSize:14, marginBottom:4 }} />
            <input value={task.desc} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, desc: e.target.value } : t))} placeholder="補足説明（例：腰を痛めないよう正しい持ち方が必要）" className="field f-sans" style={{ fontSize:13 }} />
                <div style={{ display:"flex", gap:8, marginTop:6 }}>
                  {[0,1].map(k => {
                    const ph = task.photos?.[k];
                    return ph ? (
                      <div key={k} style={{ position:"relative", flex:1, height:90, borderRadius:10, overflow:"hidden", border:"1px solid #EEE" }}>
                        <ListingPhoto loading="lazy" src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                        <button onClick={() => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, photos: t.photos.filter((_, x) => x !== k) } : t))} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                      </div>
                    ) : (
                      <label key={k} style={{ flex:1, height:90, border:"2px dashed #D8D8D8", borderRadius:10, background:"#FAFAFA", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, cursor:"pointer" }}>
                        <NavIcon name="camera" size={22} style={{ opacity:0.6 }} />
                        <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>写真を追加</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} onChange={e => upload(e, "task", i)} />
                      </label>
                    );
                  })}
                </div>
          </div>
        ))}
            {!showTask2 ? (
              <button onClick={() => setShowTask2(true)} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"10px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600 }}>＋ 危険な作業をもう1つ追加</button>
            ) : (
              <button onClick={() => { setShowTask2(false); setJobDangerTasks(prev => prev.map((t, j) => j === 1 ? { ...t, label:"", desc:"", photos:[] } : t)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
            )}
      </div>
      </fieldset>
    </LFWizCard>
  </>);
}
