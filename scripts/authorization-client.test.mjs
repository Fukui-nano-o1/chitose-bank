import test from 'node:test';
import assert from 'node:assert/strict';
import {isAdmin,readAdminMembership,ATTENDANCE_DENIAL_MESSAGES} from '../src/lib/authorization.js';

test('administrator UI never trusts email or user metadata',()=>{
 assert.equal(isAdmin(null),false);
 assert.equal(isAdmin({id:'one',email:'t5fki6643qty@gmail.com',user_metadata:{is_admin:true}}),false);
 assert.equal(isAdmin({id:'one',authorization:{subject:'two',admin:true}}),false);
 assert.equal(isAdmin({id:'one',authorization:{subject:'one',admin:true}}),true);
});
test('current membership read fails closed and checks the requested identity',async()=>{
 const client=result=>({from(table){assert.equal(table,'app_admins');return {select(){return {eq(key,id){assert.equal(key,'auth_id');assert.equal(id,'one');return {async maybeSingle(){return result;}};}};}};}});
 assert.equal(await readAdminMembership(client({data:{auth_id:'one'}}),'one'),true);
 assert.equal(await readAdminMembership(client({data:null}),'one'),false);
 assert.equal(await readAdminMembership(client({data:{auth_id:'two'}}),'one'),false);
 assert.equal(await readAdminMembership(client({error:Error('offline'),data:{auth_id:'one'}}),'one'),false);
 assert.equal(await readAdminMembership({from(){throw Error('network');}},'one'),false);
});
test('known deadline denial and uncertain historic timestamp have distinct guidance',()=>{
 assert.match(ATTENDANCE_DENIAL_MESSAGES.dispute_window_closed,/72時間/);
 assert.match(ATTENDANCE_DENIAL_MESSAGES.dispute_time_unknown,/確認できません/);
});
