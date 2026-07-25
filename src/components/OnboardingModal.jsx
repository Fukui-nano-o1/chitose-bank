// 分割3-B（2026-07-25）：App.jsxから移動。農家向け初期設定モーダル（就農情報の入力）。
// isWorkerゲート（働き手には出さない）は呼び出し側Appの起動条件で担保（fable5事件③の根治・2026-07-03）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { C, toKatakana } from "../lib/utils";

export const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];


// ── 作物名正規化 ──────────────────────────────────────────────
function normalizeCropKey(name = "") {
  return toKatakana(String(name).trim().normalize("NFKC"))
    .replace(/\s+/g, "").replace(/[・･]/g, "").toLowerCase();
}
const CROP_CANONICAL_MAP = {
  "ブロッコリー":"ブロッコリー","ブロッコリ":"ブロッコリー","ぶろっこりー":"ブロッコリー",
  "ぶろっこり":"ブロッコリー","ﾌﾞﾛｯｺﾘｰ":"ブロッコリー","broccoli":"ブロッコリー",
  "ナス":"なす","なす":"なす","茄子":"なす",
  "スイートコーン":"スイートコーン","すいーとこーん":"スイートコーン",
  "トウモロコシ":"スイートコーン","とうもろこし":"スイートコーン","とうきび":"スイートコーン",
  "ネギ":"ねぎ","ねぎ":"ねぎ","葱":"ねぎ",
};
function canonicalCropName(name = "") {
  const raw = String(name).trim();
  if (!raw) return "";
  const key = normalizeCropKey(raw);
  const found = Object.entries(CROP_CANONICAL_MAP).find(([k]) => normalizeCropKey(k) === key);
  return found ? found[1] : raw.normalize("NFKC");
}
function uniqueCropsByCanonical(crops = []) {
  const map = new Map();
  crops.filter(Boolean).forEach(c => {
    const canonical = canonicalCropName(c);
    const key = normalizeCropKey(canonical);
    if (!map.has(key)) map.set(key, canonical);
  });
  return [...map.values()];
}

// ── OnboardingModal ──────────────────────────────────────────
const OB_SALES_CHANNELS = [
  { label:"JA（農協）出荷",           value:"ja" },
  { label:"市場出荷",                  value:"market" },
  { label:"直売所",                    value:"direct_store" },
  { label:"直接取引（レストラン・小売等）", value:"direct_trade" },
  { label:"ネット販売",                value:"online" },
  { label:"まだ決めていない",          value:"undecided" },
];

