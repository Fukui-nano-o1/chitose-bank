export const supabase = {
  rpc: async (name, args) => {
    window.qaCalls.push({name,args});
    const result=window.qaResults.shift();
    if (result?.delay) await new Promise(resolve => setTimeout(resolve,result.delay));
    return result || {data:{ok:true,items:[],has_more:false}};
  },
};
