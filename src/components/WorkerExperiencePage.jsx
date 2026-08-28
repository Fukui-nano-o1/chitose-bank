// 📋 経験・できること（自己申告）専用ページ（#/experience・2026-07-25たきと指示）：
// 働き手プロフィール編集のボックスモーダルから独立ページへ（保険の準備 #/insurance と同型）。
// worker_profiles の experience_entries / self_declared / experienced_tasks を単独upsert（onConflictで当該列のみ更新＝他項目は温存）。
import { NavIconInline } from "./NavIcons";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { WORKER_DECLARATIONS, TASK_OPTIONS, CROP_OPTIONS, ROLE_ORANGE } from "../lib/utils";
import { ToggleSwitch } from "./ToggleSwitch";
import { AutoSkeleton, Dots } from "./ui";

// 経験＋免許・資格・保険方針（2026-08-28たきと指示「経験項目はAirbnbをパクれ」）：
// 旧・2タブ横スワイプ（経験⇄資格・2026-08-03）を畳み、Airbnbのサブ画面と同じ【縦1本】にした＝
// 経験＝白いカードの縦積み＋下線の「＋ 経験を追加」／資格＝細い区切り線のトグル行（タップで展開する箱は廃止）。
// スワイプが消えたので、iOSのキーボードで再スナップが走る対策（typing）も不要になった。
// WorkerProfileEditの経験・資格ページと#/experienceページの両方から使う共有部品＝申告の形をサイト内で2種類にしない
export function WorkerExperienceEntries({ expEntries, setExpEntries, selfDeclared, setSelfDeclared }) {
  // 経験0件で開いたときは「経験 1」の空カードを最初から1枚出しておく（2026-08-03たきと指示「この状態がデフォルト」）。
  // 空カード（作物が空）は保存側のfilterで除外される＝未入力のまま保存してもDBは汚れない
  useEffect(() => {
    if (expEntries.length === 0) setExpEntries([{ crop:"", task:"", duration:"" }]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hasDecl = !!(selfDeclared && setSelfDeclared);
  return (
    <div>
      <datalist id="cb-crop-opts-expswipe">{CROP_OPTIONS.map(c => <option key={c.name} value={c.name} />)}</datalist>
      {/* 経験（最大5）：白いカードを縦積み。×は削除の意味so消さない（2026-08-19規則）＝枠なしの薄いボタンに */}
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"4px 0 10px" }}>経験</p>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {expEntries.map((e, i) => (
          <div key={i} style={{ background:"#fff", border:"1px solid #DDD", borderRadius:12, padding:"14px 16px", position:"relative" }}>
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", margin:"0 0 8px" }}>経験 {i + 1}</p>
            <button type="button" onClick={()=>setExpEntries(prev => prev.filter((_,j)=>j!==i))} aria-label="削除" className="f-sans" style={{ position:"absolute", top:8, right:8, width:28, height:28, background:"none", border:"none", color:"#999", fontSize:16, cursor:"pointer" }}>×</button>
            <input list="cb-crop-opts-expswipe" value={e.crop || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, crop: ev.target.value } : x))}
              placeholder="作物（選択・自由入力）" className="field f-sans" style={{ fontSize:16, width:"100%", boxSizing:"border-box", marginBottom:8, background:"#fff" }} />
            <select value={e.task || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, task: ev.target.value } : x))} className="field f-sans" style={{ fontSize:13, width:"100%", boxSizing:"border-box", marginBottom:8, background:"#fff" }}>
              <option value="">作業</option>
              {TASK_OPTIONS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <select value={e.duration || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, duration: ev.target.value } : x))} className="field f-sans" style={{ fontSize:13, width:"100%", boxSizing:"border-box", marginBottom:0, background:"#fff" }}>
              <option value="">どのくらい</option>
              {["少し","1〜2シーズン","3シーズン以上"].map(dv => <option key={dv} value={dv}>{dv}</option>)}
            </select>
          </div>
        ))}
      </div>
      {expEntries.length < 5 && (
        /* Airbnbの「追加」＝黒い下線の文字ボタン（破線の大きな枠は廃止） */
        <button type="button" onClick={()=>setExpEntries(prev => [...prev, { crop:"", task:"", duration:"" }])} className="f-sans"
          style={{ background:"none", border:"none", padding:"14px 0 2px", fontSize:14, fontWeight:700, color:"#222", textDecoration:"underline", cursor:"pointer" }}>＋ 経験を追加</button>
      )}
      {/* 免許・資格・保険方針：Airbnbのアメニティ選択と同じ＝ラベル＋スイッチの行を細い線で区切るだけ。
          旧・タップで開いて申告する箱（2026-08-02）は畳んだ＝その場でONにできる方が1手少ない。
          保存は従来どおりページ/モーダル共通の「保存する」 */}
      {hasDecl && (<>
        <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"24px 0 2px" }}>免許・資格・保険方針</p>
        <div>
          {WORKER_DECLARATIONS.map((it, i) => (
            <div key={it.k} style={{ borderBottom: i < WORKER_DECLARATIONS.length - 1 ? "1px solid #EBEBEB" : "none" }}>
              <ToggleSwitch label={it.label} accent={ROLE_ORANGE} checked={selfDeclared.includes(it.k)}
                onChange={(v)=>setSelfDeclared(prev => v ? [...new Set([...prev, it.k])] : prev.filter(x => x !== it.k))} />
            </div>
          ))}
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0", lineHeight:1.5 }}>自己申告です。運営が確認するものではありません。</p>
      </>)}
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
    /* cb-exp-page＝このページ表示中は下部バー・浮遊☰・フッターを隠す（appStyles・2026-08-03たきと指示） */
    <div className="help-edge cb-exp-page" style={{ maxWidth:560, marginLeft:"auto", marginRight:"auto", padding:"24px 20px 96px" }}>
      {/* ← 戻る＝左下の浮遊ボックス（2026-08-03たきと指示。下部バー・☰を消したページの戻り道） */}
      <button onClick={()=>{ let fromApp=false; try{ fromApp=sessionStorage.getItem("cb_expFromApp")==="1"; sessionStorage.removeItem("cb_expFromApp"); }catch{} if (fromApp && window.history.length>1) window.history.back(); else window.location.hash="/profile/worker/profile"; }} className="f-sans"
        style={{ position:"fixed", left:12, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", zIndex:60, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"12px 18px", fontSize:14, fontWeight:600, color:"#222", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.15)", display:"inline-flex", alignItems:"center", gap:6 }}>← 戻る</button>
      <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 6px" }}><NavIconInline name="clipboard" size={22} />経験・できること（自己申告）</h1>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>あなたのプロフィールに「ご本人の申告」として表示されます。運営が確認するものではありません。</p>
      {loading ? (
        <AutoSkeleton fallbackHeight={84} fallbackCount={4} /> /* 読み込み中は入力欄の仮配置（2026-07-27） */
      ) : (<>
        {/* 経験（最大5）／免許・資格・保険方針：縦１本（2026-08-28「経験項目はAirbnbをパクれ」） */}
        <div style={{ marginBottom:20 }}>
          <WorkerExperienceEntries expEntries={expEntries} setExpEntries={setExpEntries} selfDeclared={selfDeclared} setSelfDeclared={setSelfDeclared} />
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
                    border:"1px solid " + (on ? ROLE_ORANGE : "#EBEBEB"), background: on ? "#FFF1E8" : "#F7F7F7", color: on ? ROLE_ORANGE : "#717171",
                  }}>{v}</button>
                );
              })}
            </div>
          </>
        )}

        <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12 }}>{saving ? <>保存中<Dots /></> : "保存する"}</button>
        {saved && <p className="f-sans" style={{ fontSize:12, color:ROLE_ORANGE, textAlign:"center", marginTop:12 }}>保存しました <NavIconInline name="tick" size={12} style={{ verticalAlign:"-1.5px", marginRight:0 }} /></p>}
      </>)}
    </div>
  );
}
