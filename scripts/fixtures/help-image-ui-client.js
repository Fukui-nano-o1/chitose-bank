import {helpImageFixture} from './help-image-client.mjs';
const options=window.qaOptions;
options.slot=window.qaRole==='install'?'install-ios':'about-intro';
export const fixture=helpImageFixture(options);
window.qaHelpImage=fixture;
export const supabase=fixture.client;
