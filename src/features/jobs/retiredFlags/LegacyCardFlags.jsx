import { NavIconInline } from "../../../components/NavIcons";
export function LegacyCardFlags({job,isList}) { return <>
        {(job.beginnerOk || job.experiencedPreferred || job.instantApproveRepeat) && (
          <div className="job-card-conditions" style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap" }}>
            {job.beginnerOk && <span className="f-sans" style={{ fontSize: isList?11:10, fontWeight:700, color:"#00A86B", background:"#E6F7EF", padding:"2px 8px", borderRadius:20 }}><NavIconInline name="sparkle" size={isList?11:10} style={{ verticalAlign:"-1.5px", marginRight:3 }} />初心者大歓迎</span>}
            {job.experiencedPreferred && <span className="f-sans" style={{ fontSize: isList?11:10, fontWeight:700, color:"#1A56C5", background:"#E8F0FE", padding:"2px 8px", borderRadius:20 }}><NavIconInline name="medal" size={isList?11:10} style={{ verticalAlign:"-1.5px", marginRight:3 }} />経験者優遇</span>}
            {job.instantApproveRepeat && <span className="f-sans" style={{ fontSize: isList?11:10, fontWeight:700, color:"#8A6D1D", background:"#FFF8E7", padding:"2px 8px", borderRadius:20 }}><NavIconInline name="repeat" size={isList?11:10} style={{ verticalAlign:"-1.5px", marginRight:3 }} />リピート即決</span>}
          </div>
        )}
</>; }
