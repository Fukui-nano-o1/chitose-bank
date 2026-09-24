// サポートの言葉は利用者側・運営側で揃える。
export const SUPPORT_TOPICS = [
  { value: 'login', label: 'ログイン・認証メール', steps: ['登録済みでパスワードが分かる方は、パスワードでログインできます。', 'メールアドレスの入力を確認してください。再送は画面の待ち時間が終わってから行えます。', 'メールが届かない場合も、ログインせずにここから相談できます。'] },
  { value: 'signup', label: '新規登録・プロフィール', steps: ['以前登録した方は、ログイン画面の「パスワードでログイン」を利用できます。', '登録途中で進めないときは、画面に出ている未入力の項目や案内を確認してください。', '何度試しても進めない場合は、このまま相談できます。認証コードは書かないでください。'] },
  { value: 'apply', label: '求人を探す・応募する', steps: ['応募できる日程と、求人の募集状況を確認してください。', '送信後に応答がない場合は、応募状況を確認してから再操作してください。', '仕事や応募の画面で困ったことを、そのまま運営に相談できます。'] },
  { value: 'post', label: '求人の掲載・途中保存', steps: ['入力が残っている場合は、この画面を閉じると元の操作に戻れます。', '保存や掲載後に応答がない場合は、保存済み・掲載済みになっていないか確認してください。', '進めなかった項目や操作を報告してください。内容を消してやり直す必要はありません。'] },
  { value: 'pdf', label: '労働条件通知書・PDF', steps: ['通知書の内容が画面で確認できるか、PDF作成だけが止まっているかを確認してください。', 'すでに保存されていないか、端末のダウンロード一覧を確認できます。', '作成中から進まない、保存できない場合は、その状態を報告してください。'] },
  { value: 'chat', label: 'チャット・連絡', steps: ['相手と仕事が合っているか、チャットの見出しを確認してください。', '送信できたか不明なときは、同じ内容を続けて送る前に履歴を確認してください。', '個人の連絡先や会話の全文を書かず、困った操作を報告できます。'] },
  { value: 'other', label: '表示・使い方・改善の提案', steps: ['分かりにくかった言葉、見つからなかったボタンなどを教えてください。', '「何をしようとしたか」と「どうなったか」が分かると改善に役立ちます。', '改善の提案も、この相談から受け付けています。'] },
];
export const SUPPORT_IMPACTS = [
  { value: 'blocked', label: '操作が止まっている' },
  { value: 'difficult', label: '使いにくい・迷った' },
  { value: 'suggestion', label: '改善を提案したい' },
];
export const SUPPORT_STATUSES = { open: '受付', checking: '確認中', answered: '回答あり', resolved: '対応済み' };
export const supportTopicLabel = value => SUPPORT_TOPICS.find(item => item.value === value)?.label || '画面についての相談';
export const supportImpactLabel = value => SUPPORT_IMPACTS.find(item => item.value === value)?.label || '影響の記録なし';
export const supportStatusLabel = value => SUPPORT_STATUSES[value] || '受付';
export const supportReceipt = id => `CB-${String(id || '').slice(0, 8).toUpperCase()}`;
export const supportDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
};
