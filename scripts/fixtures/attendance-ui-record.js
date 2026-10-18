import {recordAttendance as actualRecord,readAttendancePending as actualRead} from '../../src/lib/attendanceRecord.js';
import {fixture} from './attendance-ui-client.js';
export {attendanceKey} from '../../src/lib/attendanceRecord.js';
export const recordAttendance=(client,owner,input,mode)=>actualRecord(client,owner,input,mode,fixture);
export const readAttendancePending=(client,owner,app,day,mode)=>actualRead(client,owner,app,day,mode,fixture.store);
