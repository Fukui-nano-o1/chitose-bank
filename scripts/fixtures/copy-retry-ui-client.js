import {copyRetryFixture} from './copy-retry-client.mjs';
export const fixture=copyRetryFixture(window.qaOptions);window.qaCopy=fixture;
export const supabase=fixture.client;
