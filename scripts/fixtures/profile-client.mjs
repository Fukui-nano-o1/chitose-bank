export const uid = '11111111-1111-4111-8111-111111111111';
const clone = x => JSON.parse(JSON.stringify(x));
const equal = (a,b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function profileFixture(options = {}) {
  const common = { auth_id: uid, nickname:'Fixture', avatar_url:'', updated_at:'2026-10-01T00:00:00Z' };
  const state = { userId:uid, options, events:[], writes:0, rows: {
    worker_profiles: { ...common, residence_city:'吉野川市', transport:'自転車', farm_experience:'経験あり', pr:'元の自己紹介', pr_pending:null, pr_qa:[{q:'質問',a:'元の回答'}], pr_qa_pending:null, interests:['読書'], self_declared:['普通免許'], experience_entries:[{crop:'米',task:'収穫',duration:'1年'}], experienced_tasks:['収穫'] },
    employer_profiles: { ...common, recruiter_name:'元の農園', recruiter_name_kana:'モト', recruiter_contact:'000-0000-0000', recruiter_address:'元の所在地', recruiter_address_detail:'元の所在地', has_parking:true, parking_capacity:2, has_transport:false, insurance_items:['rosai'], insurance_notes:{rosai:'元のメモ'}, owner_comment:'元の代表文', unique_point:'元の特徴', texts_pending:{} },
    emergency_contacts:{auth_id:uid,name:'元の連絡先',phone:'000-0000-0000',relation:'家族',confirmed_at:null},
  }};
  const rejected = {code:'42501',message:'Injected rejection'};
  class Query {
    constructor(table){this.table=table;this.filters=[];this.kind='read';}
    select(){return this;} eq(k,v){this.filters.push([k,v]);return this;} is(k,v){return this.eq(k,v);}
    update(p){this.kind='update';this.patch=p;return this;} insert(p){this.kind='insert';this.patch=p;return this;}
    upsert(p){this.kind='upsert';this.patch=p;return this;}
    maybeSingle(){return this.execute();} then(a,b){return this.execute().then(a,b);}
    async execute(){
      state.events.push({table:this.table,kind:this.kind,patch:this.patch,filters:this.filters});
      if(this.kind==='read') {
        if(options.readError || (options.readErrorAfterWrite&&state.writes)) return {data:null,error:rejected};
        return {data:state.rows[this.table]?clone(state.rows[this.table]):null,error:null};
      }
      state.writes++; await options.beforeWrite?.(state,this);
      if(options.dbError) return {data:null,error:rejected};
      const current=state.rows[this.table];
      if(this.kind==='insert'&&current) return {data:null,error:{code:'23505'}};
      if(this.kind==='update'&&(!current||!this.filters.every(([k,v])=>equal(current[k],current[k]&&typeof current[k]==='object'?JSON.parse(v):v)))) return {data:null,error:null};
      const next={...current,...clone(this.patch)};
      if(this.table==='worker_profiles') {
        for(const key of ['pr','pr_qa']) if(next[key+'_pending']!=null){next[key]=next[key+'_pending'];next[key+'_pending']=null;}
      }
      if(this.table==='employer_profiles'&&next.texts_pending){Object.assign(next,next.texts_pending);next.texts_pending={};}
      if(options.normalizeTimestamp&&next.confirmed_at) next.confirmed_at=next.confirmed_at.replace('Z','+00:00');
      state.rows[this.table]=next;
      if(options.lostResponse) throw new Error('Response lost');
      return {data:clone(next),error:null};
    }
  }
  const client={from:t=>new Query(t),auth:{getSession:async()=>({data:{session:state.userId?{user:{id:state.userId}}:null},error:null})},rpc:async(name,args)=>{
    if(name!=='save_my_profile_fields')return {data:0,error:null};
    await options.beforeRPC?.(state,args);
    if(args.p_owner!==state.userId)return {data:{ok:false,reason:'not_logged_in'},error:null};
    const q=new Query(args.p_table);
    if(args.p_expected===null)q.insert({auth_id:state.userId,...args.p_patch});
    else {q.update(args.p_patch).eq('auth_id',state.userId);for(const [k,v] of Object.entries(args.p_expected))q.eq(k,v&&typeof v==='object'?JSON.stringify(v):v);}
    const r=await q.execute();
    return {error:r.error,data:r.data?{ok:true,row:r.data}:{ok:false,reason:'conflict'}};
  }};
  return {client,state};
}
