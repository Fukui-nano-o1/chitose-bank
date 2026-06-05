export default function Terms({ onClose }) {
  const articles = [
    { title:"第1条　サービス概要",           body:"日本農業研究所（以下「当研究所」）が運営するchitose-bank（以下「本サービス」）は、農業経営データの記録・集計・資料作成支援を目的とする情報サービスです。本サービスは銀行ではありません。預金、融資実行、為替取引、金融商品の販売は行いません。" },
    { title:"第2条　適用範囲・同意",         body:"本規約は、本サービスを閲覧または利用するすべての利用者（以下「利用者」）に適用されます。利用者は、本サービスの閲覧または利用により本規約に同意したものとみなします。登録機能を利用する場合は、登録時に本規約およびプライバシーポリシーを確認し、同意するものとします。" },
    { title:"第3条　登録",                   body:"利用者は、メールアドレスによる認証を経て登録します。登録時に虚偽の情報を提供してはなりません。1人の利用者が複数のアカウントを登録することはできません。" },
    { title:"第4条　利用者の責任",           body:"利用者は、自己が入力するデータの正確性について責任を負います。利用者は、自己の認証情報を第三者に共有してはなりません。利用者が本規約に違反した場合、当研究所は当該利用者の利用を制限または停止できるものとします。" },
    { title:"第5条　禁止事項", body:"利用者は、以下の行為を行ってはなりません。",
      bullets:[
        "虚偽のデータを入力すること",
        "他人のデータまたは他人の伝票・証憑を投稿すること",
        "他人になりすまして登録または利用すること",
        "本サービスの集計データを、出典を明記せず転載・再配布すること",
        "本サービスから得た情報を用いて特定の農家・販売先を誹謗中傷すること",
        "本サービスのデータを機械的に大量取得すること",
        "本サービスの公開条件・アクセス制限を回避しようとすること",
        "本サービスのシステムに対する不正アクセス、改ざん、妨害を行うこと",
        "本サービスの運営、信用、または他の利用者に不利益を与える行為",
        "法令または公序良俗に反する行為",
        "その他、当研究所が不適切と判断する行為",
      ]
    },
    { title:"第6条　データの取り扱い",       body:"利用者が入力したデータの取り扱いは、別途定めるプライバシーポリシーおよびデータ憲法に従います。利用者は、本サービスの利用にあたり、プライバシーポリシーに定める利用目的および公開範囲を確認するものとします。" },
    { title:"第7条　集計データの公開",       body:"本サービスは、個人・個別農家が特定されにくいよう加工した集計データを公開する場合があります。公開の条件はプライバシーポリシーおよびデータ憲法に従い、原則として5農家以上のデータが集まった場合に限ります。5農家以上であっても、地域・品目・期間等の組み合わせから個別農家が推定されるおそれがある場合は、表示しない、または地域・期間・分類を広げる場合があります。" },
    { title:"第8条　五年計画書・PDF出力",    body:"本サービスが出力する五年計画書、収支計画書、その他の資料は、利用者の入力内容および公的統計データに基づく参考資料です。融資採択、補助金採択、収益改善を保証するものではありません。利用者は、出力された資料を自己の判断と責任において使用するものとします。" },
    { title:"第9条　免責",                   body:"当研究所は、本サービスの提供に関連して利用者に損害が生じた場合であっても、当研究所の故意または重大な過失による場合を除き、責任を負いません。ただし、法令により責任の免除または制限が認められない場合は、この限りではありません。",
      bullets:[
        "利用者が入力したデータの正確性・完全性",
        "集計データ・公的統計データの正確性・最新性",
        "五年計画書その他の出力資料に基づく経営判断の結果",
        "通信障害・システム障害による一時的なサービス停止",
        "利用者間または利用者と第三者間の紛争",
      ],
      bulletsLabel:"以下について保証しません。",
    },
    { title:"第10条　知的財産・入力データ",  body:"本サービスのシステム、デザイン、コード、集計ロジック、表示形式に関する知的財産権は当研究所に帰属します。利用者が入力した個別データの権利または管理権限は利用者に留保されます。ただし、当研究所は、プライバシーポリシーに定める利用目的および公開範囲の範囲内で、当該データを記録、集計、分析、表示、資料作成に利用できるものとします。" },
    { title:"第11条　利用停止・退会",        body:"利用者は、プロフィール画面の「退会する」機能、または問い合わせ先への連絡により、いつでも退会できます。退会後のデータの取り扱いはプライバシーポリシーに従います。当研究所は、利用者が本規約に違反した場合、事前の通知なくアカウントを停止または削除できるものとします。" },
    { title:"第12条　規約変更",              body:"当研究所は、本規約を変更する場合があります。重要な変更がある場合は、サイト上で利用者に通知します。変更後に利用者がサービスを継続利用した場合、変更後の規約に同意したものとみなします。" },
    { title:"第13条　準拠法・管轄",          body:"本規約は日本法に準拠します。本サービスに関する紛争については、徳島地方裁判所を第一審の専属的合意管轄裁判所とします。" },
    { title:"第14条　問い合わせ",            body:"本規約に関するお問い合わせ：t5fki6643qty@gmail.com" },
    { title:"第15条　分離可能性",            body:"本規約の一部が法令等により無効または執行不能と判断された場合であっても、その他の規定は継続して有効に存続するものとします。" },
  ];

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
            <p style={{ fontSize: 11, color: "#B0B0B0", marginTop: 4 }}>日本農業研究所（chitose-bank） v1.0 · 最終更新日：2026年5月25日</p>
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
              {a.body && (
                <p style={{ fontSize: 14, color: "#444", lineHeight: 1.9, margin: 0, textAlign: "left" }}>{a.body}</p>
              )}
              {a.bulletsLabel && (
                <p style={{ fontSize: 14, color: "#444", lineHeight: 1.9, marginTop: 8, marginBottom: 8, textAlign: "left" }}>{a.bulletsLabel}</p>
              )}
              {a.bullets && (
                <ul style={{ margin: 0, marginTop: a.body || a.bulletsLabel ? 10 : 0, paddingLeft: 20, display: "grid", gap: 8 }}>
                  {a.bullets.map((b, j) => (
                    <li key={j} style={{ fontSize: 14, color: "#444", lineHeight: 1.9, textAlign: "left" }}>{b}</li>
                  ))}
                </ul>
              )}
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
