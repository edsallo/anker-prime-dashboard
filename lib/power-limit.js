'use strict';
const PORTS=['C1','C2','C3','C4','A'];
function validate(port,value){
 const i=PORTS.indexOf(port),min=port==='C1'?5:15,max=port==='C1'?140:100;
 if(i<0||!Number.isInteger(value)||(port==='A'?![0,15,24].includes(value):value<min||value>max||value%5!==0))throw Object.assign(new Error('Invalid power limit'),{code:'LIMIT_RANGE'});
}
function prepare(settings,args,change){
 if(!Array.isArray(settings?.customProfile)||settings.customProfile.length!==7||!Array.isArray(settings.customProtocols)||settings.customProtocols.length!==12)throw Object.assign(new Error('Custom profile unavailable'),{code:'PROFILE_MISSING'});
 const profile=[...settings.customProfile],protocols=[...settings.customProtocols];
 if(change){
  validate(args.port,args.value);const selected=PORTS.indexOf(args.port);profile[selected+2]=args.value;
  let excess=profile.slice(2).reduce((sum,value)=>sum+value,0)-250;
  // Reduce the largest other USB-C allocation first, to the next lower five-watt value.
  // Preserve USB-A's discrete budget and never raise existing low/disabled budgets.
  while(excess>0){
   const candidates=[0,1,2,3].filter(i=>i!==selected&&profile[i+2]>15);
   candidates.sort((a,b)=>profile[b+2]-profile[a+2]||a-b);
   if(!candidates.length)throw Object.assign(new Error('Insufficient power budget'),{code:'LIMIT_BUDGET',available:args.value-excess});
   const index=candidates[0]+2,lower=Math.max(15,Math.floor((profile[index]-1)/5)*5);
   excess-=profile[index]-lower;profile[index]=lower;
  }
 }

 return {profile,protocols};
}
module.exports={validate,prepare};
