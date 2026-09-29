export const supabase = {
  auth:{ async getSession() { return {data:{session:{user:{id:'farmer-a'}}}}; } },
  rpc(name) {
    if (name !== 'review_window') throw new Error('Unexpected RPC: '+name);
    return {abortSignal(){return this;}, then(resolve,reject) {
      const now=Date.now();
      return Promise.resolve(window.qaWindowError ? {error:{message:'offline'}} : {data:{ok:true,state:window.qaWindowState||'open',
        server_now:new Date(now).toISOString(),closes_at:new Date(now+(window.qaWindowRemaining ?? 3600000)).toISOString()}}).then(resolve,reject);
    }};
  },
  from(table) {
    const query={table,filters:[]};
    return {
      select(columns) { query.columns=columns; window.qaSelects.push(query); return this; },
      eq(key,value) { query.filters.push([key,value]); return this; },
      order() { return this; },
      then(resolve,reject) { return Promise.resolve({data:table==='reviews'?(window.qaMyReviews||[]):[],error:null}).then(resolve,reject); },
      async insert(payload) {
        if (table !== 'reviews') throw new Error(`Unexpected insert: ${table}`);
        window.qaInserts.push(JSON.parse(JSON.stringify(payload)));
        if (window.qaHoldSave) await new Promise(resolve => { window.qaReleaseSave = resolve; });
        if (window.qaThrowSave) throw new Error('offline');
        return { error: window.qaFailSave ? { code: window.qaFailCode, message: window.qaFailMessage || '接続を確認してください' } : null };
      },
    };
  },
};
