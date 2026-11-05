// Defensive presentation boundary for historical error records and operator notes.
// Pattern-based masking is defensive, not a guarantee that arbitrary free text is anonymous.
// Never add raw metadata, session identifiers or authenticated user identifiers to reports.
export function safeErrorText(value = '') {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s<>"')]+/gi, raw => {
      try {
        const url = new URL(raw);
        // Preserve stack coordinates and file paths, but not query values or login fragments.
        const hash = url.hash.startsWith('#/') ? url.hash.split('?')[0] : '';
        return `${url.origin}${url.pathname}${url.search ? '?[非表示]' : ''}${hash}`;
      } catch { return '[URL非表示]'; }
    })
    // Relative/hash routes can contain the same private query values as absolute URLs.
    .replace(/(\/[^\s<>"'?]*)\?[^\s<>"']+/g, '$1?[非表示]')
    // Quoted JSON keys/values, including escaped characters and spaces.
    .replace(/["'](?:access_token|refresh_token|api_key|apikey|authorization|password|token|secret)["']\s*:\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,}\r\n]+)/gi, '"[認証情報非表示]":"[非表示]"')
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [非表示]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[認証情報非表示]')
    .replace(/\b(?:access_token|refresh_token|api_key|apikey|authorization|password|token|secret)\s*[=:]\s*[^\s,;]+/gi, '[認証情報非表示]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    // Mask UUIDs as a whole before their numeric segments can resemble a phone number.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID]')
    .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, '[phone]');
}
