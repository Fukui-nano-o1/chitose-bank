// Compare fractional seconds too: Date.parse alone truncates Postgres microseconds.
export function compareChatTimes(a, b) {
  const milliseconds = Date.parse(a) - Date.parse(b);
  if (milliseconds) return milliseconds;
  const fraction = value => (String(value).match(/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/)?.[1] || '').padEnd(9, '0');
  return fraction(a).localeCompare(fraction(b));
}
// A receipt covers only fetched messages and the status displayed for the active
// application. Never use the client clock: a later update must stay unread.
export function chatReadWatermarks({ scope, readerId, messages, applications, reads, statusApplicationId }) {
  return [...new Set(scope)].flatMap(applicationId => {
    const candidates = [
      ...messages.filter(row => row.application_id === applicationId).map(row => row.created_at),
      ...applications.filter(row => row.id === applicationId && row.id === statusApplicationId).map(row => row.status_changed_at),
      ...reads.filter(row => row.application_id === applicationId && row.reader_id === readerId).map(row => row.last_read_at),
    ].filter(value => value && Number.isFinite(Date.parse(value)));
    if (!candidates.length) return [];
    // Preserve the original timestamp string (Postgres may include microseconds).
    const last_read_at = candidates.reduce((latest, value) => compareChatTimes(value, latest) > 0 ? value : latest);
    return [{ application_id: applicationId, reader_id: readerId, last_read_at }];
  });
}
