import { profileFixture } from './profile-client.mjs';
const fixture = window.qaProfile = profileFixture(window.qaOptions);
if (window.qaWorkplaceRPC) {
  fixture.client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
  const rpc = fixture.client.rpc;
  fixture.client.rpc = (name, args) => ['read_my_workplace', 'read_my_workplace_photos'].includes(name) ? window.qaWorkplaceRPC(name, args) : rpc(name, args);
}
export const supabase = fixture.client;
