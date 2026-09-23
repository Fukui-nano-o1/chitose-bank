import { createClient } from '@supabase/supabase-js';

// Production PostgREST client with an isolated transport. Never contacts the live project.
window.qaCalls = [];
export const supabase = createClient('https://reports-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, init) => {
    const request = new URL(url);
    const table = request.pathname.replace('/rest/v1/', '');
    const method = init?.method || 'GET';
    const patch = init?.body ? JSON.parse(init.body) : null;
    window.qaCalls.push({ table, method, query: request.search, patch });
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (!Object.hasOwn(window.qaTables, table)) throw new Error(`Unexpected table: ${table}`);
    if (window.qaFailTables?.includes(table)) return response({ message: 'Unavailable' }, 403);
    let rows = window.qaTables[table];
    const id = request.searchParams.get('id')?.slice(3);
    if (id) rows = rows.filter(row => row.id === id);
    if (method === 'PATCH') {
      if (window.qaUpdateGate) await window.qaUpdateGate;
      if (window.qaFailUpdate) return response({ message: 'Denied' }, 403);
      const status = request.searchParams.get('status')?.slice(3);
      rows = rows.filter(row => row.status === status);
      if (rows.length !== 1) return response({ message: 'No matching row', code: 'PGRST116' }, 406);
      Object.assign(rows[0], patch);
    } else if (method !== 'GET') throw new Error(`Unexpected write: ${method}`);
    const columns = request.searchParams.get('select');
    const data = columns === '*' ? rows : rows.map(row => Object.fromEntries(columns.split(',').filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
    if (new Headers(init?.headers).get('Accept')?.includes('vnd.pgrst.object')) {
      if (data.length !== 1) return response({ message: 'No matching row', code: 'PGRST116' }, 406);
      return response(data[0]);
    }
    return response(data);
  } },
});
