import {savedJobFixture} from './saved-job-client.mjs';
export const fixture=savedJobFixture(window.qaOptions||{});
window.qaSaved=fixture;
export const supabase=fixture.client;
