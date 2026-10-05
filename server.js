'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function createServer(config,service,history){
 const origins=new Set(config.origins),hosts=new Set([...origins].map(o=>new URL(o).host)),attempts=new Map();
 const files={'/':'index.html','/history':'history.html','/setup':'setup.html','/app.js':'app.js','/style.css':'style.css','/history.js':'history.js','/history.css':'history.css','/setup.js':'setup.js','/setup.css':'setup.css'};
 return http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(!hosts.has(req.headers.host))return send(403,{error:'Unknown host'});
  if(req.headers.origin&&!origins.has(req.headers.origin))return send(403,{error:'Origin denied'});
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&files[url.pathname]){if(['/', '/history'].includes(url.pathname)&&!service.status().configured){res.writeHead(303,{Location:'/setup'});return res.end();}const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'public',file)));}
  try{
   if(req.method==='GET'){
    if(url.pathname==='/api/status')return send(200,service.status());
    if(url.pathname==='/api/overview')return send(200,service.overview());
    if(url.pathname==='/api/history/devices')return send(200,{devices:await history.devices()});
    if(url.pathname==='/api/history')return send(200,await history.query(url.searchParams.get('device'),url.searchParams.get('port'),Number(url.searchParams.get('hours'))));
   }
   if(req.method!=='POST'||!['/api/login','/api/control'].includes(url.pathname))return send(404,{error:'Not found'});
   if(!origins.has(req.headers.origin)||req.headers['x-anker-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))return send(403,{error:'Request denied'});
   let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>8192)return send(413,{error:'Request too large'});}let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid JSON'});}
   if(url.pathname==='/api/login'){
    const ip=req.socket.remoteAddress,now=Date.now();for(const [k,v] of attempts)if(now-v.start>=60000)attempts.delete(k);const item=attempts.get(ip)||{start:now,n:0};item.n++;attempts.set(ip,item);if(item.n>5)return send(429,{error:'Слишком много попыток. Подождите минуту.'});return send(200,await service.login(body));
   }
   if(!service.status().configured)return send(409,{error:'Сначала подключите аккаунт Anker.'});
   return send(200,await service.control(body));
  }catch(e){send(400,{error:typeof e.message==='string'?e.message:'Не удалось выполнить запрос.'});}
 });
}
async function main(){const config={origins:(process.env.SITE_ORIGINS||'http://localhost').split(',').map(s=>s.trim())},dir=process.env.DATA_DIR||'/data';const service=new (require('./service'))(dir);await service.init();const history=new (require('./history').History)(path.join(dir,'history')).startProvider(()=>service.overview());const server=createServer(config,service,history);server.listen(Number(process.env.PORT)||8080,'0.0.0.0',()=>console.log('Anker autonomous dashboard ready'));let stopping=false;async function stop(){if(stopping)return;stopping=true;clearInterval(history.timer);server.close();await service.close();server.closeAllConnections();process.exit(0);}process.on('SIGTERM',stop);process.on('SIGINT',stop);}
if(require.main===module)main().catch(()=>{console.error('Unable to initialize Anker service');process.exit(1);});
module.exports={createServer};
