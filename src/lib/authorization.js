// UI hints only. RLS / RPCs always authorize again using the current database row.
// Never derive administrative rights from email, user_metadata or a saved snapshot.
export const isAdmin = user => !!user?.id && user?.authorization?.subject === user.id
  && user.authorization.admin === true;

export async function readAdminMembership(client, subject) {
  if (!subject) return false;
  try {
    const { data, error } = await client.from('app_admins').select('auth_id').eq('auth_id', subject).maybeSingle();
    return !error && data?.auth_id === subject;
  } catch { return false; }
}

export const ATTENDANCE_DENIAL_MESSAGES = Object.freeze({
  dispute_window_closed: '欠勤記録から72時間が経過したため、異議申立の受付は終了しました。事情がある場合は「ヘルプ・お問い合わせ」から運営へご連絡ください。',
  dispute_time_unknown: 'この欠勤記録の通知時刻を確認できません。「ヘルプ・お問い合わせ」から運営へご連絡ください。',
  no_show_not_recorded: 'この仕事には欠勤の記録がありません。対象の仕事を確認してください。',
  account_suspended: 'アカウントが停止中のため保存できません。運営へお問い合わせください。',
});
