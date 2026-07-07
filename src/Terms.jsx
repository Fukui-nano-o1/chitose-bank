export const TERMS_ARTICLES = [
  { id:"terms-1",  title:"第1条 サービスの位置づけ", body:[
    "当社は、農家と働き手が利用する求人情報および求職情報の掲載の場 chitose-bank を提供する。",
    "当社は、求人情報および求職情報を掲載する場の提供者として本サービスを運営する。",
    "雇用条件の交渉、契約の締結、雇用の開始は、農家と働き手が当事者として直接おこなう。",
    "当社は、当事者間の雇用関係の成立に関与しない。",
  ]},
  { id:"terms-2",  title:"第2条 適用および同意", body:[
    "本規約は、本サービスを利用する全ての者に適用する。",
    "利用者は、登録の時点で本規約に同意したものとする。",
  ]},
  { id:"terms-3",  title:"第3条 登録", body:[
    "利用者は、本人の情報を正確に登録する。",
    "利用者は、メールアドレスまたは電話番号による認証を経て登録する。",
    "利用者は、1人につき1つのアカウントを保有する。",
    "当社は、18歳以上の者に登録を認める。",
  ]},
  { id:"terms-4",  title:"第4条 利用者の責任", body:[
    "利用者は、自らが掲載する情報の正確性について責任を負う。",
    "利用者は、認証情報を自らの管理下に置く。",
    "利用者は、本サービスを通じて生じた当事者間のやり取りについて、当事者として責任を負う。",
  ]},
  { id:"terms-5",  title:"第5条 禁止事項", body:[
    "利用者は、次の行為をおこなわない。",
    "虚偽の求人情報または求職情報を掲載する行為。",
    "他人になりすまして登録または利用する行為。",
    "本サービスの運営を妨げる行為。",
    "本サービスの認証または管理の仕組みへ不正に接触する行為。",
    "他の利用者を威圧し、または誹謗する行為。",
    "法令または公序良俗に反する行為。",
  ]},
  { id:"terms-6",  title:"第6条 個人情報の取り扱い", body:[
    "当社は、利用者の個人情報を、プライバシーポリシーに従って取り扱う。",
  ]},
  { id:"terms-7",  title:"第7条 掲載情報の公開", body:[
    "利用者は、求人情報および求職情報が本サービス上で公開されることに同意する。",
    "利用者は、本サービスを通じた労働の実績が記録され、作物別および作業別の労働時間、労働の件数、再指名の状況、無断欠勤のない記録として、求職情報とともに農家に公開されることに同意する。",
  ]},
  { id:"terms-8",  title:"第8条 当事者間の取引", body:[
    "農家と働き手は、本サービス上で応募、承認、打合せ、面接、契約、労働、評価にいたる一連のやり取りをおこなう。",
    "農家と働き手は、報酬、労働条件、契約の内容を、当事者間で定める。",
  ]},
  { id:"terms-9",  title:"第9条 免責", body:[
    "当社は、農家と働き手の間に生じた紛争について、当事者間の解決に委ねる。",
    "当社は、報酬の未払い、労働条件の相違、労働中の事故その他の当事者間の事由について、当事者間の解決に委ねる。",
    "当社は、本サービスの中断、停止、変更が生じた場合、法令の定める範囲で責任を負う。",
  ]},
  { id:"terms-10", title:"第10条 知的財産", body:[
    "本サービスを構成するシステム、意匠、プログラムに関する権利は、当社に帰属する。",
    "利用者が掲載した情報に関する権利は、当該利用者に帰属する。",
    "利用者は、掲載した情報を当社が本サービスの提供に必要な範囲で利用することに同意する。",
  ]},
  { id:"terms-11", title:"第11条 利用停止および退会", body:[
    "利用者は、いつでも退会の手続きをおこなうことができる。",
    "当社は、利用者が本規約に違反した場合、本サービスの利用を停止し、または登録を解除することができる。",
    "当社は、この場合に必要となる本人の特定を、運営管理情報に基づいておこなう。",
  ]},
  { id:"terms-12", title:"第12条 規約の変更", body:[
    "当社は、本規約を変更する場合、本サービス上で公表する。",
    "当社は、変更後の内容を、公表の時点から適用する。",
  ]},
  { id:"terms-13", title:"第13条 準拠法および管轄", body:[
    "本規約は、日本法に準拠する。",
    "本サービスに関して紛争が生じた場合、徳島地方裁判所を専属的合意管轄とする。",
  ]},
  { id:"terms-14", title:"第14条 お問い合わせ窓口", body:[
    "本規約に関する問い合わせは、次の窓口で受け付ける。",
    "窓口：【　　　　　】",
  ]},
  { id:"terms-15", title:"第15条 分離可能性", body:[
    "本規約の一部が無効とされた場合であっても、他の条項は効力を有する。",
  ]},
];

export default function Terms({ onClose }) {
  const articles = TERMS_ARTICLES;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto", padding: "40px 16px 60px",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#fff", borderRadius: 16, maxWidth: 720, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
        fontFamily: "'Noto Sans JP','Inter',sans-serif",
      }}>
        {/* ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "24px 32px 20px",
          borderBottom: "1px solid #EBEBEB",
        }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#222", margin: 0, textAlign: "center" }}>利用規約</h1>
            <p style={{ fontSize: 11, color: "#B0B0B0", marginTop: 4 }}>日本農業研究所（chitose-bank） v1.0 · 最終更新日：2026年7月8日</p>
          </div>
          <button onClick={onClose} aria-label="閉じる" style={{
            width: 40, height: 40, borderRadius: 999, border: "1px solid #EBEBEB",
            background: "#FFFFFF", color: "#222222", fontSize: 24, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)", flexShrink: 0,
          }}>×</button>
        </div>

        {/* 本文 */}
        <div style={{ padding: "28px 32px 36px", display: "grid", gap: 28 }}>
          {articles.map((a, i) => (
            <div key={i} style={{
              padding: "20px 24px",
              background: "#F7F7F7",
              borderRadius: 16,
              border: "1px solid #EBEBEB",
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "#222", marginBottom: 12 }}>{a.title}</h2>
              {a.body.map((p, j) => (
                <p key={j} style={{ fontSize: 14, color: "#444", lineHeight: 1.9, margin: j < a.body.length-1 ? "0 0 8px" : 0, textAlign: "left" }}>{p}</p>
              ))}
            </div>
          ))}
        </div>

        <div style={{ padding: "0 32px 28px", textAlign: "center" }}>
          <button onClick={onClose} style={{
            background: "#00A86B", color: "#fff", border: "none",
            borderRadius: 12, padding: "13px 48px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
