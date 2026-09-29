export const supabase = {
  from(table) {
    return {
      select() { return this; },
      eq() { return Promise.resolve({ data: [], error: null }); },
      async insert(payload) {
        if (table !== 'reviews') throw new Error(`Unexpected insert: ${table}`);
        window.qaInserts.push(JSON.parse(JSON.stringify(payload)));
        if (window.qaHoldSave) await new Promise(resolve => { window.qaReleaseSave = resolve; });
        if (window.qaThrowSave) throw new Error('offline');
        return { error: window.qaFailSave ? { code: window.qaFailCode, message: '接続を確認してください' } : null };
      },
    };
  },
};
