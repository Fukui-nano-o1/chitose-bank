const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const now = () => new Date().toISOString();

async function request(name, args, guest, signal) {
  const owner = guest ? `guest:${args.p_guest_token}` : `user:${window.qaUserId}`;
  const action = name.replace('support_', '');
  window.qaRequests.push({ name, args: JSON.parse(JSON.stringify(args)), guest, owner });
  if (window.qaHold === action) {
    await new Promise((resolve, reject) => {
      window.qaRelease = resolve;
      signal?.addEventListener('abort', () => reject(new Error('SUPPORT_TIMEOUT')), { once: true });
    });
  }
  if (window.qaFail === action) throw new Error('Network unavailable');
  if (name === 'support_create') {
    let record = window.qaReports[args.p_id];
    if (!record) {
      record = {
        owner, messages: [],
        report: { id: args.p_id, topic: args.p_topic, impact: args.p_impact, category: args.p_category,
          body: args.p_body.trim(), expected_result: args.p_expected?.trim() || null, page_hash: args.p_page_hash,
          viewport: args.p_diagnostics?.viewport?.width ?? null,
          diagnostics: args.p_diagnostics, status: 'open', created_at: now(), updated_at: now() },
      };
      window.qaReports[args.p_id] = record;
    }
    if (record.owner !== owner) throw new Error('FORBIDDEN');
    if (window.qaLoseCreateResponse) { window.qaLoseCreateResponse = false; throw new Error('response lost after insert'); }
    return { report: { ...record.report }, messages: record.messages.map(message => ({ ...message })) };
  }
  if (name === 'support_list') return { items: Object.values(window.qaReports).filter(record => record.owner === owner).map(record => ({ ...record.report })) };
  const record = window.qaReports[args.p_id];
  if (!record || record.owner !== owner) throw new Error('SUPPORT_NOT_FOUND');
  if (name === 'support_detail') return { report: { ...record.report }, messages: record.messages.map(message => ({ ...message })) };
  if (name === 'support_reply') {
    if (!record.messages.some(message => message.id === args.p_message_id)) {
      record.messages.push({ id: args.p_message_id, body: args.p_body.trim(), author_role: 'user', created_at: now() });
      if (args.p_reopen || ['answered', 'resolved'].includes(record.report.status)) record.report.status = 'open';
      record.report.updated_at = now();
    }
    if (window.qaLoseReplyResponse) { window.qaLoseReplyResponse = false; throw new Error('response lost after reply'); }
    return { report: { ...record.report }, messages: record.messages.map(message => ({ ...message })) };
  }
  throw new Error(`Unexpected support endpoint: ${name}`);
}

// Authentication is deliberately unusable in this fixture: guests must use the
// dedicated transport even when the normal sign-in/session lock cannot settle.
export const supabase = {
  auth: { getSession() { window.qaAuthSessionReads++; return new Promise(() => {}); } },
  rpc(name, args) {
    return { abortSignal(signal) {
      return request(name, args, false, signal).then(data => ({ data, error: null }), error => ({ data: null, error: { message: error.message } }));
    } };
  },
};

window.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const name = parsed.pathname.match(/^\/rest\/v1\/rpc\/(support_[a-z_]+)$/)?.[1];
  if (!name || parsed.origin !== 'https://support-fixture.test') throw new Error(`Unexpected network: ${parsed.origin}${parsed.pathname}`);
  window.qaGuestHeaders = Object.fromEntries(new Headers(options.headers));
  try { return json(await request(name, JSON.parse(options.body), true, options.signal)); }
  catch (error) { return json({ message: error.message }, 503); }
};
