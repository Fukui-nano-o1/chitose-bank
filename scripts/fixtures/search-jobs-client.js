// Deferred synthetic responses only: this client has no network transport.
window.qaSearchRequests = [];
window.qaViewCalls = [];
export const supabase = {
  from(table) {
    return {
      select(columns) {
        const defer = (method, args) => new Promise((resolve, reject) => {
          window.qaSearchRequests.push({ table, columns, method, args, resolve, reject });
        });
        return {
          order: (...args) => defer('order', args),
          in: (...args) => defer('in', args),
        };
      },
    };
  },
  rpc(name, args) {
    window.qaViewCalls.push({ name, args });
    return window.qaRejectView ? Promise.reject(new Error('synthetic failure')) : Promise.resolve({ data: null });
  },
};
