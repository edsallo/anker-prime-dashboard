'use strict';
const table=require('./identity-models.json');
const observed={'05ac:7511':{manufacturer:'Apple',model:'iPhone 15 Plus'},'05ac:7513':{manufacturer:'Apple',model:'iPhone 15 Pro Max'},'05ac:7102':{manufacturer:'Apple',model:'iPad Pro 2020 Series'},'05ac:751f':{manufacturer:'Apple',model:'iPhone 18 Pro Max'}};
const vendors={'05ac':'Apple','291a':'Anker','04e8':'Samsung','045e':'Microsoft','413c':'Dell','12d1':'Huawei','03f0':'HP','17ef':'Lenovo','2717':'Xiaomi'};
function resolve(state,port,custom={}){
 const v=state.ports?.[port],r=state.settings?.portIdentity?.[port];
 if(state.stale||!v||Date.now()-v.updated>45000)return {connected:false,unavailable:true};
 if(!v.active)return {connected:false};
 if(!r)return {connected:true};
 const hex=n=>n.toString(16).padStart(4,'0');
 const key=r.vid&&![65535,65530].includes(r.vid)&&r.pid&&![65535,65531].includes(r.pid)?hex(r.vid)+':'+hex(r.pid):null;
 let manufacturer=table.brands[r.brand]||vendors[hex(r.vid||0)]||'',model='',source='';
 const known=table.models[r.brand]?.[r.model];
 if(known&&r.model!==65535){model=known.replace('{SERIES}','Series').replace('{DEVICES}','Device');source='anker';}
 if(!model&&key&&observed[key]){manufacturer=observed[key].manufacturer;model=observed[key].model;source='observed';}
 if(key&&custom[key]){manufacturer=custom[key].manufacturer;model=custom[key].model;source='user';}
 return {connected:true,key,manufacturer,model,source};
}
function validate(state,args){
 if(!/^C[1-4]$/.test(args.port||''))throw Error('Неизвестный порт.');
 const current=resolve(state,args.port);
 if(!current.connected||!current.key||current.key!==args.key)throw Error('Подключённое устройство изменилось. Обновите страницу.');
 for(const [k,max] of [['manufacturer',40],['model',80]])if(typeof args[k]!=='string'||args[k].length>max||/[\x00-\x1f]/.test(args[k]))throw Error('Некорректное название устройства.');
 if(!args.model.trim())throw Error('Укажите модель устройства.');
 return {key:current.key,value:{manufacturer:args.manufacturer.trim(),model:args.model.trim(),source:'user',updated:Date.now()}};
}
function enrich(data,custom={}){for(const d of data.devices||[])d.identification=Object.fromEntries(['C1','C2','C3','C4'].map(p=>[p,resolve(d,p,custom[d.id]||{})]));return data;}
module.exports={resolve,validate,enrich};
