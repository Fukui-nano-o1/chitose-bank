export const uid = '11111111-1111-4111-8111-111111111111';
export const origin = 'https://storage.example.invalid/storage/v1/object/public/avatars/';
export function avatarFixture(role = 'worker', options = {}) {
  const table = role + '_profiles', folder = role + '/' + uid;
  const oldPath = folder + '/avatar.jpg', oldUrl = origin + oldPath + '?t=old';
  const state = {
    userId: uid, rows: { [table]: { auth_id: uid, avatar_url: oldUrl, updated_at: '2026-10-01T00:00:00.000Z', nickname: 'Fixture', transport: '自転車' } },
    objects: new Map([[oldPath, new Blob(['old'], { type: 'image/jpeg' })]]), events: [], options, reads: 0, writes: 0,
  };
  const error = { message: 'Injected rejection', code: '42501' };
  class Query {
    constructor(name) { this.name = name; this.filters = []; this.kind = 'read'; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    is(key, value) { return this.eq(key, value); }
    update(payload) { this.kind = 'update'; this.payload = payload; return this; }
    insert(payload) { this.kind = 'insert'; this.payload = payload; return this; }
    upsert(payload) { this.kind = 'upsert'; this.payload = payload; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    maybeSingle() { return this.execute(); }
    async execute() {
      state.events.push({ type: this.kind, table: this.name, filters: this.filters, payload: this.payload });
      const row = state.rows[this.name];
      if (this.kind === 'read') {
        state.reads++;
        if (options.readError || (options.readErrorAfterWrite && state.writes)) return { data: null, error };
        return { data: row ? { ...row } : null, error: null };
      }
      state.writes++;
      await options.beforeWrite?.(state, this);
      if (options.dbError) return { data: null, error };
      if (this.kind === 'insert' && state.rows[this.name]) return { data: null, error: { code: '23505' } };
      const current = state.rows[this.name];
      if (this.kind === 'update' && (!current || !this.filters.every(([key, value]) => current[key] === value))) return { data: null, error: null };
      const next = { ...current, ...this.payload };
      state.rows[this.name] = next;
      if (options.dbLostResponse) throw new Error('Response lost after DB commit');
      return { data: { ...next }, error: null };
    }
  }
  const storage = {
    getPublicUrl: path => ({ data: { publicUrl: origin + path } }),
    async upload(path, blob, uploadOptions) {
      state.events.push({ type: 'upload', path, options: uploadOptions });
      if (options.uploadError) return { data: null, error };
      if (state.objects.has(path) && !uploadOptions.upsert) return { data: null, error: { code: '409' } };
      state.objects.set(path, blob);
      await options.afterUpload?.(state, path);
      if (options.uploadLostResponse) throw new Error('Response lost after object write');
      return { data: { path }, error: null };
    },
    async download(path) {
      state.events.push({ type: 'download', path });
      const blob = options.downloadMismatch ? new Blob(['not the uploaded data']) : state.objects.get(path);
      return { data: blob, error: blob && !options.downloadError ? null : error };
    },
    async list(prefix) { return { data: [...state.objects.keys()].filter(p => p.startsWith(prefix + '/')).map(p => ({ name: p.slice(prefix.length + 1) })), error: null }; },
    async remove(paths) {
      state.events.push({ type: 'remove', paths });
      if (options.removeError) return { error };
      paths.forEach(path => state.objects.delete(path));
      return { data: [], error: null };
    },
  };
  const client = { from: name => new Query(name), storage: { from: () => storage }, auth: { getSession: async () => ({ data: { session: state.userId ? { user: { id: state.userId } } : null }, error: null }) } };
  return { client, state, table, folder, oldPath, oldUrl, args: { client, table, directory: role, userId: uid, expectedUrl: oldUrl } };
}
