// 自作データ憲法（第2次構造改革2026-08-17でApp.jsxから移設・本文は一字も変えていない）。

// ── DataConstitution ─────────────────────────────────────────
export function DataConstitution({ onClose }) {
  const articles = [
    { num:1,  title:"原本・証憑非公開の原則",   body:"手入力の根拠資料、伝票写真、精算書画像、その他の証憑資料は公開しない。証拠保管、再確認、読取精度向上、本人確認のためにのみ利用し、閲覧は本人、管理者、必要最小限の委託先に限る。" },
    { num:2,  title:"個人識別情報の保護",        body:"氏名、住所、電話番号、メールアドレス、口座番号、振込先、農園名、屋号、伝票番号、担当者名、その他個人または個別農家を識別しうる情報を、本人の同意なく公開・第三者提供しない。" },
    { num:3,  title:"個別収支の非公開",          body:"個別農家の売上、経費、利益、出荷量、販売先別実績を、本人の明示的な同意なく第三者に開示しない。" },
    { num:4,  title:"集計値のみ公開",            body:"公開するデータは、個人、個別農家、個別取引、個別販売先が特定されにくいよう加工した、地域・品目・期間単位の集計値に限る。" },
    { num:5,  title:"最低集計人数",              body:"地域・品目別の集計データは、原則5農家以上のデータが集まるまで表示しない。ただし、5農家以上であっても、地域・品目・面積・販売先等から特定の農家が推定されるおそれがある場合は、表示しない、または地域・期間・分類を広げる。" },
    { num:6,  title:"再特定リスクへの対応",      body:"特殊品目、小規模地域、少数出荷者、特徴的な販売条件など、匿名でも本人または個別農家が推定されうる場合は、広域化、期間拡大、分類変更、非表示により再特定リスクを下げる。" },
    { num:7,  title:"販売先情報の段階的公開",    body:"販売先名・業者名の公開は最終段階とし、データ密度、証拠水準、反論窓口、法務確認を条件とする。それまでは本人画面、内部集計、販売先分類での分析にのみ使用する。" },
    { num:8,  title:"未確認データの非確定",      body:"手入力データ、AI読取結果、アップロード資料から抽出されたデータは、本人確認または必要な確認手続きを経るまで確定データとして扱わない。未確認データを、外部公開、法人向け提供、販売先比較、信用判断用レポートに使用しない。" },
    { num:9,  title:"利用目的の事前明示",        body:"データの利用目的を事前に明示し、明示された目的の範囲を超えて利用しない。利用目的を追加する場合は、改めて本人に通知し、必要に応じて同意を得る。" },
    { num:10, title:"本人の権利保障と最小保存",  body:"本人からのデータ訂正、削除、利用停止の請求に応じる導線を常に用意する。退会後は、原則30日以内に個人に紐づくデータを削除、または個人との紐づけを解除した統計データとして処理する。ただし、法令対応、不正防止、請求・同意履歴、運用上必要な最小限の記録は、目的と期間を限定して保存する。" },
    { num:11, title:"管理者閲覧の記録",          body:"管理者が原本資料、個別収支、個人識別情報、取引情報を閲覧・修正・承認した場合は、日時、対象データ、操作内容を記録する。" },
    { num:12, title:"漏えい・事故対応",          body:"個人情報、原本資料、個別収支、取引情報の漏えい、誤公開、不正閲覧のおそれがある場合は、速やかに公開停止、影響範囲確認、本人通知、必要な報告、再発防止を行う。" },
  ];

  return (
    <div className="cb-lock-scroll"
      style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.38)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}
    >
      <div
        style={{ position:"relative", width:"min(92vw, 920px)", maxHeight:"88vh", overflowY:"auto", background:"#FFFFFF", borderRadius:24, padding:"32px", boxShadow:"0 24px 80px rgba(0,0,0,0.18)", fontFamily:"'Noto Sans JP','Inter',sans-serif" }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", margin:"0 0 4px", textAlign:"center" }}>データ憲法</h2>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:24 }}>日本農業研究所（chitose-bank） v1.1 · 制定日：2026年5月25日</p>
        <div style={{ display:"grid", gap:20 }}>
          <div style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
            <p className="f-sans" style={{ fontSize:16, color:"#444", lineHeight:1.9, margin:0, textAlign:"left" }}>
              本文書は、日本農業研究所（chitose-bank）がデータを取り扱う上での基本原則を定めたものです。すべての機能開発・運用判断はこの原則に基づきます。
            </p>
          </div>
          {articles.map(a => (
            <div key={a.num} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
              <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>第{a.num}条　{a.title}</h3>
              <p className="f-sans" style={{ fontSize:16, color:"#444", lineHeight:1.9, margin:0, textAlign:"left" }}>{a.body}</p>
            </div>
          ))}
        </div>
        <div style={{ textAlign:"center", marginTop:28 }}>
          <button onClick={onClose} style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:12, padding:"13px 48px", fontSize:14, fontWeight:600, cursor:"pointer" }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
