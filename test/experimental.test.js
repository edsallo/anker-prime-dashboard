'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Experimental,snapshot,wire}=require('../lib/experimental');
const settings={customProfile:[1,1,20,50,40,20,0],customProtocols:[59,0,0,59,0,0,11,0,0,2,0,0]};
class Cloud{
 constructor(){this.flags={compatibility_status:0,charging_mode_status:1};this.identity=1;this.profiles=[{...snapshot(settings,1,'Original',1),id:10}];this.calls=[];}
 async request(path,body){this.calls.push({path,body});switch(path.split('/').at(-1)){
 case 'get_device_setting':return {device_setting:structuredClone(this.flags)};
 case 'get_charging_device_identity_status_default_true':return {charging_device_identity_status_default_true:this.identity};
 case 'get_charging_mode_list':return {charging_mode_list:structuredClone(this.profiles)};
 case 'set_compatibility_status':this.flags.compatibility_status=body.compatibility_status;return {};
 case 'set_charging_mode_status':this.flags.charging_mode_status=body.charging_mode_status;return {};
 case 'set_charging_device_identity_status_default_true':this.identity=body.charging_device_identity_status_default_true;return {};
 case 'add_charging_mode':this.profiles.push({...structuredClone(body),id:11});return {};
 case 'update_charging_mode':this.profiles=this.profiles.map(p=>p.id===body.id?structuredClone(body):p);return {};
 case 'delete_charging_mode':this.profiles=this.profiles.filter(p=>p.id!==body.id);return {};
 default:throw Error('Unexpected endpoint');
 }}
}
function connection(){return {states:new Map([['sn',{settings}]]),waitFor(){const p=Promise.resolve();p.cancel=()=>{};return p;},async send(){},async control(sn,action,args){this.last={sn,action,args};}};}
test('A2345 uses the correct identity setting; compatibility blocks enabling identification',async()=>{
 const c=new Cloud(),x=new Experimental(c),conn=connection();assert.equal((await x.refresh('sn')).identification,true);
 await x.control('sn','experimental',{setting:'compatibility',enabled:true},settings,conn);
 await assert.rejects(x.control('sn','experimental',{setting:'identification',enabled:true},settings,conn));
 await x.control('sn','experimental',{setting:'compatibility',enabled:false},settings,conn);
 await x.control('sn','experimental',{setting:'identification',enabled:false},settings,conn);
 assert.equal(x.view('sn').identification,false);
 const count=c.calls.filter(r=>r.path.includes('/set_')).length;
 await assert.rejects(x.control('sn','experimental',{setting:'arbitrary',enabled:true},settings,conn));
 assert.equal(c.calls.filter(r=>r.path.includes('/set_')).length,count);
});
test('cloud profiles preserve protocol masks, use current confirmed state, and apply only known IDs',async()=>{
 const c=new Cloud(),x=new Experimental(c),conn=connection();
 await x.control('sn','profile_save',{name:'New',autoExit:false},settings,conn);
 assert.equal(c.profiles.length,2);assert.deepEqual(wire(c.profiles[1]),{profile:[2,0,20,50,40,20,0],protocols:settings.customProtocols});
 await x.control('sn','profile_update',{id:11,name:'Renamed',autoExit:true,fromCurrent:false},settings,conn);
 await x.control('sn','profile_apply',{id:11},settings,conn);
 assert.equal(conn.last.action,'custom');assert.deepEqual(conn.last.args.profile,[2,1,20,50,40,20,0]);
 await assert.rejects(x.control('sn','profile_apply',{id:999},settings,conn));assert.equal(conn.last.args.profile[0],2);
 await x.control('sn','profile_delete',{id:11},settings,conn);assert.equal(c.profiles.length,1);assert.equal(c.profiles[0].name,'Original');
});
test('profiles reject unknown protocols, invalid budgets and a fifth slot',async()=>{
 assert.throws(()=>snapshot({...settings,customProtocols:[59,1,0,59,0,0,11,0,0,2,0,0]},1,'Bad',1));
 assert.throws(()=>wire({...snapshot(settings,1,'Budget',1),power_settings:snapshot(settings,1,'Budget',1).power_settings.map(p=>({...p,power:p.max_power}))}));
 const c=new Cloud(),x=new Experimental(c);c.profiles=[1,2,3,4].map(number=>({...snapshot(settings,number,'P'+number,1),id:number}));
 await assert.rejects(x.control('sn','profile_save',{name:'Fifth',autoExit:true},settings,connection()));
});
test('failed cloud refresh marks old data stale without pretending switches are off',async()=>{
 const c=new Cloud(),x=new Experimental(c);await x.refresh('sn');c.request=async()=>{throw Error('offline');};await x.poll('sn');assert.equal(x.view('sn').stale,true);assert.equal(x.view('sn').identification,true);
});
