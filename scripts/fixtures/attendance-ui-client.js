import {attendanceFixture} from './attendance-client.mjs';
export const fixture=attendanceFixture(window.qaOptions||{});
window.qaAttendance=fixture;
export const supabase=fixture.client;
