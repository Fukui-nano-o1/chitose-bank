export const REPORT_KINDS = [
  { key: "pay", label: "未払い", table: "pay_incidents" },
  { key: "job", label: "求人", table: "job_reports" },
  { key: "comment", label: "コメント", table: "message_reports" },
  { key: "person", label: "プロフィール", table: "profile_reports" },
  { key: "screen", label: "画面・機能", table: "feedback" },
];
export const REPORT_CACHE = "admin:reports";
const FB_LABEL = { confusing: "分かりにくい", broken: "動かない", typo: "誤字・表示", suggestion: "改善の提案", other: "その他" };

// 既存の表示確認用データの明示的な印だけを見る。削除せず、別の一覧で確認できる。
export function isDemoReport(row) {
  return [row.detail, row.body, row.body_snapshot, row.admin_note].some(value => /^\s*【デモ】/.test(value || ""));
}
export const isClosedReport = row => row.status === "resolved" || row.status === "unresolved";
export const needsReportAction = row => !isClosedReport(row) && !isDemoReport(row);
export const reportKey = row => `${row.kind}/${row.id}`;
export const reportPath = row => `/admin/reports/${reportKey(row)}`;
export const reportKindLabel = kind => REPORT_KINDS.find(item => item.key === kind)?.label || "通報";

export function reportStatus(row) {
  if (isDemoReport(row)) return { label: "表示サンプル", tone: "sample" };
  if (row.status === "unresolved") return { label: "未解決で終了", tone: "closed" };
  if (row.status === "resolved") return { label: row.kind === "pay" ? "解決済み" : "対応済み", tone: "closed" };
  if (row.kind === "pay" && row.status === "checking") return { label: "事実確認中", tone: "checking" };
  return { label: "未対応", tone: "open" };
}

export function reportSummary(row) {
  if (row.kind === "pay") return { title: "報酬が支払われていないという申告", target: row.job_number != null ? `求人 #${row.job_number}` : "対象の契約", body: row.admin_note || "支払いの事実は、まだ確定していません。" };
  if (row.kind === "job") return { title: row.issue_type || "求人についての通報", target: `求人 #${row.job_number}${row.target_field ? ` · ${row.target_field}` : ""}`, body: row.detail || "補足の記載はありません。" };
  if (row.kind === "comment") return { title: row.reason || "コメントについての通報", target: "チャットのコメント", body: row.body_snapshot || "本文の記録はありません。" };
  if (row.kind === "person") return { title: row.issue_type || "プロフィールについての通報", target: [row.source === "work_record" ? "はたらいた記録" : "プロフィール", row.target_field].filter(Boolean).join(" · "), body: row.detail || "補足の記載はありません。" };
  return { title: FB_LABEL[row.category] || "画面についての報告", target: row.page_hash || "対象ページの記録なし", body: row.body || "本文の記載はありません。" };
}

export const REPORT_STEPS = {
  pay: [
    { title: "申告時の記録を確認", body: "この下の「申告時の記録」で、契約の報酬・支払時期・日次の記録を照合します。" },
    { title: "双方に事実を確認", body: "働き手と雇い手それぞれの運営チャットで、支払日・金額・受け取り状況を確認します。確認を始めたら「事実確認を始める」を押します。" },
    { title: "確認結果を記録", body: "支払いの行き違いなどが解消したら「解決済み」。解消を確認できないまま対応を終える場合は「未解決で終了」を選びます。確認が続く間は終了しません。" },
  ],
  job: [
    { title: "対象の求人を確認", body: "「対象の求人を確認」から、指摘された項目と掲載内容を見比べます。" },
    { title: "必要な対応を行う", body: "不明な点は通報者に確認します。掲載内容の修正が必要な場合は、求人の確認画面から修正を依頼します。" },
    { title: "対応を完了", body: "必要な確認と対応を終えたら「対応を完了する」を押します。この操作だけで求人の修正や非公開化は行われません。" },
  ],
  comment: [
    { title: "通報された発言を読む", body: "この下の「通報時のコメント」と補足を確認します。本文は通報された時点の記録です。" },
    { title: "前後の事情を確認", body: "必要に応じて、通報者・発言者それぞれの運営チャットで事情を確認します。通報者の情報を相手に転送しないでください。" },
    { title: "対応を完了", body: "必要な確認と対応を終えてから完了します。完了操作でコメントが削除されたり、相手に通知されたりすることはありません。" },
  ],
  person: [
    { title: "指摘された内容を確認", body: "「対象のプロフィールを確認」から、プロフィールまたは「はたらいた記録」の該当項目を見ます。" },
    { title: "本人と通報者に確認", body: "必要に応じて、それぞれの運営チャットで事実を確認します。通報内容だけで違反と決めつけないでください。" },
    { title: "対応を完了", body: "必要な確認と対応を終えてから完了します。完了操作でアカウントが停止されることはありません。" },
  ],
  screen: [
    { title: "報告された操作を確認", body: "本文・対象ページ・画面幅を確認します。情報が足りなければ、報告者に操作の手順を尋ねます。" },
    { title: "動作と対応内容を確認", body: "同じ操作で現象を確認し、修正や案内など必要な対応を行います。改善の提案は、対応方針を整理します。" },
    { title: "対応を完了", body: "修正後の動作や案内内容を確認してから完了します。完了操作だけで画面が修正されることはありません。" },
  ],
};

export function reportNextAction(row) {
  if (isClosedReport(row)) return "対応内容を確認する";
  if (row.kind === "pay" && row.status === "checking") return "双方への確認を進める";
  return REPORT_STEPS[row.kind]?.[0].title || "内容を確認する";
}

// 一部の取得失敗を「0件」として扱わない。失敗した台帳だけ前回値を残す。
export function mergeReportResults(previous, results) {
  const rows = REPORT_KINDS.flatMap((kind, index) => {
    const result = results[index];
    if (result.status !== "fulfilled" || result.value.error) return (previous || []).filter(row => row.kind === kind.key);
    return (result.value.data || []).map(row => ({ ...row, kind: kind.key }));
  });
  return rows.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

export function reportRoute(hash) {
  const match = String(hash || "").match(/^#?\/admin\/reports\/(pay|job|comment|person|screen)\/([0-9a-f-]{36})$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function reportDate(value, time = false) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "日時の記録なし";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}
