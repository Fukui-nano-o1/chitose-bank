import {accountSaveFixture} from './account-save-client.mjs';
export const fixture=accountSaveFixture(window.qaOptions||{});
window.qaAccountSave=fixture;
export const supabase=fixture.client;
