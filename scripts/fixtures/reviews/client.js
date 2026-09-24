export const supabase = {
  from(table) {
    return {
      select() { return this; },
      eq() { return Promise.resolve({ data: [], error: null }); },
      async insert(payload) {
        if (table !== 'reviews') throw new Error(`Unexpected insert: ${table}`);
        window.qaInserts.push(JSON.parse(JSON.stringify(payload)));
        return { error: window.qaFailSave ? { message: '接続を確認してください' } : null };
      },
    };
  },
};
