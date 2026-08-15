// プレビュー呼び出しバス（分割・大物②・2026-07-24）：どこからでも働き手/雇い手プレビューシートを開く
// windowイベント発火の小関数。受け手（WorkerPreviewSheet/EmployerPreviewSheet）はApp.jsx側に常駐。
// 働き手プレビューの全域ボックス（2026-07-19）：どの画面の働き手アイコンからでも
// openWorkerPreview(worker_id) で展開できる。中身はまた呼びたいリスト詳細と同じ
// （WorkerTrustCard＋Q&A＋あなたの評価）。Appルートに1つだけマウントし、イベントで開く
// 雇い手プレビューの全域ボックス（2026-07-19）：どの画面の雇い手アイコンからでも
// openEmployerPreview(farmer_id) で展開できる。中身は農園紹介モーダルと同系
// （FarmerTrustCard＋待遇バッジ＋農園紹介のお題）。取得列は公開用に限定（place_*住所・texts_pendingは読まない）
export function openEmployerPreview(farmerId) {
  if (farmerId) window.dispatchEvent(new CustomEvent("cb:openEmployerPreview", { detail: farmerId }));
}
export function openWorkerPreview(workerId) {
  if (workerId) window.dispatchEvent(new CustomEvent("cb:openWorkerPreview", { detail: workerId }));
}
// 段階の説明シート（2026-07-25）：どのステータス表示からでも openPhaseInfo(段階キー) で説明を開く。
// 受け手（PhaseInfoSheet）はcomponents/uiにあり、App.jsxに1つだけマウント
export function openPhaseInfo(phaseKey) {
  if (phaseKey) window.dispatchEvent(new CustomEvent("cb:openPhaseInfo", { detail: phaseKey }));
}
// ログインのボックス（2026-07-27たきと指示）：訪問者が応募・いいね等を押したとき、
// alertで案内するのをやめてログイン画面をその場にボックスで開く。受け手はApp.jsx常駐のLoginSheet。
// 画面を奪わない＝閉じれば見ていた求人に戻る（従来の#/loginへの自動遷移は撤去済み）
export function openLoginBox() {
  window.dispatchEvent(new CustomEvent("cb:openLoginBox"));
}
// 統合報告ハブ（2026-08-15）：どこからでも openReportHub({genre, job, worker}) で報告モーダルを開く。
// genre: "job"|"person"|"comment"|"screen"。job={jobNumber,title}／worker={workerId,name,source}。
// 受け手（ReportHub）はApp.jsxに1つだけマウント。保存経路は各台帳の従来のまま（ReportHub冒頭コメント参照）
export function openReportHub(detail) {
  window.dispatchEvent(new CustomEvent("cb:openReportHub", { detail: detail || {} }));
}
