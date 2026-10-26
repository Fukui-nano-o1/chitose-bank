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

export function StepDanger({ jobDangerPlaces, setJobDangerPlaces, jobDangerTasks, setJobDangerTasks, showPlace2, setShowPlace2, showTask2, setShowTask2, photoUploading, setPhotoUploading, ownerId, currentJobNumber, mode = "both" }) {
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
    <h2 className="f-sans" style={lfStyles.stepTitle}>{mode === "places" ? "危険な場所" : mode === "tasks" ? "危険な作業" : "危険な作業・場所"}</h2>
    <p className="f-sans" style={lfStyles.subtitle}>危険な場所や作業を正直に伝えましょう。写真や補足を添えると正確に伝わります。</p>
    <LFWizCard>
      {photoUploading && <p role="status" className="f-sans">写真を保存しています…</p>}
      <fieldset disabled={photoUploading} style={{ border:0, padding:0, margin:0, minWidth:0 }}>
      {mode !== "tasks" && <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な場所（任意）</label>
        <p className="f-sans" style={{ fontSize:13, color:"#595959", marginBottom:8 }}>働き手に事前に知らせたい危険な場所があれば入力してください。</p>
        {jobDangerPlaces.slice(0, showPlace2 ? 2 : 1).map((place, i) => (
          <section key={i} className="listing-danger-card" aria-label={`危険な場所${i + 1}`}>
            <strong className="listing-danger-card-title">危険な場所 {i + 1}</strong>
            <label className="listing-danger-label" htmlFor={`danger-place-name-${i}`}>場所の名前</label>
            <input id={`danger-place-name-${i}`} value={place.label} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))} placeholder="例：ぬかるみ" className="field f-sans listing-danger-input" />
            <label className="listing-danger-label" htmlFor={`danger-place-detail-${i}`}>どのような危険がありますか？</label>
            <textarea id={`danger-place-detail-${i}`} value={place.desc} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, desc: e.target.value } : p))} placeholder="例：雨上がりは特に滑りやすい" rows={3} className="field f-sans listing-danger-input listing-danger-textarea" />
            <div className="listing-danger-photo-row">
              {(place.photos || []).map((ph,k) => (
                <div key={ph.url || k} className="listing-danger-photo">
                  <ListingPhoto loading="lazy" src={ph.url} alt={`危険な場所${i+1}の写真${k+1}`} style={{ width:"100%",height:"100%",objectFit:"cover" }} />
                  <button type="button" aria-label={`写真${k+1}を削除`} onClick={() => setJobDangerPlaces(prev => prev.map((p,j) => j === i ? {...p,photos:p.photos.filter((_,x)=>x!==k)} : p))} className="listing-danger-remove-photo">×</button>
                </div>
              ))}
              {(place.photos?.length || 0) < 2 && <label className="listing-danger-photo-add">
                <NavIcon name="camera" size={20} />
                <span>写真を追加</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label={`危険な場所${i+1}の写真を追加`} onChange={e=>upload(e,"place",i)} />
              </label>}
            </div>
          </section>
        ))}
        {!showPlace2 ? (
          <button type="button" onClick={() => setShowPlace2(true)} className="listing-danger-add-another">＋ もう1件追加</button>
        ) : (
          <button type="button" onClick={() => { setShowPlace2(false); setJobDangerPlaces(prev => prev.map((p,j)=>j===1?{...p,label:"",desc:"",photos:[]}:p)); }} className="listing-danger-delete-second">2件目を削除</button>
        )}
      </div>}
      {mode !== "places" && <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な作業（任意）</label>
        <p className="f-sans" style={{ fontSize:13, color:"#595959", marginBottom:8 }}>働き手に事前に知らせたい危険な作業があれば入力してください。</p>
        {jobDangerTasks.slice(0, showTask2 ? 2 : 1).map((task, i) => (
          <section key={i} className="listing-danger-card" aria-label={`危険な作業${i + 1}`}>
            <strong className="listing-danger-card-title">危険な作業 {i + 1}</strong>
            <label className="listing-danger-label" htmlFor={`danger-task-name-${i}`}>作業の名前</label>
            <input id={`danger-task-name-${i}`} value={task.label} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, label: e.target.value } : t))} placeholder="例：重いコンテナの運搬" className="field f-sans listing-danger-input" />
            <label className="listing-danger-label" htmlFor={`danger-task-detail-${i}`}>どのような危険がありますか？</label>
            <textarea id={`danger-task-detail-${i}`} value={task.desc} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, desc: e.target.value } : t))} placeholder="例：腰を痛めないよう正しい持ち方が必要" rows={3} className="field f-sans listing-danger-input listing-danger-textarea" />
            <div className="listing-danger-photo-row">
              {(task.photos || []).map((ph,k) => (
                <div key={ph.url || k} className="listing-danger-photo">
                  <ListingPhoto loading="lazy" src={ph.url} alt={`危険な作業${i+1}の写真${k+1}`} style={{ width:"100%",height:"100%",objectFit:"cover" }} />
                  <button type="button" aria-label={`写真${k+1}を削除`} onClick={() => setJobDangerTasks(prev => prev.map((t,j) => j === i ? {...t,photos:t.photos.filter((_,x)=>x!==k)} : t))} className="listing-danger-remove-photo">×</button>
                </div>
              ))}
              {(task.photos?.length || 0) < 2 && <label className="listing-danger-photo-add">
                <NavIcon name="camera" size={20} />
                <span>写真を追加</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label={`危険な作業${i+1}の写真を追加`} onChange={e=>upload(e,"task",i)} />
              </label>}
            </div>
          </section>
        ))}
        {!showTask2 ? (
          <button type="button" onClick={() => setShowTask2(true)} className="listing-danger-add-another">＋ もう1件追加</button>
        ) : (
          <button type="button" onClick={() => { setShowTask2(false); setJobDangerTasks(prev => prev.map((t,j)=>j===1?{...t,label:"",desc:"",photos:[]}:t)); }} className="listing-danger-delete-second">2件目を削除</button>
        )}
      </div>}
      </fieldset>
    </LFWizCard>
  </>);
}
