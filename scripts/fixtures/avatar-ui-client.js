import { avatarFixture } from './avatar-client.mjs';
window.qaAvatar = avatarFixture(window.qaRole, window.qaOptions || {});
export const supabase = window.qaAvatar.client;
