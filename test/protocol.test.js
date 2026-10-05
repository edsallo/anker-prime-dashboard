'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {command,decode}=require('../lib/protocol');
// Golden bytes from the independent Python reference encoder, fixed timestamp.
const stamp=0x6abdcce3;
test('wire commands match independent reference implementation',()=>{
 for(const [action,args,hex]of [
 ['status',{},'ff09140003000f0200a10122fe0503e3ccbd6a6e'],
 ['realtime',{},'ff09140003000f020ba10122fe0503e3ccbd6a65'],
 ['power',{port:'C1',on:true},'ff091c0003000f0207a10122a2020100a3020101fe0503e3ccbd6a61'],
 ['timer',{port:'C1',minutes:15},'ff09200003000f0209a10122a2020100a306040184030000fe0503e3ccbd6ad5'],
 ['brightness',{value:50},'ff09180003000f0204a10122a2020132fe0503e3ccbd6af5']])assert.equal(command(action,args,stamp).toString('hex'),hex);
});
test('real charger status provides all physical ports and five switches',()=>{
 const {state:s}=decode(Buffer.from(fs.readFileSync(`${__dirname}/fixtures/status.hex`,'utf8').trim(),'hex'));
 assert.deepEqual(Object.keys(s.ports),['C1','C2','C3','C4','A1','A2']);assert.deepEqual(Object.keys(s.groups),['C1','C2','C3','C4','A']);
 assert.equal(s.settings.brightness,60);assert.equal(s.settings.mode,2);assert.equal(s.groups.C1.on,true);
 assert.equal(s.groups.C1.start.enabled,false);assert.equal(s.groups.C1.timerSeconds,600);
});
test('invalid commands cannot switch arbitrary ports or exceed bounds',()=>{
 for(const [a,v]of [['power',{port:'A2',on:true}],['power',{port:'C1',on:'false'}],['timer',{port:'C1',minutes:-1}],['timer',{port:'C1',minutes:61}],['brightness',{value:101}],['brightness',{value:51}],['mode',{value:5}],['priority',{value:15}],['schedule',{port:'C1',kind:'start',enabled:true,hour:24,minute:0,weekdays:127}]])assert.throws(()=>command(a,v));
});
test('truncated and corrupted frames are rejected without partial state',()=>{
 const frame=Buffer.from(fs.readFileSync(`${__dirname}/fixtures/status.hex`,'utf8').trim(),'hex');
 for(let i=0;i<frame.length;i++)assert.throws(()=>decode(frame.subarray(0,i)));
 for(let i=0;i<frame.length;i++){const b=Buffer.from(frame);b[i]^=1;assert.throws(()=>decode(b));}
});
test('clock schedule and screensaver commands reject malformed inputs',()=>{
 for(const args of [{startHour:24,startMinute:0,endHour:0,endMinute:0,weekdays:127},{startHour:8,startMinute:0,endHour:22,endMinute:60,weekdays:127},{startHour:8,startMinute:0,endHour:22,endMinute:0,weekdays:128}])assert.throws(()=>command('clock_schedule',args));
 for(const url of ['http://example.com/theme.jpg','https://user:pass@example.com/theme.jpg','https://example.com/'+ 'x'.repeat(255)])assert.throws(()=>command('theme',{id:1,hash:1,url}));
 assert.throws(()=>command('clock_holiday',{enabled:'false'}));
});
