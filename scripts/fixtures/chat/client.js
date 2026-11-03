const copy = value => JSON.parse(JSON.stringify(value));
const uid = () => window.qaUser;
class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  lt(key, value) { this.filters.push(row => Date.parse(row[key]) < Date.parse(value)); return this; }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  is(key, value) { return this.eq(key, value); }
  order(key, options) { this.sort = [key, options]; return this; }
  limit(n) { this.count = n; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(row) { this.op = 'insert'; this.value = row; return this; }
  update(row) { this.op = 'update'; this.value = row; return this; }
  upsert(row, options) { this.options = options; this.op = 'upsert'; this.value = row; return this; }
  async run() {
    const table = this.table;
    window.qaRequests.push({ table, op: this.op, value: this.value && copy(this.value) });
    if (window.qaHold === table && this.op === 'select') await new Promise(resolve => { window.qaRelease = resolve; });
    if (window.qaFailRead === table && this.op === 'select') return { data: null, error: { message: 'offline' } };
    const data = window.qaData[table] || [];
    if (['update','upsert'].includes(this.op)) {
      if (window.qaBeforeReadWrite) await window.qaBeforeReadWrite(this);
      if (window.qaFailReadWrite === table) return { data: null, error: { message: 'write failed' } };
      if (window.qaHoldReadWrite === table) await new Promise(resolve => { window.qaReleaseReadWrite = resolve; });
      if (window.qaZeroReadWrite === table) return { data: [], error: null };
    }
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
    if (this.op === 'upsert') {
      for (const row of Array.isArray(this.value) ? this.value : [this.value]) {
        const existing = data.find(item => item.application_id === row.application_id && item.reader_id === row.reader_id);
        if (!existing) data.push(copy(row));
        else if (!this.options?.ignoreDuplicates) Object.assign(existing, row);
      }
      return { data: [], error: null };
    }
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
    if (name === 'confirm_my_worker_terms') {
      window.qaRequests.push({rpc:name,args:copy(args)});
      await window.qaTermsBeforeRPC?.();
      if (args.p_owner !== uid()) return {data:{ok:false,reason:'not_logged_in'}};
      if (window.qaTermsMode === 'rejected') return {data:{ok:false,reason:'save_rejected'}};
      const app = window.qaData.applications.find(a=>a.id===args.p_application_id && a.worker_id===uid());
      if (!app) return {data:{ok:false,reason:'not_party'}};
      if (!app.terms_confirmed_worker_at) {
        app.terms_confirmed_worker_at = new Date().toISOString();
        window.qaTermsWrites = (window.qaTermsWrites || 0) + 1;
        window.qaData.messages.push({id:'terms-message',application_id:app.id,sender_id:uid(),body:'✓ 求人内容を確認しました。よろしくお願いします。',created_at:new Date().toISOString()});
      }
      if (window.qaTermsMode === 'lost') { window.qaTermsMode = null; throw Error('response lost'); }
      if (window.qaTermsMode === 'switch') window.qaUser = 'another-account';
      return {data:{ok:true,owner:args.p_owner,application_id:app.id,worker_confirmed:true}};
    }
    if (name === 'my_unread_message_counts') {
      if (!window.qaComputeUnread) return { data: { by_application: window.qaUnread } };
      const counts = {};
      for (const application of window.qaData.applications) {
        if (![application.worker_id, application.farmer_id].includes(uid()) || ['rejected','expired','canceled'].includes(application.status)) continue;
        const messages = window.qaData.messages.filter(message => message.application_id === application.id && message.sender_id !== uid() && !message.read_at).length;
        const marker = window.qaData.chat_reads.find(row => row.application_id === application.id && row.reader_id === uid());
        const status = application.status_changed_at && application.status_changed_by !== uid() && (!marker || Date.parse(marker.last_read_at) < Date.parse(application.status_changed_at)) ? 1 : 0;
        if (messages + status) counts[application.id] = messages + status;
      }
      return { data: { by_application: counts } };
    }
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
