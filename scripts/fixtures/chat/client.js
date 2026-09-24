const copy = value => JSON.parse(JSON.stringify(value));
const uid = () => window.qaUser;
class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  is(key, value) { return this.eq(key, value); }
  order(key, options) { this.sort = [key, options]; return this; }
  limit(n) { this.count = n; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(row) { this.op = 'insert'; this.value = row; return this; }
  update(row) { this.op = 'update'; this.value = row; return this; }
  upsert(row) { this.op = 'upsert'; this.value = row; return this; }
  async run() {
    const table = this.table;
    window.qaRequests.push({ table, op: this.op, value: this.value && copy(this.value) });
    if (window.qaHold === table && this.op === 'select') await new Promise(resolve => { window.qaRelease = resolve; });
    if (window.qaFailRead === table && this.op === 'select') return { data: null, error: { message: 'offline' } };
    const data = window.qaData[table] || [];
    if (this.op === 'insert') {
      const value = copy(this.value);
      if (window.qaSendMode === 'offline') throw new Error('offline');
      if (data.some(row => row.id === value.id)) return { data: null, error: { code: '23505' } };
      const saved = { ...value, created_at: new Date().toISOString(), read_at: null };
      data.push(saved);
      if (window.qaSendMode === 'lost') { window.qaSendMode = null; throw new Error('lost response'); }
      if (window.qaSendMode === 'hold') await new Promise(resolve => { window.qaResolveSend = resolve; });
      return { data: copy(saved), error: null };
    }
    if (this.op === 'update') { data.filter(row => this.filters.every(filter => filter(row))).forEach(row => Object.assign(row, this.value)); return { error: null, data: [] }; }
    if (this.op === 'upsert') return { data: [], error: null };
    let rows = data.filter(row => this.filters.every(filter => filter(row)));
    if (this.sort) rows = [...rows].sort((a,b) => String(a[this.sort[0]]).localeCompare(String(b[this.sort[0]])) * (this.sort[1]?.ascending === false ? -1 : 1));
    if (this.count) rows = rows.slice(0, this.count);
    return { data: copy(this.one ? rows[0] || null : rows), error: null };
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}
export const supabase = {
  auth: { getSession: async () => ({ data: { session: { user: { id: uid(), email: 'fixture@example.test' } } } }) },
  from: table => new Query(table),
  rpc: async (name, args) => {
    if (name === 'my_unread_message_counts') return { data: { by_application: window.qaUnread } };
    if (name === 'my_chat_inbox_previews') {
      const map = {};
      for (const row of window.qaData.messages) if (!map[row.application_id] || row.created_at > map[row.application_id].created_at) map[row.application_id] = row;
      return { data: copy(Object.values(map)) };
    }
    if (name === 'worker_cards_for_farmer') return { data: window.qaData.worker_profiles };
    if (name === 'job_details_for_party') return { data: window.qaData.jobs_public.filter(row => args.p_job_numbers.includes(row.job_number)) };
    if (name === 'job_meeting_place') return { data: { ok: true, full_address: '集合場所のサンプル' } };
    if (name === 'my_chat_partner_initials') return { data: {} };
    return { data: null, error: null };
  },
  channel(name) {
    const handlers = [];
    const channel = { name, handlers, on(type, config, callback) { handlers.push({ type, config, callback }); return this; }, subscribe() { return this; } };
    window.qaChannels.push(channel); return channel;
  },
  removeChannel(channel) { window.qaChannels = window.qaChannels.filter(item => item !== channel); },
};
