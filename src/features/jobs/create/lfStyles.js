// 求人作成フローのタイポグラフィ定数。第2次構造改革2026-08-17で LandingFlow.jsx から分離。
// stateに一切依存しない純粋な定数（コンポーネント内で毎レンダー作り直す必要がなかったもの）。
// ★見出し・説明文の見え方の正はここ。step の中身を別ファイルに切っても字面が揃うようにするため、
//   セクション部品からもこのファイルを読む（propsで配らない）。

export const lfStyles = {
  heroTitle: {
    fontSize:"clamp(28px, 4vw, 42px)", fontWeight:850, lineHeight:1.22,
    letterSpacing:"-0.04em", color:"#222", textAlign:"center", margin:"24px 0 12px",
  },
  stepTitle: {
    fontSize:"clamp(26px, 3.2vw, 36px)", fontWeight:850, lineHeight:1.25,
    letterSpacing:"-0.035em", color:"#222", textAlign:"center", margin:"32px 0 10px",
  },
  subtitle: {
    fontSize:"clamp(16px, 1.6vw, 18px)", lineHeight:1.7, color:"#717171",
    textAlign:"center", margin:"0 auto 28px", maxWidth:520,
  },
  question: {
    fontSize:"clamp(18px, 2vw, 22px)", fontWeight:750, lineHeight:1.4,
    color:"#222", textAlign:"center", margin:"28px 0 18px",
  },
  cardTitle: {
    fontSize:"clamp(16px, 1.8vw, 20px)", fontWeight:750, color:"#222",
    lineHeight:1.45, marginBottom:4,
  },
  cardDesc: {
    fontSize:"clamp(13px, 1.4vw, 15px)", lineHeight:1.75, color:"#717171",
  },
  note: {
    fontSize:"clamp(13px, 1.1vw, 14px)", lineHeight:1.8, color:"#B0B0B0", textAlign:"center",
  },
  inputLabel: { fontSize:14, fontWeight:700, color:"#222", marginBottom:6, display:"block" },
  featureTitle: { fontSize:"clamp(14px, 1.5vw, 16px)", fontWeight:700, color:"#222", marginBottom:3 },
  featureDesc: { fontSize:"clamp(13px, 1.3vw, 14px)", lineHeight:1.75, color:"#717171" },
};
