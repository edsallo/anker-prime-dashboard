'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
class Vault{
 constructor(dir){this.dir=dir;this.queue=Promise.resolve();}
 async init(){await fs.mkdir(this.dir,{recursive:true,mode:0o700});try{this.key=await fs.readFile(path.join(this.dir,'vault.key'));}catch(e){if(e.code!=='ENOENT')throw e;this.key=crypto.randomBytes(32);await fs.writeFile(path.join(this.dir,'vault.key'),this.key,{mode:0o600,flag:'wx'});}if(this.key.length!==32)throw Error('Invalid storage key');}
 async read(){try{const data=JSON.parse(await fs.readFile(path.join(this.dir,'account.enc'),'utf8')),iv=Buffer.from(data.iv,'base64'),dec=crypto.createDecipheriv('aes-256-gcm',this.key,iv);dec.setAuthTag(Buffer.from(data.tag,'base64'));return JSON.parse(Buffer.concat([dec.update(Buffer.from(data.data,'base64')),dec.final()]));}catch(e){if(e.code==='ENOENT')return null;throw Error('Unable to read encrypted account storage');}}
 write(value){this.queue=this.queue.catch(()=>{}).then(async()=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv),data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);await fs.writeFile(path.join(this.dir,'account.tmp'),JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});await fs.rename(path.join(this.dir,'account.tmp'),path.join(this.dir,'account.enc'));});return this.queue;}
}
module.exports=Vault;
