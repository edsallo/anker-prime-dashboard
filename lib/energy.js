'use strict';
// USB output energy in Wh. Never extrapolate across missing samples or restarts.
class Energy {
 constructor(saved,now=Date.now()){this.value=Number.isFinite(saved?.wh)&&saved.wh>=0?saved.wh:0;this.resetAt=Number.isFinite(saved?.resetAt)?saved.resetAt:now;this.last=null;}
 sample(power,at,now=Date.now()){
  if(!Number.isFinite(power)||power<0||!Number.isFinite(at)||at>now||now-at>30000){this.last=null;return false;}
  if(this.last&&at<=this.last.at)return false;
  const before=this.value;
  if(this.last&&at-this.last.at<=30000)this.value+=(this.last.power+power)/2*(at-this.last.at)/3600000;
  this.last={power,at};return this.value!==before;
 }
 reset(now=Date.now()){this.value=0;this.resetAt=now;this.last=null;}
 snapshot(){return {wh:this.value,resetAt:this.resetAt};}
}
module.exports=Energy;
