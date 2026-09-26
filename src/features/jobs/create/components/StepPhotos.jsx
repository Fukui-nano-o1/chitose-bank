// 農家 step7: 写真（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
//
// 2026-09-26 たきと指示「過去に掲載した写真をタップで復元」：集合場所（step3）の「登録した作業場を使う」
// （SavedWorkplaceCard）と同じ型のカードを上に置き、タップで【過去の求人の写真の束】が開く。
// 写真をタップして選び「追加する」で手元の写真に足す＝ファイルは再アップロードしない（url の参照を使い回す）。
// ・読むのは自分の求人だけ（fetchMyJobPhotos＝farmer_id＋RLS）。取得に失敗した時は手元を変えない（2026-08-07規則）
// ・過去の写真が1枚も無ければカードごと出さない（初めての人には従来どおりの画面）
// ・束の組み方・重複・上限の判定は model.js（pastPhotoGroups／mergePastPhotos）＝純粋関数so試験できる
import { useEffect, useState } from "react";
import { lfStyles } from "../lfStyles";
import { LFWizCard, Dots } from "../../../../components/ui";
import { photoThumb } from "../../../../lib/utils";
import { uploadPhoto, getSession, fetchMyJobPhotos } from "../jobCreateApi";
import { NavIcon } from "../../../../components/NavIcons";
import { pastPhotoGroups, mergePastPhotos } from "../model";

const PHOTO_CAP = 10;

// 過去の写真の入口カード（作業場のカードと同じ見た目＝listing-workplace-card を共用）
export function PastPhotosCard({ status, count, open, onOpen, onRetry }) {
  const loading = status === "loading";
  const failed = status === "error";
  return (
    <button type="button" className="listing-workplace-card" disabled={loading} aria-expanded={open}
      data-guide="past-photos-card" onClick={failed ? onRetry : onOpen}>
      <NavIcon name="image" size={32} />
      <span className="listing-workplace-copy">
        <strong>{loading ? "過去の写真を確認中…" : failed ? "過去の写真を読み込めませんでした" : "過去に掲載した写真から選ぶ"}</strong>
        <span>{loading ? "少しお待ちください" : failed ? "タップして、もう一度読み込む" : `これまでの求人の写真 ${count}枚。タップして選ぶだけで、この求人にも使えます。`}</span>
      </span>
      <svg className="listing-workplace-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}><path d="m9 5 7 7-7 7" /></svg>
    </button>
  );
}