export function OnboardingModal({ me, setMe, onComplete, isEditing = false, onClose }) {
  const lfDraft = JSON.parse(localStorage.getItem('landingFlowDraft_v1') || '{}');
  const totalSteps = 9;
  const [obStep, setObStep] = useState(1);
  const [obName,         setObName]         = useState(isEditing ? (me.name || "") : "");
  const [obPrefecture,   setObPrefecture]   = useState(me.prefecture || "");
  const [obMunicipality, setObMunicipality] = useState(me.municipality || (lfDraft.farmerRegion || "").replace(/周辺$/, "") || "");
  const [obTier,         setObTier]         = useState(me.experience_tier || "");
  const [obFarmingType, setObFarmingType] = useState(me.farming_type || localStorage.getItem('ob_farming_type') || "");
  const [obArea,        setObArea]        = useState(me.area_tan || localStorage.getItem('ob_area_tan') || "");
  const [obCrops,       setObCrops]       = useState(
    (me.planned_crops && me.planned_crops.length) ? me.planned_crops
    : [lfDraft.farmerCropPill || lfDraft.farmerCropText].filter(Boolean)
  );
  const [obChannels,    setObChannels]    = useState(() => {
    if (me.sales_channels && Array.isArray(me.sales_channels) && me.sales_channels.length > 0) return me.sales_channels;
    try { return JSON.parse(localStorage.getItem('ob_sales_channels') || '[]'); } catch { return []; }
  });
  const [cropInput,     setCropInput]     = useState("");
  const [cropCandidates,setCropCandidates]= useState([]);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    supabase.from('market_stats').select('crop').then(({ data }) => {
      if (data) setCropCandidates([...new Set(data.map(d => d.crop).filter(Boolean))].sort());
    });
  }, []);

  const canGoNext = [null, !!obName.trim(), !!obPrefecture, !!obMunicipality.trim(), !!obTier, !!obFarmingType, Number(obArea) > 0, obCrops.length > 0, obChannels.length > 0, true][obStep] ?? true;

  const goNext = () => { if (obStep < totalSteps) setObStep(s => s + 1); else handleSubmit(); };
  const goBack = () => setObStep(s => s - 1);

  const toggleCrop = crop => setObCrops(prev => {
    if (prev.includes(crop)) return prev.filter(c => c !== crop);
    if (prev.length >= 5) return prev;
    return [...prev, crop];
  });

  const addCustomCrop = () => {
    const c = cropInput.trim();
    if (!c || obCrops.includes(c) || obCrops.length >= 5) { setCropInput(""); return; }
    setObCrops(prev => [...prev, c]);
    setCropInput("");
  };

  const toggleChannel = value => {
    if (value === "undecided") {
      setObChannels(prev => prev.includes("undecided") ? [] : ["undecided"]);
    } else {
      setObChannels(prev => {
        const without = prev.filter(c => c !== "undecided");
        return without.includes(value) ? without.filter(c => c !== value) : [...without, value];
      });
    }
  };

  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('farmers').upsert({
        email: user.email,
        auth_id: user.id,
        name: obName.trim(),
        prefecture: obPrefecture,
        municipality: obMunicipality.trim(),
        experience_tier: obTier,
        farming_type: obFarmingType,
        area_tan: String(parseFloat(obArea) || 0),
        planned_crops: uniqueCropsByCanonical(obCrops),
        sales_channels: obChannels,
      }, { onConflict: 'email' });
      if (!error) {
        try { localStorage.setItem('ob_farming_type', obFarmingType); } catch {}
        try { localStorage.setItem('ob_area_tan', obArea); } catch {}
        try { localStorage.setItem('ob_sales_channels', JSON.stringify(obChannels)); } catch {}
        const { data: farmer } = await supabase.from('farmers').select('*').eq('email', user.email).single();
        if (farmer) setMe(farmer);
        await onComplete({ name: obName.trim(), prefecture: obPrefecture, municipality: obMunicipality.trim(), experience_tier: obTier, planned_crops: uniqueCropsByCanonical(obCrops) });
      } else {
        console.error('onboarding save error:', error);
        alert(`保存に失敗しました。\n${error.message || JSON.stringify(error)}`);
      }
    } catch (e) {
      console.error('onboarding save exception:', e);
      alert(`保存に失敗しました。\n${e.message || String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const CardBtn = ({ selected, onClick, children }) => (
    <button onClick={onClick} style={{
      width:"100%", textAlign:"left", padding:"20px", borderRadius:16,
      border: selected ? `2px solid ${C.accent}` : `2px solid ${C.border}`,
      background: selected ? C.accentLight : "#fff",
      fontSize:16, fontWeight: selected ? 600 : 400,
      color:C.ink, cursor:"pointer", transition:"all .15s", marginBottom:10,
    }}>{children}</button>
  );

  const stepContent = [
    // 1: 名前
    <div style={{ marginTop:32 }}>
      <input
        type="text" placeholder="例：田中太郎" value={obName} autoFocus
        onChange={e => setObName(e.target.value)}
        onKeyDown={e => e.key === "Enter" && obName.trim() && goNext()}
        style={{
          width:"100%", fontSize:24, textAlign:"center",
          border:"none", borderBottom:`2px solid ${C.ink}`,
          outline:"none", padding:"12px 0", background:"transparent",
          color:C.ink, fontFamily:"'Noto Sans JP',sans-serif",
        }}
      />
    </div>,

    // 2: 都道府県
    <div style={{
      display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginTop:24,
      maxHeight:"52vh", overflowY:"auto",
    }}>
      {PREFECTURES.map(p => (
        <button key={p} onClick={() => setObPrefecture(p)} style={{
          padding:"12px 4px", borderRadius:12, fontSize:13,
          border:`1px solid ${obPrefecture === p ? C.accent : C.border}`,
          background: obPrefecture === p ? C.accent : "#fff",
          color: obPrefecture === p ? "#fff" : C.ink,
          fontWeight: obPrefecture === p ? 600 : 400,
          cursor:"pointer", transition:"all .12s",
        }}>{p}</button>
      ))}
    </div>,

    // 3: 市町村
    <div style={{ marginTop:32 }}>
      <input
        type="text" placeholder="例：吉野川市山川町" value={obMunicipality} autoFocus
        onChange={e => setObMunicipality(e.target.value)}
        onKeyDown={e => e.key === "Enter" && goNext()}
        style={{
          width:"100%", fontSize:20, textAlign:"center",
          border:"none", borderBottom:`2px solid ${C.ink}`,
          outline:"none", padding:"12px 0", background:"transparent",
          color:C.ink, fontFamily:"'Noto Sans JP',sans-serif",
        }}
      />
      <p className="f-sans" style={{ fontSize:12, color:C.ghost, marginTop:16, textAlign:"center" }}>
        地域の経営指標をより正確に参照できます
      </p>
    </div>,

    // 4: 就農歴
    <div style={{ marginTop:24 }}>
      {[
        { label:"まだ始めていない（未就農）", value:"0" },
        { label:"1〜3年",  value:"1-3" },
        { label:"4〜10年", value:"4-10" },
        { label:"10年以上", value:"10+" },
      ].map(({ label, value }) => (
        <CardBtn key={value} selected={obTier === value} onClick={() => setObTier(value)}>{label}</CardBtn>
      ))}
    </div>,

    // 4: 専業/兼業
    <div style={{ marginTop:24 }}>
      <CardBtn selected={obFarmingType === "fulltime"} onClick={() => setObFarmingType("fulltime")}>専業農家（農業のみ）</CardBtn>
      <CardBtn selected={obFarmingType === "parttime"} onClick={() => setObFarmingType("parttime")}>兼業農家（他の仕事も）</CardBtn>
    </div>,

    // 5: 経営面積
    <div style={{ textAlign:"center", marginTop:48 }}>
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"center", gap:12 }}>
        <input
          type="number" min="0" value={obArea} autoFocus
          onChange={e => setObArea(e.target.value)}
          onKeyDown={e => e.key === "Enter" && goNext()}
          style={{
            width:160, fontSize:48, textAlign:"center",
            border:"none", borderBottom:`2px solid ${C.ink}`,
            outline:"none", padding:"8px 0", background:"transparent",
            color:C.ink, fontFamily:"'DM Mono','Courier New',monospace",
          }}
        />
        <span className="f-sans" style={{ fontSize:24, color:C.mid, marginBottom:10 }}>反</span>
      </div>
      <p className="f-sans" style={{ fontSize:12, color:C.ghost, marginTop:20 }}>1反 = 約1,000㎡ = 約10a</p>
    </div>,

    // 6: 栽培作物
    <div style={{ marginTop:20 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <input
          type="text" placeholder="作物名を入力してEnter" value={cropInput}
          onChange={e => setCropInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addCustomCrop()}
          style={{
            flex:1, border:`1px solid ${C.border}`, borderRadius:12,
            padding:"10px 14px", fontSize:14, outline:"none",
            fontFamily:"'Noto Sans JP',sans-serif",
          }}
        />
        <span className="f-mono" style={{ fontSize:13, color:C.mid, fontWeight:600, whiteSpace:"nowrap" }}>
          {obCrops.length}/5
        </span>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, maxHeight:"42vh", overflowY:"auto" }}>
        {[...new Set([...obCrops, ...cropCandidates])].map(crop => {
          const sel = obCrops.includes(crop);
          return (
            <button key={crop} onClick={() => toggleCrop(crop)} style={{
              padding:"8px 16px", borderRadius:20,
              border:`1px solid ${sel ? C.accent : C.border}`,
              background: sel ? C.accent : "#fff",
              color: sel ? "#fff" : C.ink,
              fontSize:13, fontWeight: sel ? 600 : 400,
              cursor: !sel && obCrops.length >= 5 ? "not-allowed" : "pointer",
              opacity: !sel && obCrops.length >= 5 ? 0.35 : 1,
              transition:"all .12s",
            }}>{crop}</button>
          );
        })}
      </div>
    </div>,

    // 7: 販売先
    <div style={{ marginTop:24 }}>
      {OB_SALES_CHANNELS.map(({ label, value }) => {
        const sel = obChannels.includes(value);
        return (
          <button key={value} onClick={() => toggleChannel(value)} style={{
            width:"100%", textAlign:"left", padding:"18px 20px", borderRadius:16,
            border: sel ? `2px solid ${C.accent}` : `2px solid ${C.border}`,
            background: sel ? C.accentLight : "#fff",
            fontSize:15, fontWeight: sel ? 600 : 400,
            color:C.ink, cursor:"pointer", transition:"all .15s", marginBottom:8, display:"block",
          }}>{label}</button>
        );
      })}
    </div>,

    // 8: 確認画面
    <div style={{ maxWidth:400, margin:"0 auto", padding:24, background:"#F7F7F7", borderRadius:20 }}>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ width:80, height:80, borderRadius:"50%", background:"#00A86B22", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", fontSize:36 }}>🌾</div>
        <p className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222" }}>{obName}</p>
      </div>
      <div style={{ display:"grid", gap:12 }}>
        {[
          { icon:"📍", label:"都道府県", value: obPrefecture },
          { icon:"📍", label:"市区町村", value: obMunicipality },
          { icon:"📅", label:"就農歴", value: obTier },
          { icon:"🌾", label:"専業/兼業", value: obFarmingType === "fulltime" ? "専業農家" : "兼業農家" },
          { icon:"📐", label:"経営面積", value: obArea + " 反" },
        ].map(item => (
          <div key={item.label} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"#fff", borderRadius:10 }}>
            <span style={{ fontSize:18 }}>{item.icon}</span>
            <span className="f-sans" style={{ fontSize:12, color:"#717171", width:80 }}>{item.label}</span>
            <span className="f-sans" style={{ fontSize:14, fontWeight:600, color:"#222" }}>{item.value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop:12, display:"flex", flexWrap:"wrap", gap:6 }}>
        <span className="f-sans" style={{ fontSize:11, color:"#717171", marginRight:4 }}>栽培作物:</span>
        {obCrops.map(c => (
          <span key={c} style={{ padding:"4px 10px", background:"#E6F7EF", borderRadius:999, fontSize:12, color:"#00A86B", fontWeight:600 }}>{c}</span>
        ))}
      </div>
      <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:6 }}>
        <span className="f-sans" style={{ fontSize:11, color:"#717171", marginRight:4 }}>販売先:</span>
        {obChannels.map(s => {
          const ch = OB_SALES_CHANNELS.find(c => c.value === s);
          return (
            <span key={s} style={{ padding:"4px 10px", background:"#FEF3E2", borderRadius:999, fontSize:12, color:"#F5A623", fontWeight:600 }}>{ch ? ch.label : s}</span>
          );
        })}
      </div>
    </div>,
  ];

  const stepMeta = [
    {
      title:"お名前を教えてください",
      sub:"五年計画書に表示されます",
      desc:"五年計画書や融資資料に表示されます。本名をご入力ください。",
    },
    {
      title:"どちらにお住まいですか？",
      sub:"地域の経営指標を参照します",
      desc:"お住まいの地域の経営指標を自動で参照します。より正確な五年計画書を作成できます。",
    },
    {
      title:"市区町村を教えてください",
      sub:"地域の経営データに活用します",
      desc:"同じ地域の農家同士で経営データを比較できます。例：吉野川市、阿南市、美馬市など。",
    },
    {
      title:"農業の経験は？",
      sub:"同じ経験年数の農家と比較できます",
      desc:"同じ経験年数の農家と収支を比較できます。これから始める方は「まだ始めていない」を選んでください。",
    },
    {
      title:"農業は専業ですか？",
      sub:"収支構造の参考にします",
      desc:"専業と兼業では経営の収支構造が大きく異なります。五年計画書の農外所得の計算に使用します。",
    },
    {
      title:"経営面積を教えてください",
      sub:"おおよそで構いません（反）",
      desc:"10a（1反）あたりの収支を計算する基準になります。これから始める方は予定の面積でOKです。",
    },
    {
      title:"何を栽培していますか？",
      sub:"最大5つまで選べます（予定でもOK）",
      desc:"選んだ作物の公的統計データを五年計画書に自動で反映します。予定の作物でもOKです。最大5つまで。",
    },
    {
      title:"主な販売先は？",
      sub:"複数選べます（予定でもOK）",
      desc:"販売先によって手数料や運賃などの経費構造が変わります。将来の収支比較にも活用されます。",
    },
    {
      title:"プロフィール確認",
      sub:"内容をご確認ください",
      desc:"以下の内容で登録します。修正したい場合は「戻る」を押してください。",
    },
  ];

  const { title, sub, desc } = stepMeta[obStep - 1];

  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9999 }}>
      {/* プログレスバー */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:C.border }}>
        <div style={{
          height:4, background:C.accent,
          width:`${(obStep / totalSteps) * 100}%`,
          transition:"width 0.3s ease",
        }} />
      </div>

      {/* 閉じるボタン（編集時のみ） */}
      {isEditing && (
        <button
          onClick={onClose}
          style={{
            position:"absolute", top:16, right:20,
            background:"none", border:"none",
            fontSize:22, color:C.mid, cursor:"pointer",
            lineHeight:1, padding:4, zIndex:1,
          }}
        >✕</button>
      )}

      {/* コンテンツ */}
      <div style={{ maxWidth:480, margin:"0 auto", padding:"56px 24px 140px", overflowY:"auto", height:"100%" }}>
        <div key={obStep} className="fade-in">
          <h1 className="f-sans" style={{ fontSize:26, fontWeight:700, color:C.ink, marginBottom:8, lineHeight:1.35 }}>
            {title}
          </h1>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:24 }}>{desc}</p>
          {stepContent[obStep - 1]}
        </div>
      </div>

      {/* ボトムナビ */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        background:"#fff", borderTop:`1px solid ${C.border}`,
        padding:"20px 24px calc(20px + env(safe-area-inset-bottom, 0px))",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        {obStep > 1
          ? <button onClick={goBack} className="f-sans" style={{
              background:"none", border:"none", fontSize:15,
              color:C.ink, cursor:"pointer", padding:"8px 0",
            }}>← 戻る</button>
          : <div />
        }
        <button
          onClick={canGoNext ? goNext : undefined}
          style={{
            background:C.accent, color:"#fff",
            border:"none", borderRadius:12,
            padding:"16px 32px", fontSize:16, fontWeight:700,
            cursor: canGoNext ? "pointer" : "not-allowed",
            opacity: canGoNext ? 1 : 0.5,
            pointerEvents: canGoNext ? "auto" : "none",
            transition:"opacity .2s",
          }}
        >
          {saving ? "保存中..." : obStep === totalSteps ? "この内容で始める →" : "次へ →"}
        </button>
      </div>
    </div>
  );
}
