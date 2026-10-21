// User guidance only: this module never retries, writes, clears drafts, or changes success criteria.
// A recognized recovery state does not prove the underlying incident is harmless.
const guide = (kind, title, state, action) => ({ kind, title, state, action, message: `${state}${action}` });
const sessionCodes = new Set(['PROFILE_SESSION','AVATAR_SESSION','ACCOUNT_SESSION','COPY_SESSION','ATTENDANCE_SESSION','TERMS_SESSION','PHOTO_SESSION','SAVED_JOB_SESSION','HELP_IMAGE_SESSION','CONSIGNOR_SESSION','CONSIGNMENT_SESSION','CONSIGN_AUX_OWNER']);
const conflictCodes = new Set(['PROFILE_CONFLICT','AVATAR_CONFLICT','ACCOUNT_CONFLICT','HELP_IMAGE_CONFLICT','CONSIGNOR_CONFLICT','CONSIGNMENT_CONFLICT','PHOTO_LIST_CONFLICT']);
const readCodes = new Set(['PROFILE_READ','PROFILE_NOT_LOADED','AVATAR_READ','HELP_IMAGE_READ','CONSIGNOR_READ','CONSIGNOR_NOT_LOADED','CONSIGNMENT_READ']);
const storageCodes = new Set(['COPY_STORAGE','ATTENDANCE_STORAGE','CONSIGNMENT_STORAGE','CONSIGN_AUX_STORAGE']);
const reasonCodes = new Set(['COPY_REJECTED','ATTENDANCE_REJECTED','TERMS_REJECTED','CONSIGN_AUX_REJECTED','CONSIGNMENT_CONFLICT','CONSIGNMENT_SAVE']);
const verifyFirst = '画面を閉じる前に入力を控え、通信が戻ってから保存済みの内容を確認してください。';
const uncertain = '保存結果を確認できません。保存済みの場合もあります。';
const session = () => guide('session','ログイン状態の確認が必要',
  '入力を始めたアカウントでログインしているか確認できません。',
  '画面を閉じる前に入力を控え、ログイン中のアカウントを確認してください。ログイン画面が出た場合は同じアカウントで入り、保存済みの内容を先に確認してください。');
const conflict = () => guide('conflict','保存済みの内容との確認が必要',
  '保存済みの内容が変わったか、今回の変更を反映できませんでした。',
  '入力を控え、最新の内容と比べてから変更してください。他の画面の編集内容も確認し、同じ内容を繰り返し送らないでください。');
const support = '続く場合はメニューの「ヘルプ・お問い合わせ」から、画面名と操作時刻をお知らせください。';

// Reasons are accepted only at known rejection boundaries; an arbitrary DB error
// (42501 / P0001 / constraint failure) must not be labelled an expected conflict.
function rejectedReason(reason) {
  if (['not_logged_in','owner_changed'].includes(reason)) return session();
  if (['conflict','field_conflict','terms_conflict','phone_conflict'].includes(reason)) return conflict();
  if (['consent_required','consent_required_version'].includes(reason)) return guide('consent','同意の確認が必要',
    '最新版のプライバシーポリシーへの同意が必要です。','画面の案内から内容を確認して同意し、元の操作をもう一度行ってください。');
  if (reason === 'closed') return guide('unavailable','この仕事は終了しています',
    'この仕事は終了しているため、確認を追加できません。','仕事の記録を確認してください。内容に相違がある場合は「ヘルプ・お問い合わせ」へご連絡ください。');
  if (['bad_status','not_found','not_yours'].includes(reason)) return guide('unavailable','対象の状態を確認してください',
    'この操作を行える対象・状態ではありません。','入力を控え、対象の最新状態とログイン中のアカウントを確認してください。同じ操作を繰り返しても進めません。');
  if (reason === 'copy_deleted') return guide('unavailable','前回のコピー先は削除済み',
    '前回のコピー先は削除されています。','元の求人と下書き一覧を確認し、新しく作る場合だけ、もう一度コピーしてください。');
  return null;
}

