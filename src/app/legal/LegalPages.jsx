import { AnalyticsPreferences } from "../../components/AnalyticsPreferences";
import { PRIVACY_SECTIONS, PrivacyDataTable } from "./PrivacyPolicy";
import { TERMS_ARTICLES, renderRichText } from "../../Terms";

export function CharterPage() {
  return (
<div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>運営憲章</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／改訂：2026年7月24日</p>

            <nav style={{ display:"grid", gap:10, marginBottom:36 }}>
              {[
                { id:"charter-ch1", l:"一、この場について" },
                { id:"charter-ch2", l:"二、三つの原則" },
                { id:"charter-ch3", l:"三、我々の仕事" },
                { id:"charter-ch4", l:"四、双方に寄り添うこと" },
                { id:"charter-ch5", l:"五、これからの仕組みについて" },
                { id:"charter-def", l:"定義" },
              ].map(t => (
                <button key={t.id} onClick={()=>{ document.getElementById(t.id)?.scrollIntoView({ behavior:"smooth", block:"start" }); }} className="f-sans" style={{ fontSize:17, fontWeight:600, color:"#00A86B", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", cursor:"pointer", padding:"14px 18px", textAlign:"left", width:"100%" }}>{t.l}</button>
              ))}
            </nav>

            <div style={{ display:"grid", gap:28 }}>

              <section id="charter-ch1" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>一、この場について</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>農業の雇用には、雇用して初めて分かることが二つある。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>雇い手にとっては働き手の技術と知識、働き手にとっては職場の環境と待遇である。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、その双方を事実として記録し、雇い手と働き手が雇用の前に互いを判断できる場を運営する。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>働き手は自らの望む条件を示すことができ、雇い手はそれに応えることができる。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>記録の積み重ねが働き手の資産となり、頼れる担い手が育っていく土壌となることを大切にする。</p>
              </section>

              <section id="charter-ch2" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>二、三つの原則</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>1. 我々は、当事者どうしの連絡を制限しない。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>2. 我々は、雇用の成立に対する成功報酬を、現在も将来も受け取らない。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>3. 我々は、採用の判断に関与しない。誰を選ぶかは、農家と働き手が決める。</p>
              </section>

              <section id="charter-ch3" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>三、我々の仕事</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、場を整え、約束の記録を守り、法令に反する掲載を防ぐ。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>実績は、この場での働きの記録からだけ作られる。我々はそれを改変せず、飾らない。</p>
              </section>

              <section id="charter-ch4" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>四、双方に寄り添うこと</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、農家と働き手のどちらか一方の味方ではなく、双方に寄り添う立場で運営する。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>困りごとの窓口を常に開き、寄せられた声には必ず返事をする。</p>
              </section>

              <section id="charter-ch5" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>五、これからの仕組みについて</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>農作業の委託・受託など、新しい仕組みをこの場に加えるときは、その約束をこの憲章に書き足してから始める。黙って変えることはしない。</p>
              </section>

              <section id="charter-def" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>定義</h2>
                <p className="f-sans" style={{ fontSize:15, color:"#555", lineHeight:2, margin:0 }}>※　働き手とは、農作業に携わるために本サービスを利用する者をいう。</p>
                <p className="f-sans" style={{ fontSize:15, color:"#555", lineHeight:2, margin:0 }}>※　農家とは、農作業の求人を掲載する者をいう。</p>
              </section>

            </div>
          </div>
  );
}

export function PrivacyPage() {
  return (
<div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>プライバシーポリシー</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改訂：2026年7月21日／改訂：2026年9月23日</p>
            <AnalyticsPreferences always />

            <nav style={{ display:"grid", gap:10, marginBottom:36 }}>
              {PRIVACY_SECTIONS.map(s => (
                <button key={s.id}
                  onClick={()=>{ document.getElementById(s.id)?.scrollIntoView({ behavior:"smooth", block:"start" }); }}
                  className="f-sans"
                  style={{ fontSize:17, fontWeight:600, color:"#00A86B", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", cursor:"pointer", padding:"14px 18px", textAlign:"left", width:"100%" }}>
                  {s.title}
                </button>
              ))}
            </nav>

            {/* 各条の箱の minWidth:0 は、モーダル側（app/legal/PrivacyPolicy.jsx）と同じ理由＝表が箱を押し広げないように */}
            <div style={{ display:"grid", gap:20 }}>
              {PRIVACY_SECTIONS.map((s, i) => (
                <div key={i} id={s.id} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB", scrollMarginTop:88, minWidth:0 }}>
                  <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>{s.title}</h3>
                  {s.body.map((p, j) => (
                    <p key={j} className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin: j < s.body.length-1 ? "0 0 8px" : 0, textAlign:"left" }}>{renderRichText(p)}</p>
                  ))}
                  {s.table && <div style={{ marginTop:12 }}><PrivacyDataTable table={s.table} /></div>}
                </div>
              ))}
            </div>
          </div>
  );
}

export function TermsPage() {
  return (
<div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>利用規約</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改訂：2026年7月21日／一部改訂：2026年8月19日</p>

            <nav style={{ display:"grid", gap:10, marginBottom:36 }}>
              {TERMS_ARTICLES.map(a => (
                <button key={a.id}
                  onClick={()=>{ document.getElementById(a.id)?.scrollIntoView({ behavior:"smooth", block:"start" }); }}
                  className="f-sans"
                  style={{ fontSize:17, fontWeight:600, color:"#00A86B", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", cursor:"pointer", padding:"14px 18px", textAlign:"left", width:"100%" }}>
                  {a.title}
                </button>
              ))}
            </nav>

            <div style={{ display:"grid", gap:20 }}>
              {TERMS_ARTICLES.map((a, i) => (
                <div key={i} id={a.id} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB", scrollMarginTop:88 }}>
                  <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>{a.title}</h3>
                  {a.body.map((p, j) => (
                    <p key={j} className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin: j < a.body.length-1 ? "0 0 8px" : 0, textAlign:"left" }}>{renderRichText(p)}</p>
                  ))}
                </div>
              ))}
            </div>
          </div>
  );
}

