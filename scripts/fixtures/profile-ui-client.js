import { profileFixture } from './profile-client.mjs';
const fixture = window.qaProfile = profileFixture(window.qaOptions);
export const supabase = fixture.client;
