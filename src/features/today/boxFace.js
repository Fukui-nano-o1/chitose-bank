// やることボックスの「顔」＝絵柄（NavIconの名前）とラベルの、唯一のソース。
//
// ★なぜ切り出したか（2026-08-22の取りこぼしの再発防止）：
//   やることの格子は【今日ページ（components/TodayPage.jsx）】と
//   【マイページ・農家ダッシュボード（features/today/components/TaskBoxes.jsx）】の2箇所が描いている
//   （移行中の複製）。アイコンを絵文字→線画に差し替えたとき、正本の TodayPage だけを直して
//   複製の TaskBoxes を直し忘れ、マイページだけ絵文字のまま残った。
//   顔をここに集めたので、以後どちらの画面から見ても必ず同じ絵柄・同じラベルになる。
//
// ★箱を足す・改称する・絵柄を変えるときは、このファイルだけを直す。
//   用件の中身（説明文・行き先・実行するRPC）は TodayPage の TODO_META が持つ＝役割で分けてある。
//   NavIcon の名前は components/NavIcons.jsx の NAV_ICON_PATHS のキーと一致していること。
export const BOX_FACE = {
  profile:      { iconName: "profile",   label: "プロフィール入力" },
  t_emergency:  { iconName: "alert",     label: "緊急連絡" },
  revision:     { iconName: "edit",      label: "求人の修正" },
  question:     { iconName: "question",  label: "求人の質問" },
  hire:         { iconName: "hire",      label: "採用する" },
  insurance:    { iconName: "shield",    label: "保険の報告" },
  day_report:   { iconName: "clipboard", label: "今日の記録" },
  complete:     { iconName: "check",     label: "バイトの評価" },
  w_revision:   { iconName: "edit",      label: "求職の修正" },
  w_day_report: { iconName: "clipboard", label: "今日の記録" },
  w_review:     { iconName: "star",      label: "仕事の評価" },
};

// 格子のアイコンの大きさ（2026-08-22たきと裁定「大きさ52」）。
// 専用ページの見出し（20）・空状態（32）は、隣り合う文字の大きさに合わせてあるので別値。
export const BOX_ICON_SIZE = 52;
