// URLを履歴に積みつつ画面を切り替える（hashchange を出さない pushState の代わり）。
//
// 【なぜ要るか（2026-09-01たきと報告「求人詳細ページも説明が必要」の真因）】
//   求人カードのタップで詳細を開く経路は history.pushState で #/work/job/N を書く。
//   pushState は hashchange も popstate も【発火しない】ため、hashchange だけを聞いている部品
//   （この画面の説明 PageGuide 等）には「画面が変わった」ことが伝わらず、求人詳細の説明が
//   一度も自動で出なかった（直リンクで開いた時だけ出ていた）。
//   ★ pushState をやめて location.hash を書くと hashchange が出るが、JobSearchMapView 自身の
//     onHash が走って詳細を作り直す（二重処理）ので、pushState は残し【合図だけ】足す。
//
// 【使い方】pushState を直接呼ばず、必ずこれを通す。hashchange を聞いている部品は
//   cb:routeChanged も一緒に聞く（PageGuide がその例）。
export const ROUTE_CHANGED = "cb:routeChanged";
export function pushRoute(hash) {
  try { window.history.pushState(null, "", hash); } catch {}
  try { window.dispatchEvent(new Event(ROUTE_CHANGED)); } catch {}
}