export function inputRecovery(code, reason) {
  if (reasonCodes.has(code)) {
    const known = rejectedReason(reason);
    if (known) return known;
  }
  if (sessionCodes.has(code)) return session();
  if (conflictCodes.has(code)) return conflict();
  if (readCodes.has(code)) return guide('read','保存済みの情報を確認できません',
    '保存済みの情報を読み込めないため、内容を確認できるまで変更を進められません。',
    '通信を確認して、もう一度読み込んでください。入力中の内容があれば、読み直す前に控えてください。');
  if (code === 'ACCOUNT_READ') return guide('read','登録済みの情報を確認できません',
    '登録済みの情報を読み込めないため、今回の登録は進めていません。',
    '入力を残したまま通信を確認し、同じ登録ボタンでもう一度確認してください。');
  if (storageCodes.has(code)) return guide('storage','端末の保存領域を確認してください',
    '前回の操作記録を読み込むか、今回の操作を端末に保持することができません。',
    '画面を閉じる前に入力を控えてください。端末の空き容量とブラウザの保存設定を確認し、同じ端末・ブラウザで再試行してください。サイトデータは削除しないでください。');
  const retries = {
    COPY_UNCONFIRMED: '同じ端末・ブラウザで、同じ求人のコピーボタンを押して前回の結果を確認してください。',
    ATTENDANCE_UNCONFIRMED: '同じ端末・ブラウザの同じ記録画面で、もう一度送信してください。まず前回送った内容の結果を確認します。',
    CONSIGNMENT_UNCONFIRMED: '同じ端末・ブラウザで、同じ案件の保存ボタンを押してください。まず前回送った内容の結果を確認します。',
    CONSIGN_AUX_UNCONFIRMED: '同じ端末・ブラウザで、同じ対象の保存操作を行ってください。まず前回送った内容の結果を確認します。',
    ACCOUNT_UNCONFIRMED: '入力を変えずに同じ登録ボタンを押すと、登録済みの内容と照合します。',
    TERMS_UNCONFIRMED: '同じ仕事の確認ボタンをもう一度押して、保存結果を確認してください。',
    SAVED_JOB_UNCONFIRMED: 'いいねの表示は変更していません。通信を確認し、同じ求人で同じ操作をもう一度行ってください。',
    PROFILE_UNCONFIRMED: verifyFirst,
    CONSIGNOR_UNCONFIRMED: verifyFirst,
    AVATAR_UNCONFIRMED: '元の画像ファイルを手元に残し、通信が戻ってから現在のプロフィール画像を確認してください。',
    HELP_IMAGE_UNCONFIRMED: '元の画像ファイルを手元に残し、通信が戻ってから現在の画像を読み込み直してください。',
    PHOTO_LIST_UNCONFIRMED: '通信が戻ってから最新の写真一覧を確認し、必要な場合だけ再実行してください。',
    PHOTO_UNCONFIRMED: '元の写真ファイルを手元に残し、通信が戻ってから同じ写真を選び直してください。写真が表示された後、入力画面の保存も確認してください。',
  };
  if (retries[code]) return guide('unconfirmed','保存結果の確認待ち',uncertain,retries[code]);
  const acknowledgements = {
    COPY_ACK: ['コピー先は保存済みです。','同じ端末・ブラウザで同じ求人のコピーを再試行し、前回のコピー先を確認してください。'],
    ATTENDANCE_ACK: ['記録は保存済みです。','同じ端末・ブラウザの元の記録画面で、前回の結果を確認してください。'],
    CONSIGNMENT_ACK: ['案件の保存は確認できました。','同じ端末・ブラウザの同じ案件で、保存ボタンを押して確認してください。'],
  };
  if (acknowledgements[code]) {
    const [state, action] = acknowledgements[code];
    return guide('saved','保存済み・端末側の確認待ち',state+'端末側の操作記録の整理だけが完了していません。',action);
  }
  return null;
}

