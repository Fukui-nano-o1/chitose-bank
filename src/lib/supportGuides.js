import { SUPPORT_TOPICS } from './supportModel.js';
// Public guidance; all topics use the existing support contract.
export const SUPPORT_GUIDES = [
  { id:'absence', topic:'other', audience:'worker', title:'欠勤の記録に心当たりがない', summary:'記録の確認と異議申立について', keywords:'欠席 出勤 異議 72時間', steps:['対象の仕事と作業日を確認し、欠勤の通知や当日のやり取りを見返してください。','異議申立の画面から理由を送信できます。受付には72時間の期限があります。','通知時刻が分からない、期限の案内が出る、送信できない場合は運営に相談してください。相談を送っても、欠勤記録が自動で訂正されるわけではありません。'], prompt:'仕事名・作業日、実際の出勤状況、確認してほしい点を教えてください。' },
  { id:'absence-time', topic:'other', audience:'worker', title:'通知時刻を確認できず、異議申立できない', summary:'過去の欠勤記録を運営に確認してもらう', keywords:'欠勤 期限 72時間 過去 記録', steps:['過去の記録では、通知時刻を確認できず、アプリで異議申立を受け付けられないことがあります。','対象の仕事名・作業日と、出勤したかどうかを運営に伝えてください。通知が残っていれば、受け取った日時も分かる範囲で記載してください。','運営が記録を確認し、この相談の履歴で返答します。相談の受付は、異議申立の受理や欠勤記録の訂正を保証するものではありません。'], prompt:'仕事名・作業日、実際の出勤状況、通知を受け取った日時（不明なら「不明」）を教えてください。' },
  { id:'day-contact', topic:'chat', audience:'all', title:'遅刻・欠勤・当日の変更を連絡したい', summary:'相手への連絡と、連絡が取れないとき', keywords:'キャンセル 中止 延期 集合 農家 働き手 来ない', steps:['対象の仕事のチャットを開き、「緊急連絡」から状況を相手に伝えてください。','集合場所で会えない場合は、約束した場所・日時を確認してください。','相手に連絡できない、やり取りが難しい場合は、作業日と困っていることを運営に相談できます。'], prompt:'仕事名・作業日、今の状況、相手への連絡状況を教えてください。' },
  { id:'payment', topic:'other', audience:'all', title:'報酬が支払われない・金額が違う', summary:'約束した条件と実際の支払いを確認', keywords:'給料 給与 賃金 未払い お金 振込', steps:['求人や労働条件通知書に記載された金額・支払時期と、実際の支払いを比べてください。','安全にやり取りできる場合は、対象の仕事のチャットで相違点を相手に確認してください。','解決しない場合や直接の連絡が難しい場合は、運営に相談できます。運営による立替払いや返金を約束するものではありません。'], prompt:'仕事名・作業日、約束した金額と受け取った金額、相手への確認状況を教えてください。' },
  { id:'safety', topic:'other', audience:'all', title:'危険な作業・嫌がらせについて相談したい', summary:'安全を確保して、運営へ相談', keywords:'事故 ケガ 怪我 ハラスメント 暴力 怖い トラブル', steps:['危険がある場合はその場を離れ、安全な場所を確保してください。緊急の救助が必要な場合は、アプリの返信を待たず地域の緊急窓口へ連絡してください。','相手に直接連絡することが難しい場合は、無理にやり取りせず運営へ相談してください。','いつ・どの仕事で・何が起きたかを分かる範囲で記載してください。この窓口は即時対応を保証するものではありません。'], prompt:'仕事名・発生日時、起きたこと、現在安全な場所にいるかを教えてください。' },
  { id:'apply-cancel', topic:'apply', audience:'worker', title:'応募を取り消したい', summary:'応募状況に合わせて手続きを確認', keywords:'キャンセル 辞退 承認', steps:['マイページの「あなたの応募」で、現在の応募状況を確認してください。','承認前は応募の取り消しができます。承認後は対象の仕事のチャット・緊急連絡から相手に相談してください。','操作できない場合は、応募状況と試した操作を運営へお知らせください。'], prompt:'仕事名・作業日、表示されている応募状況、困っていることを教えてください。' },
  { id:'listing', topic:'post', audience:'farmer', title:'求人を保存・掲載できない', summary:'入力を残したまま、保存状況を確認', keywords:'農家 募集 写真 下書き 公開 エラー', steps:['未入力の項目や画面の案内を確認してください。入力を消してやり直す必要はありません。','保存後に応答がない場合は、下書きや掲載済みの求人を確認してから再操作してください。','進めない場合は、止まった項目と画面の案内を運営に相談してください。'], prompt:'止まった項目、押したボタン、表示された案内を教えてください。' },
  { id:'applicant', topic:'apply', audience:'farmer', title:'応募者への返答・採用確認で困っている', summary:'応募の状況と契約確認について', keywords:'承認 見送り 採用 契約 終了 取消', steps:['対象の求人の応募者一覧から、応募の状況を確認してください。','取消・期限切れ・見送りなど、終了した応募では採用確認を追加できません。','表示と認識が違う場合は、求人名と応募状況を運営に相談してください。'], prompt:'求人名、表示されている応募状況、確認してほしい点を教えてください。' },
  { id:'login', topic:'login', audience:'all', title:'ログインできない・メールが届かない', summary:'ログイン前でも相談できます', keywords:'認証 コード パスワード 登録', steps:['メールアドレスの入力と迷惑メールフォルダを確認してください。再送は画面の待ち時間が終わってから行えます。','登録済みでパスワードが分かる方は、パスワードでログインできます。','ログインできなくても相談できます。パスワードや認証コードは本文に書かないでください。'], prompt:'止まっている画面と、表示されている案内を教えてください。' },
  { id:'review', topic:'other', audience:'all', title:'評価・仕事の記録を確認したい', summary:'記録が違う、表示されないとき', keywords:'完了 修正 訂正 口コミ', steps:['対象の仕事と作業日を確認してください。','評価は最終作業の終了から72時間後に表示されます。表示前なのか、記録内容に相違があるのかを確認してください。','間違いに気づいた場合は、仕事名と確認してほしい内容を運営に相談してください。'], prompt:'仕事名・作業日、記録のどの点を確認してほしいかを教えてください。' },
];
export const supportGuide = id => SUPPORT_GUIDES.find(item => item.id === id);
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().trim();
export function searchSupportGuides(query, audience = 'all') {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return SUPPORT_GUIDES.filter(item => (audience === 'all' || item.audience === 'all' || item.audience === audience) && words.every(word => normalize([item.title, item.summary, item.keywords, ...item.steps].join(' ')).includes(word)));
}

export function searchSupportTopics(query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return SUPPORT_TOPICS.filter(item => words.every(word => normalize([item.label, ...item.steps].join(' ')).includes(word)));
}