// 過去の写真を選ぶ面（求人ごとの束・タップで選択・追加する）
export function PastPhotosPicker({ groups, room, selected, onToggle, onAdd, onClose }) {
  const picked = selected.length;
  const full = room <= 0;
  return (
    <div className="f-sans" data-guide="past-photos-picker" style={{ marginTop: 12, border: "1px solid #EBEBEB", borderRadius: 12, background: "#fff", padding: "14px 14px 12px" }}>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#717171", lineHeight: 1.7 }}>
        {full
          ? `写真は${PHOTO_CAP}枚までです。追加するには、いまの写真を減らしてください。`
          : `あと${room}枚まで追加できます。写真をタップして選び、下の「追加する」を押してください。`}
      </p>
      {groups.map(g => (
        <div key={g.jobNumber ?? g.title} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#222", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</span>
            {g.jobNumber != null && <span style={{ fontSize: 12, color: "#717171", flexShrink: 0 }}>#{g.jobNumber}</span>}
            {g.date && <span style={{ fontSize: 12, color: "#717171", flexShrink: 0 }}>{g.date}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {g.photos.map(p => {
              const on = selected.includes(p.url);
              const disabled = p.inUse || (!on && full);
              return (
                <button key={p.url} type="button" disabled={disabled} aria-pressed={on} data-past-photo={p.url}
                  onClick={() => onToggle(p)}
                  style={{ position: "relative", padding: 0, border: "none", background: "#F7F7F7", borderRadius: 10, overflow: "hidden", aspectRatio: "1 / 1", cursor: disabled ? "default" : "pointer", boxShadow: on ? "inset 0 0 0 3px #222" : "inset 0 0 0 1px #EEE", opacity: p.inUse ? 0.45 : (disabled ? 0.6 : 1) }}>
                  <img loading="lazy" src={photoThumb(p)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {on && (
                    <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", background: "#222", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <NavIcon name="tick" size={14} />
                    </span>
                  )}
                  {p.inUse && (
                    <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "3px 0", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, fontWeight: 700, textAlign: "center" }}>追加済み</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", padding: "10px 12px", fontSize: 14, color: "#222", textDecoration: "underline", cursor: "pointer" }}>とじる</button>
        <button type="button" onClick={onAdd} disabled={picked === 0}
          style={{ background: picked === 0 ? "#DDDDDD" : "#222", color: "#fff", border: "none", borderRadius: 8, padding: "12px 18px", fontSize: 14, fontWeight: 700, cursor: picked === 0 ? "default" : "pointer" }}>
          {picked === 0 ? "追加する" : `${picked}枚を追加する`}
        </button>
      </div>
    </div>
  );
}

// 過去の求人の写真を読む（step7 に来た時に1回・失敗はカードで知らせて再試行）
function usePastPhotoRows() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [rows, setRows] = useState([]);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (cancelled) return;
        if (!session) throw new Error("session unavailable");
        const { data, error } = await fetchMyJobPhotos(session.user.id);
        if (cancelled) return;
        if (error) throw error;
        setRows(Array.isArray(data) ? data : []);
        setStatus("ready");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [retry]);
  return { status, rows, retry: () => setRetry(v => v + 1) };
}

export function StepPhotos({ jobPhotos, setJobPhotos, photoUploading, setPhotoUploading, currentJobNumber = null }) {
  const past = usePastPhotoRows();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState([]); // 選んだ写真の url
  const groups = pastPhotoGroups(past.rows, { excludeJobNumber: currentJobNumber, currentPhotos: jobPhotos });
  const pastCount = groups.reduce((n, g) => n + g.photos.length, 0);
  const room = PHOTO_CAP - jobPhotos.length;
  const showPastCard = past.status === "loading" || past.status === "error" || pastCount > 0;
  const togglePast = (p) => setSelected(prev => prev.includes(p.url) ? prev.filter(u => u !== p.url) : [...prev, p.url]);
  const addPast = () => {
    const picked = [];
    for (const g of groups) for (const p of g.photos) if (selected.includes(p.url)) picked.push(p);
    setJobPhotos(prev => mergePastPhotos(prev, picked, PHOTO_CAP));
    setSelected([]);
    setPickerOpen(false);
  };
  const uploadFiles = async (e, roomNow) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const queue = files.slice(0, roomNow);
    setPhotoUploading(true);
    // 全ファイルを並列アップロード（各ファイル内も原寸＋サムネを並列・デコード1回）
    const results = await Promise.all(queue.map(file =>
      uploadPhoto(file).catch(err => { console.error('photo upload failed', file.name, err); return null; })
    ));
    const uploaded = results.filter(r => r && r.url).map(r => ({ caption: "", ...r }));
    if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
    if (uploaded.length < queue.length) {
      alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
    }
    setPhotoUploading(false);
    e.target.value = '';
  };
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>仕事の様子を写真で伝えましょう</h2>
    <p className="f-sans" style={lfStyles.subtitle}>畑や作業の写真を最大10枚。1枚目が求人カードに表示されます。</p>
    {showPastCard && (<>
      <PastPhotosCard status={past.status} count={pastCount} open={pickerOpen}
        onOpen={() => setPickerOpen(v => !v)} onRetry={past.retry} />
      {pickerOpen && past.status === "ready" && (
        <PastPhotosPicker groups={groups} room={room} selected={selected}
          onToggle={togglePast} onAdd={addPast} onClose={() => { setSelected([]); setPickerOpen(false); }} />
      )}
      <div className="listing-address-divider"><span>または、新しい写真を追加</span></div>
    </>)}
    <LFWizCard>
          {/* アップロードボタン（multiple・残り枠まで直列処理） */}
          <div style={{ marginBottom: jobPhotos.length > 0 ? 16 : 0 }}>
            <label className="f-sans btn-primary" style={{ display:"inline-block", padding:"12px 24px", fontSize:14, fontWeight:700, cursor: photoUploading ? "wait" : "pointer", opacity: (photoUploading || jobPhotos.length >= PHOTO_CAP) ? 0.5 : 1 }}>
              {photoUploading ? <>アップロード中<Dots /></> : "＋ 写真を追加"}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading || jobPhotos.length >= PHOTO_CAP} onChange={e => uploadFiles(e, PHOTO_CAP - jobPhotos.length)} />
            </label>
            <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8 }}>{jobPhotos.length} / {PHOTO_CAP} 枚</p>
          </div>

          {/* 空状態：大タップゾーン */}
          {jobPhotos.length === 0 && (
            <label className="f-sans" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"48px 24px", border:"2px dashed #D8D8D8", borderRadius:16, cursor: photoUploading ? "wait" : "pointer", background:"#FAFAFA", textAlign:"center" }}>
              <NavIcon name="camera" size={44} />
              <span className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222" }}>タップして写真を選ぶ</span>
              <span className="f-sans" style={{ fontSize:14, color:"#717171", maxWidth:280, lineHeight:1.6 }}>畑の全景、作業風景、収穫する作物など。</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading} onChange={e => uploadFiles(e, PHOTO_CAP)} />
            </label>
          )}

          {/* 追加後：カバー大・以降小グリッド */}
          {jobPhotos.length > 0 && (
            <div>
              <div style={{ position:"relative", marginBottom:10 }}>
                <img loading="lazy" src={photoThumb(jobPhotos[0])} alt="カバー写真" style={{ width:"100%", height:260, objectFit:"cover", borderRadius:14, border:"1px solid #EEE" }} />
                <span className="f-sans" style={{ position:"absolute", top:10, left:10, padding:"4px 12px", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, fontWeight:700, borderRadius:8 }}>カバー</span>
                <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== 0))} style={{ position:"absolute", top:8, right:8, width:28, height:28, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:15, cursor:"pointer", lineHeight:1 }}>×</button>
              </div>
              {/* 2枚目以降は2列の大サイズ（2026-07-16）。justifyContent:centerで奇数枚の最後の1枚＝空白が中央に来る */}
              {jobPhotos.length > 1 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                  {jobPhotos.slice(1).map((p, i) => {
                    const idx = i + 1;
                    return (
                      <div key={idx} style={{ position:"relative", width:"calc(50% - 4px)" }}>
                        <img loading="lazy" src={photoThumb(p)} alt={`写真${idx+1}`} style={{ width:"100%", aspectRatio:"4 / 3", objectFit:"cover", borderRadius:10, border:"1px solid #EEE", display:"block" }} />
                        <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== idx))} style={{ position:"absolute", top:-6, right:-6, width:22, height:22, borderRadius:"50%", border:"none", background:"#222", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </LFWizCard>
  </>);
}
