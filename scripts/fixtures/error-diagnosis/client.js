// Synthetic admin data only. No production calls or credentials.
export const supabase = {
  from(table) {
    let values, fields;
    return {
      select(selected) { fields = selected; return this; },
      order() { return this; },
      limit(limit) {
        window.qaCalls.push({ table, fields, limit, method: 'GET' });
        if (window.qaReadFailure) return Promise.resolve({ error: { message: 'offline' }, data: null });
        const rows = window.qaRows.map(row => Object.fromEntries(fields.split(',').map(field => [field, row[field]])));
        return Promise.resolve({ data: rows, error: null });
      },
      update(value) { values = value; return this; },
      in(column, ids) {
        window.qaCalls.push({ table, method: 'PATCH', column, ids, values });
        if (window.qaWriteFailure) return Promise.resolve({ error: { message: 'denied' } });
        window.qaRows = window.qaRows.map(row => ids.includes(row.id) ? { ...row, ...values } : row);
        return Promise.resolve({ error: null });
      },
    };
  },
};
