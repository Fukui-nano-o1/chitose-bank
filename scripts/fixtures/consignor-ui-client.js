import {consignorFixture} from './consignor-client.mjs';
const f=consignorFixture(window.qaOptions||{});window.qaConsignor=f;
export const supabase=f.client;
