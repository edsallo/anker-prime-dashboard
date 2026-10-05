'use strict';
const {command}=require('./protocol');
const ports=['C1','C2','C3','C4','A'],flags=['scp','ufcs','pd12v','pps11v','pps16v','pps20v','huawei','xiaomi'];
const prefix='mini_power/v1/app/';
function bit(v){if(v!==0&&v!==1)throw Error('Anker вернул неизвестное состояние настройки.');return !!v;}
function wire(p){
 if(!Number.isInteger(p.number)||p.number<1||p.number>4||!Array.isArray(p.power_settings)||![0,1].includes(p.auto_exit))throw Error('Неподдерживаемый профиль Anker.');
 const settings=ports.map(name=>{const matches=p.power_settings.filter(x=>x.name===name);if(matches.length!==1)throw Error('Неполный профиль Anker.');return matches[0];});
 const profile=[p.number,p.auto_exit,...settings.map(x=>x.power)],protocols=[];
 for(const s of settings.slice(0,4)){let mask=0;flags.forEach((k,i)=>{if(![0,1].includes(s[k]))throw Error('Неизвестные протоколы профиля.');mask|=s[k]<<i;});protocols.push(mask,0,0);}
 command('custom',{profile,protocols});return {profile,protocols};
}
function snapshot(s,number,name,autoExit){
 if(!Array.isArray(s.customProfile)||!Array.isArray(s.customProtocols))throw Error('Подождите получения профиля от зарядки.');
 const profile={number,name,auto_exit:autoExit??s.customProfile[1],has_charge_protocol:1,max_total_power:250,total_power:s.customProfile.slice(2).reduce((a,b)=>a+b,0),power_settings:ports.map((port,i)=>({name:port,power:s.customProfile[i+2],max_power:[140,100,100,100,24][i],input_power:0,input_max_power:0,...Object.fromEntries(flags.map((k,j)=>[k,i<4?(s.customProtocols[i*3]>>j)&1:0]))}))};
 if(s.customProtocols.some((v,i)=>i%3&&v!==0))throw Error('Неизвестные дополнительные протоколы. Сохраните профиль в Anker.');
 wire(profile);return profile;
}
class Experimental{
 constructor(cloud){this.cloud=cloud;this.cache=new Map();this.queues=new Map();}
 view(sn){return this.cache.get(sn)||{ready:false,stale:true,profiles:[]};}
 async refresh(sn){
  const [settings,identity,modes]=await Promise.all([
   this.cloud.request(prefix+'setting/get_device_setting',{device_sn:sn}),
   this.cloud.request(prefix+'setting/get_charging_device_identity_status_default_true',{device_sn:sn}),
   this.cloud.request(prefix+'charging/get_charging_mode_list',{device_sn:sn})
  ]);
  const s=settings.device_setting;if(!s||!Array.isArray(modes.charging_mode_list))throw Error('Неполный ответ экспериментальных настроек.');
  const data={ready:true,stale:false,updated:Date.now(),compatibility:bit(s.compatibility_status),customEnabled:bit(s.charging_mode_status),identification:bit(identity.charging_device_identity_status_default_true),profiles:modes.charging_mode_list.map(p=>structuredClone(p))};
  this.cache.set(sn,data);return data;
 }
 async poll(sn){try{return await this.refresh(sn);}catch{const old=this.view(sn);this.cache.set(sn,{...old,stale:true});return this.view(sn);}}
 control(sn,action,args,settings,connection){
  const previous=this.queues.get(sn)||Promise.resolve();
  const job=previous.catch(()=>{}).then(()=>this.change(sn,action,args,settings,connection));
  this.queues.set(sn,job);job.finally(()=>{if(this.queues.get(sn)===job)this.queues.delete(sn);}).catch(()=>{});return job;
 }
 async change(sn,action,a,s,connection){
  const current=await this.refresh(sn);
  if(action==='experimental'){
   const choices={compatibility:['set_compatibility_status','compatibility_status'],customEnabled:['set_charging_mode_status','charging_mode_status'],identification:['set_charging_device_identity_status_default_true','charging_device_identity_status_default_true']};
   if(!Object.hasOwn(choices,a.setting)||typeof a.enabled!=='boolean')throw Error('Неизвестная настройка.');
   if(a.setting==='identification'&&a.enabled&&current.compatibility)throw Error('Сначала выключите максимальную совместимость.');
   const [endpoint,key]=choices[a.setting];await this.cloud.request(prefix+'setting/'+endpoint,{device_sn:sn,[key]:Number(a.enabled)});
   const result=await this.refresh(sn);if(result[a.setting]!==a.enabled)throw Error('Облако не подтвердило изменение.');return {ok:true};
  }
  const original=current.profiles.find(p=>String(p.id)===String(a.id));
  if(action==='profile_apply'){
   if(!current.customEnabled)throw Error('Сначала включите пользовательские профили.');
   if(!original)throw Error('Профиль не найден.');await connection.control(sn,'custom',wire(original));return {ok:true};
  }
  if(action==='profile_delete'){
   if(!original)throw Error('Профиль не найден.');await this.cloud.request(prefix+'charging/delete_charging_mode',{id:original.id});
   if((await this.refresh(sn)).profiles.some(p=>p.id===original.id))throw Error('Удаление не подтверждено.');return {ok:true};
  }
  if(!['profile_save','profile_update'].includes(action))throw Error('Неподдерживаемая команда.');
  if(typeof a.name!=='string'||!a.name.trim()||a.name.trim().length>40||typeof a.autoExit!=='boolean')throw Error('Укажите название до 40 символов и автоматический выход.');
  if(action==='profile_save'||a.fromCurrent){
   const requested=Date.now(),wait=connection.waitFor(sn,state=>state.statusUpdated>=requested);wait.catch(()=>{});
   try{await connection.send(sn,'status');await wait;s=connection.states.get(sn).settings;}finally{wait.cancel();}
  }
  let value;
  if(action==='profile_save'){
   if(current.profiles.length>=4)throw Error('Можно сохранить до четырёх профилей.');
   const number=[1,2,3,4].find(n=>!current.profiles.some(p=>p.number===n));if(!number)throw Error('Нет свободного номера профиля.');
   value=snapshot(s,number,a.name.trim(),Number(a.autoExit));value.device_sn=sn;
  }else{
   if(!original)throw Error('Профиль не найден.');
   value=a.fromCurrent?snapshot(s,original.number,a.name.trim(),Number(a.autoExit)):{...original,name:a.name.trim(),auto_exit:Number(a.autoExit)};
   wire(value);value.id=original.id;
  }
  await this.cloud.request(prefix+'charging/'+(action==='profile_save'?'add_charging_mode':'update_charging_mode'),value);
  const result=await this.refresh(sn);
  const saved=result.profiles.find(p=>p.number===value.number&&p.name===value.name&&p.auto_exit===value.auto_exit&&JSON.stringify(wire(p))===JSON.stringify(wire(value)));
  if(!saved)throw Error('Сохранение профиля не подтверждено.');return {ok:true};
 }
}
module.exports={Experimental,wire,snapshot};