export function inputError(code, fallback, reason) {
  const recovery = inputRecovery(code, reason);
  return Object.assign(new Error(recovery?.message || fallback), { code, ...(reason ? { reason } : {}) });
}

// A job draft has durable local storage already confirmed by its caller.
export function jobSaveGuidance(record, outcome = {}) {
  const reason = String(record?.reason || '').toLowerCase();
  const retained = '入力はこの端末の下書きに残っています。';
  if (record?.state === 'conflict' || reason === 'conflict') return retained+'保存済みの内容と差があります。「保存して終了」から下書きを残し、最新の求人と比べてください。他の画面の変更を確認するまで、繰り返し保存しないでください。';
  if (['consent_required','consent_required_version'].includes(reason) || outcome.consentRequired) return retained+rejectedReason('consent_required').message;
  if (reason === 'has_applications') return retained+'応募が届いている求人は内容を変更できません。応募状況を確認し、別の募集として出す場合は「新しい下書きにコピー」を使ってください。';
  if (outcome.authRequired || ['not_logged_in','jwt_expired','pgrst301'].includes(reason)) return retained+'ログイン中のアカウントを確認してください。ログイン画面が出た場合は入力を始めたアカウントで入り、同じ端末・ブラウザから下書きを開いてください。';
  if (['42501','not_yours','account_suspended'].includes(reason)) return retained+'この操作は許可されていません。ログイン中のアカウントと対象を確認してください。時間をおいても同じ場合は「ヘルプ・お問い合わせ」へご連絡ください。';
  if (['bad_status','not_found'].includes(reason)) return retained+rejectedReason(reason).message;
  if (record?.state === 'blocked') return retained+'保存を受け付けられませんでした。入力項目と対象の最新状態を確認してください。'+support;
  return retained+'サーバーへの反映は確認待ちです。通信が戻ってから同じ下書きで再試行してください。確認が済むまで新しい求人として作り直したり、サイトデータを削除したりしないでください。';
}

export const INPUT_RECOVERY_HELP = [
  {key:'recovery-result',label:'「保存結果を確認できません」と出た',body:'保存に失敗したとは限りません。保存は済んでいて、返事だけ受け取れなかった場合もあります。画面に表示された確認手順を使ってください。「同じ操作で確認」と表示されるコピー・当日報告・委託保存は、同じ端末・ブラウザの同じ対象で再試行します。別の新規入力を作って送り直さないでください。'},
  {key:'recovery-retention',label:'画面を閉じても入力は残る？',body:'「この端末に保存済み」「この端末の下書きに残っています」と確認できた求人下書きは、同じ端末・ブラウザで開きます。「入力は残しています」だけの画面は、開き直した後までの保存を保証しません。閉じる・再読み込み・ログアウトの前に入力を控えてください。サイトデータを削除すると、下書きや前回の操作を確認できなくなる場合があります。'},
  {key:'recovery-conflict',label:'別の画面の変更と重なった',body:conflict().message+'別の端末からの保存だけでなく、同じ端末の別タブからの変更でも起こります。'},
  {key:'recovery-session',label:'ログイン・同意の確認が必要',body:session().message+'最新版への同意が必要な場合は、画面の案内から内容を確認してください。権限がないという案内は、ログインし直すだけでは解決しない場合があります。'},
  {key:'recovery-storage',label:'端末に保存できない',body:inputRecovery('COPY_STORAGE').message+'別の端末・ブラウザへ移っても、元の端末の未送信入力や確認待ちの操作は自動で引き継がれません。'},
  {key:'recovery-saved',label:'「保存済み・確認待ち」と出た',body:'「保存済み」と確認できた内容を、新しい入力として作り直す必要はありません。端末側の確認だけが残る場合は、元の画面の案内に従って前回の結果を確認してください。前回の送信後に追加した編集は、別途保存が必要な場合があります。'},
  {key:'recovery-contact',label:'試しても進めない',body:support+'表示された案内と、どの操作をしたかを添えると確認しやすくなります。パスワードや認証コードは送らないでください。'},
];
