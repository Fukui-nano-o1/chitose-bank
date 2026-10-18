import {copyJobRecord as actual} from '../../src/lib/copyJobRecord.js';
import {fixture} from './copy-retry-ui-client.js';
export const copyJobRecord=(client,number,options)=>actual(client,number,options,fixture);
