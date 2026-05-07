export default function Terms({ onClose }) {
  const articles = [
    {
      title: "第1条（サービスの定義）",
      body: "日本農業研究所（chitose-bank.com）は、農家が自身の経営データを記録・分析し、匿名集計データを公開するサービスです。",
    },
    {
      title: "第2条（データの所有権）",
      body: "入力されたデータの所有権は農家本人に帰属します。当サービスはデータの保管・集計処理を行いますが、所有権を主張しません。",
    },
    {
      title: "第3条（データの利用範囲）",
      body: null,
      levels: [
        { label: "レベル1（必須）", desc: "私的台帳としての利用（本人のみ閲覧）" },
        { label: "レベル2（デフォルトON）", desc: "匿名ベンチマークへの参加（同グループ農家のみ閲覧、個人特定不可）" },
        { label: "レベル3（デフォルトON）", desc: "匿名集計データの一般公開（中央値・四分位のみ、5人以上のセルのみ）" },
        { label: "レベル4（任意）", desc: "研究・政策利用への提供（学術機関・行政機関の施策立案に匿名集計データを提供）" },
      ],
    },
    {
      title: "第4条（匿名化の方針）",
      body: "個人名は一切公開しません。集計は最低5人以上のグループのみ表示します。就農年数・出荷先・作物の組み合わせで個人が特定される可能性がある場合、当該セルは非表示にします。",
    },
    {
      title: "第5条（データの削除・エクスポート）",
      bullets: [
        "退会時、本人のデータは30日以内に完全削除します。",
        "CSV形式での自分のデータのエクスポートを随時可能にします。",
        "既に公開済みの匿名集計値からの除外は、次回集計更新時に反映されます。",
      ],
    },
    {
      title: "第6条（第三者提供）",
      bullets: [
        "個票データを第三者に提供しません。",
        "匿名集計データは、レベル3・4の同意者のデータのみ、研究・政策目的に限り提供する場合があります。",
        "広告目的でのデータ利用・提供は一切行いません。",
      ],
    },
    {
      title: "第7条（免責事項）",
      bullets: [
        "本データは農家本人の入力による参考値であり、正確性を保証しません。",
        "経営判断は利用者自身の責任で行ってください。",
        "システムの一時停止・データ消失に対する損害賠償責任を負いません。",
      ],
    },
    {
      title: "第8条（サービスの変更・終了）",
      bullets: [
        "サービス内容の変更は30日前に通知します。",
        "サービス終了時は60日前に通知し、データのエクスポート期間を設けます。",
      ],
    },
    {
      title: "第9条（準拠法）",
      body: "本規約は日本法に準拠します。",
    },
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
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#222", margin: 0 }}>利用規約</h1>
            <p style={{ fontSize: 11, color: "#B0B0B0", marginTop: 4 }}>最終更新日：2026年5月5日</p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: "50%", border: "1px solid #EBEBEB",
            background: "#F7F7F7", color: "#717171", fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
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
                <p style={{ fontSize: 14, color: "#444", lineHeight: 2, margin: 0 }}>{a.body}</p>
              )}
              {a.levels && (
                <div style={{ display: "grid", gap: 10 }}>
                  {a.levels.map((lv, j) => (
                    <div key={j} style={{
                      display: "flex", gap: 12, alignItems: "flex-start",
                      padding: "10px 14px", background: "#fff",
                      borderRadius: 10, border: "1px solid #EBEBEB",
                    }}>
                      <span style={{
                        flexShrink: 0, fontSize: 11, fontWeight: 700,
                        color: "#00A86B", background: "#E6F7EF",
                        padding: "2px 8px", borderRadius: 6,
                      }}>{lv.label}</span>
                      <span style={{ fontSize: 13, color: "#444", lineHeight: 1.7 }}>{lv.desc}</span>
                    </div>
                  ))}
                </div>
              )}
              {a.bullets && (
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
                  {a.bullets.map((b, j) => (
                    <li key={j} style={{ fontSize: 14, color: "#444", lineHeight: 1.9 }}>{b}</li>
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
