import {consignmentFixture} from './consignment-deal-client.mjs';
export const fixture=consignmentFixture(window.qaOptions);
window.qaConsignment=fixture;
export const supabase=fixture.client;
