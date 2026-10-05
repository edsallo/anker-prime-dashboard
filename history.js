'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),readline=require('node:readline'),{createReadStream}=require('node:fs');
const PORTS=['C1','C2','C3','C4','A1','A2'],DAY=86400000;
class History{
 constructor(dir){this.dir=dir;this.last=new Map();this.busy=false;this.lastCleanup=0;this.error=false;}
 async sample(data,now=Date.now()){
  await fs.mkdir(this.dir,{recursive:true});const rows=[];const catalog=JSON.stringify((data.devices||[]).map(d=>({id:d.id,name:d.name||d.id,labels:d.labels||{}})));if(catalog!=='[]'&&catalog!==this.catalog){await fs.writeFile(path.join(this.dir,'devices.tmp'),catalog,{mode:0o600});await fs.rename(path.join(this.dir,'devices.tmp'),path.join(this.dir,'devices.json'));this.catalog=catalog;}
  for(const d of data.devices||[]){if(d.stale||!Number.isFinite(d.updated)||now-d.updated>30000||d.updated>now||d.updated<=(this.last.get(d.id)||0))continue;
   const ports=PORTS.map(p=>{const v=d.ports[p];return v&&Number.isFinite(v.updated)&&now-v.updated<=30000&&['power','voltage','current'].every(k=>Number.isFinite(v[k]))?[v.power,v.voltage,v.current,!!v.active]:null;});
   rows.push({t:d.updated,id:d.id,p:ports});
  }
  for(const r of rows){await fs.appendFile(path.join(this.dir,new Date(r.t).toISOString().slice(0,10)+'.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});this.last.set(r.id,r.t);}
  if(now-this.lastCleanup>DAY){for(const file of await fs.readdir(this.dir)){if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)&&Date.parse(file.slice(0,10))+DAY<now-30*DAY)await fs.unlink(path.join(this.dir,file));}this.lastCleanup=now;}
 }
 startProvider(provider){const tick=async()=>{if(this.busy)return;this.busy=true;try{const data=await provider();await this.sample(data);this.error=!data.devices?.length||data.devices.every(d=>d.stale);}catch{this.error=true;}finally{this.busy=false;}};tick();this.timer=setInterval(tick,10000);return this;}
 async devices(){try{return JSON.parse(await fs.readFile(path.join(this.dir,'devices.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async query(id,port,hours,now=Date.now()){
  if(typeof id!=='string'||id.length>120||!PORTS.includes(port)||![1,6,24,168,720].includes(hours))throw Error('Invalid history query');
  const from=now-hours*3600000,step=Math.max(10000,Math.ceil(hours*3600000/600/10000)*10000),buckets=new Map(),index=PORTS.indexOf(port),summary={wh:0,coveredSeconds:0,chargingSeconds:0,peak:0,samples:0},previous=null;
  let prev=previous,first=null,last=null;
  let files=[];try{files=(await fs.readdir(this.dir)).filter(f=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)&&Date.parse(f.slice(0,10))+DAY>=from&&Date.parse(f.slice(0,10))<=now).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const file of files){const lines=readline.createInterface({input:createReadStream(path.join(this.dir,file)),crlfDelay:Infinity});for await(const line of lines){let r;try{r=JSON.parse(line);}catch{continue;}if(r.id!==id||r.t<from||r.t>now)continue;const p=r.p[index];if(!p){prev=null;continue;}if(prev&&r.t<=prev.t)continue;
    const dt=prev?(r.t-prev.t)/1000:0;if(dt>0&&dt<=30){summary.wh+=(prev.p[0]+p[0])/2*dt/3600;summary.coveredSeconds+=dt;if(prev.p[3]&&p[3])summary.chargingSeconds+=dt;}
    const key=Math.floor((r.t-from)/step),b=buckets.get(key)||{t:from+(key+.5)*step,n:0,timeSum:0,sum:[0,0,0],min:[Infinity,Infinity,Infinity],max:[0,0,0]};for(let m=0;m<3;m++){b.sum[m]+=p[m];b.min[m]=Math.min(b.min[m],p[m]);b.max[m]=Math.max(b.max[m],p[m]);}b.n++;b.timeSum+=r.t;buckets.set(key,b);summary.peak=Math.max(summary.peak,p[0]);summary.samples++;first=first??r.t;last=r.t;prev={t:r.t,p};
  }}
  return {port,from,to:now,step,first,last,collectorError:this.error,summary,points:[...buckets.values()].sort((a,b)=>a.t-b.t).map(b=>({t:b.timeSum/b.n,avg:b.sum.map(v=>v/b.n),min:b.min,max:b.max})),retentionDays:30};
 }
}
module.exports={History,PORTS};
