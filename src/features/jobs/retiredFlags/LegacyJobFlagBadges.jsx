import { useState } from "react";
import { NavIconInline } from "../../../components/NavIcons";
import { LEGACY_JOB_FLAG_INFO } from "./legacyFlagInfo.js";

export function LegacyJobFlagBadges({ beginner, expert, repeat }) {
  const [open, setOpen] = useState(null); // "beginner"|"expert"|"repeat"|null
  const keys = [beginner && "beginner", expert && "expert", repeat && "repeat"].filter(Boolean);
  if (keys.length === 0) return null;
  return (
    <>
      {keys.map(k => {
        const b = LEGACY_JOB_FLAG_INFO[k];
        return (
          <button key={k} onClick={()=>setOpen(o => (o === k ? null : k))} className="f-sans"
            style={{ fontSize:12, fontWeight:700, color:b.fg, background:b.bg, padding:"4px 12px", borderRadius:20, border:"none", cursor:"pointer" }}>
            <NavIconInline name={b.iconName} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} />{b.label} {open === k ? "▴" : "▾"}
          </button>
        );
      })}
      {open && (
        <span className="f-sans fade-in" style={{ display:"block", width:"100%", fontSize:12, color:LEGACY_JOB_FLAG_INFO[open].fg, background:LEGACY_JOB_FLAG_INFO[open].bg, borderRadius:10, padding:"8px 12px", lineHeight:1.6 }}>
          {LEGACY_JOB_FLAG_INFO[open].desc}
        </span>
      )}
    </>
  );
}
