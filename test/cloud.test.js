'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const Cloud=require('../lib/cloud');
test('auth failure is retried once, with fresh credentials and no arbitrary host',async()=>{
 const previous=global.fetch;let calls=[];
 const c=new Cloud({email:'test@example.invalid',password:'test-only',region:'eu',country:'DE'},{user_id:'u',auth_token:'old',token_expires_at:Math.floor(Date.now()/1000)+3600});
 global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('passport/login')?{code:0,data:{user_id:'u',auth_token:'fresh',token_expires_at:Math.floor(Date.now()/1000)+3600}}:{code:401}};};
 try{await assert.rejects(()=>c.devices(),/Anker API 401/);assert.equal(calls.length,3);assert.equal(calls[2].options.headers['x-auth-token'],'fresh');assert.ok(calls.every(x=>x.url.startsWith('https://ankerpower-api-eu.anker.com/')));assert.ok(!calls[1].options.body.includes('test-only'));}finally{global.fetch=previous;}
});
test('server error content is not exposed to pairing UI',async()=>{
 const previous=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({code:26108,msg:'private server information'})});
 try{await assert.rejects(()=>new Cloud({email:'test@example.invalid',password:'test-only',region:'eu',country:'DE'}).login(),error=>error.message==='Anker API 26108');}finally{global.fetch=previous;}
});
