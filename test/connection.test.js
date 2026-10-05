'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Connection=require('../lib/connection');
const make=()=>{const c=new Connection({},[{device_sn:'test'}]);c.states.set('test',{statusUpdated:Date.now(),settings:{brightness:60},groups:{}});return c;};
test('control waits for a matching fresh status, not cached or conflicting state',async()=>{
 const c=make();let sent=0;let settled=false;c.send=async(sn,action)=>{sent++;if(action==='brightness')setImmediate(()=>{c.emit('state',sn,{statusUpdated:0,settings:{brightness:65},groups:{}});c.emit('state',sn,{statusUpdated:Date.now(),settings:{brightness:60},groups:{}});setImmediate(()=>{assert.equal(settled,false);c.emit('state',sn,{statusUpdated:Date.now(),settings:{brightness:65},groups:{}});});});};
 await c.control('test','brightness',{value:65}).then(()=>settled=true);assert.ok(sent>=2);assert.equal(c.listenerCount('state'),0);await c.close();
});
test('a failed queued command does not block the next command',async()=>{
 const c=make();let commands=0;c.send=async(sn,action)=>{if(action==='brightness'){commands++;if(commands===1)throw Error('offline');setImmediate(()=>c.emit('state',sn,{statusUpdated:Date.now(),settings:{brightness:60},groups:{}}));}};
 const a=c.control('test','brightness',{value:65});const b=c.control('test','brightness',{value:60});await assert.rejects(a,/offline/);await b;assert.equal(commands,2);await c.close();
});
test('invalid controls are rejected before sending any packet',async()=>{
 const c=make();let sent=0;c.send=async()=>sent++;await assert.rejects(c.control('test','brightness',{value:200}));await assert.rejects(c.control('test','power',{port:'C9',on:false}));assert.equal(sent,0);await c.close();
});
