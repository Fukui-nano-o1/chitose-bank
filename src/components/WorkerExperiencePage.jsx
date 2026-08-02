// 📋 経験・できること（自己申告）専用ページ（#/experience・2026-07-25たきと指示）：
// 働き手プロフィール編集のボックスモーダルから独立ページへ（保険の準備 #/insurance と同型）。
// worker_profiles の experience_entries / self_declared / experienced_tasks を単独upsert（onConflictで当該列のみ更新＝他項目は温存）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { WORKER_DECLARATIONS, TASK_OPTIONS, CROP_OPTIONS } from "../lib/utils";
import { ToggleSwitch } from "./ToggleSwitch";
import { AutoSkeleton } from "./ui";

// 免許・資格・保険方針の申告ボックス（2026-08-02たきと指示「保険申告と同じ構造に」）：
// 雇い手の保険の準備（FarmerDashboard 2026-07-29）と同じ横1列の箱＋タップでその場に開いて申告する構造。
// 箱の色の規則も同じ（既定=グレー／申告ずみ=縁だけ緑／開いている=全体が緑）。申告ずみを先頭に並べる
// （並びは開いた時点で固定＝保険側がsaved基準で並べ替えるのと同じく、入力中に箱が飛び跳ねない）。
// WorkerProfileEditの経験・資格ボックスと#/experienceページの両方から使う共有部品
export function WorkerDeclarationBoxes({ selfDeclared, setSelfDeclared }) {
  const [openKey, setOpenKey] = useState(null);
  const [ordered] = useState(() => [
    ...selfDeclared.map(k => WORKER_DECLARATIONS.find(x => x.k === k)).filter(Boolean),
    ...WORKER_DECLARATIONS.filter(it => !selfDeclared.includes(it.k)),
  ]);
  return (
    /* 縦一列・全幅（2026-08-03たきと指示「縦一列だ。横幅は大きくとろう」）。展開はタップした箱の直下 */
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {ordered.map(it => {
        const on = selfDeclared.includes(it.k);
        const open = openKey === it.k;
        return (
          <div key={it.k}>
            <button type="button" onClick={()=>setOpenKey(open ? null : it.k)}
              className="f-sans" style={{ display:"block", width:"100%", boxSizing:"border-box", background: open ? "#00A86B" : "#F7F7F7", border:"1px solid " + (open || on ? "#00A86B" : "#EBEBEB"), borderRadius:12, padding:"12px 14px", cursor:"pointer", textAlign:"left" }}>
              <span style={{ display:"block", fontSize:14, fontWeight:700, color: open ? "#fff" : "#222" }}>{it.label}</span>
              <span style={{ display:"block", fontSize:11, color: open ? "rgba(255,255,255,.85)" : on ? "#00A86B" : "#B0B0B0", marginTop:2 }}>{on ? "申告ずみ ✓" : "未申告"}</span>
            </button>
            {open && (
              /* 展開したボックス：この申告のON/OFFをその場で切り替える（保存はページ/モーダル共通の「保存する」） */
              <div className="fade-in" style={{ marginTop:8, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:14, padding:"6px 14px 14px" }}>
                <ToggleSwitch label={it.label} checked={on} onChange={(v)=>setSelfDeclared(prev => v ? [...new Set([...prev, it.k])] : prev.filter(x => x !== it.k))} />
                <button type="button" onClick={()=>setOpenKey(null)} className="f-sans" style={{ marginTop:10, padding:"11px 16px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>閉じる</button>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0", lineHeight:1.5 }}>自己申告です。運営が確認するものではありません。</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WorkerExperiencePage() {
  const [expEntries, setExpEntries] = useState([]);       // 経験の構造化申告 {crop,task,duration}（最大5）
  const [selfDeclared, setSelfDeclared] = useState([]);   // できること・資格（key配列）
  const [experiencedTasks, setExperiencedTasks] = useState([]); // 旧「経験のある作業」＝データがある人だけ残置表示
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("worker_profiles")
          .select("experience_entries,self_declared,experienced_tasks").eq("auth_id", session.user.id).maybeSingle();
        setExpEntries(Array.isArray(data?.experience_entries) ? data.experience_entries : []);
        setSelfDeclared(Array.isArray(data?.self_declared) ? data.self_declared : []);
        setExperiencedTasks(Array.isArray(data?.experienced_tasks) ? data.experienced_tasks : []);
      } catch {}
      setLoading(false);
    })();
  }, []);
  const save = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      const { error } = await supabase.from("worker_profiles").upsert({
        auth_id: session.user.id,
        experience_entries: expEntries.map(e => ({ crop:(e.crop||"").trim(), task:e.task||"", duration:e.duration||"" })).filter(e => e.crop).slice(0, 5),
        self_declared: selfDeclared,
        experienced_tasks: experiencedTasks,
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      setSaving(false);
      if (error) { alert("保存に失敗しました：" + error.message); return; }
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
    } catch { setSaving(false); alert("保存に失敗しました"); }
  };
  return (
    <div className="help-edge" style={{ maxWidth:560, marginLeft:"auto", marginRight:"auto", padding:"24px 20px 96px" }}>
      <button onClick={()=>{ let fromApp=false; try{ fromApp=sessionStorage.getItem("cb_expFromApp")==="1"; sessionStorage.removeItem("cb_expFromApp"); }catch{} if (fromApp && window.history.length>1) window.history.back(); else window.location.hash="/profile/worker/profile"; }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 14px", display:"inline-flex", alignItems:"center", gap:6 }}>← 戻る</button>
      <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 6px" }}>📋 経験・できること（自己申告）</h1>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>あなたのプロフィールに「ご本人の申告」として表示されます。運営が確認するものではありません。</p>
      {loading ? (
        <AutoSkeleton fallbackHeight={84} fallbackCount={4} /> /* 読み込み中は入力欄の仮配置（2026-07-27） */
      ) : (<>
        {/* 経験の構造化申告（作物×作業×どのくらい・最大5） */}
        <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 8px" }}>経験（作物 × 作業 × どのくらい）</p>
        <datalist id="cb-crop-opts-exp">{CROP_OPTIONS.map(c => <option key={c.name} value={c.name} />)}</datalist>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:8 }}>
          {expEntries.map((e, i) => (
            <div key={i} style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
              <input list="cb-crop-opts-exp" value={e.crop || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, crop: ev.target.value } : x))} placeholder="作物（選択・自由入力）" className="field f-sans" style={{ fontSize:13, flex:"1 1 120px", minWidth:0, marginBottom:0 }} />
              <select value={e.task || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, task: ev.target.value } : x))} className="field f-sans" style={{ fontSize:13, flex:"1 1 90px", minWidth:0, marginBottom:0 }}>
                <option value="">作業</option>
                {TASK_OPTIONS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <select value={e.duration || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, duration: ev.target.value } : x))} className="field f-sans" style={{ fontSize:13, flex:"1 1 110px", minWidth:0, marginBottom:0 }}>
                <option value="">どのくらい</option>
                {["少し","1〜2シーズン","3シーズン以上"].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <button onClick={()=>setExpEntries(prev => prev.filter((_,j)=>j!==i))} aria-label="削除" className="f-sans" style={{ flexShrink:0, width:30, height:30, borderRadius:8, background:"#F5F5F5", border:"none", color:"#999", fontSize:15, cursor:"pointer" }}>×</button>
            </div>
          ))}
        </div>
        {expEntries.length < 5 && (
          <button onClick={()=>setExpEntries(prev => [...prev, { crop:"", task:"", duration:"" }])} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"9px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600, marginBottom:20 }}>＋ 経験を追加</button>
        )}

        {/* 免許・資格・保険方針（自己申告）：トグル行リスト→保険申告と同じ横1列ボックスに（2026-08-02たきと指示） */}
        <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"4px 0 8px" }}>免許・資格・保険方針</p>
        <div style={{ marginBottom:20 }}>
          <WorkerDeclarationBoxes selfDeclared={selfDeclared} setSelfDeclared={setSelfDeclared} />
        </div>

        {/* その他の作業（旧「経験のある作業」＝既存データがある人だけ残置。空の人には構造化のみ） */}
        {experiencedTasks.length > 0 && (
          <>
            <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"4px 0 6px" }}>その他の作業</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
              {[...new Set([...TASK_OPTIONS.map(t=>t.name), ...experiencedTasks])].map(v => {
                const on = experiencedTasks.includes(v);
                return (
                  <button key={v} type="button" onClick={()=>setExperiencedTasks(prev => on ? prev.filter(x=>x!==v) : [...prev, v])} className="f-sans" style={{
                    padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                    border:"1px solid " + (on ? "#00A86B" : "#EBEBEB"), background: on ? "#E6F7EF" : "#F7F7F7", color: on ? "#00A86B" : "#717171",
                  }}>{v}</button>
                );
              })}
            </div>
          </>
        )}

        <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12 }}>{saving ? "保存中..." : "保存する"}</button>
        {saved && <p className="f-sans" style={{ fontSize:12, color:"#00A86B", textAlign:"center", marginTop:12 }}>保存しました ✓</p>}
      </>)}
    </div>
  );
}
