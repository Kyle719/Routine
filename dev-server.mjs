import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch } from 'node:fs';

const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml'};
const clients=new Set();
let refreshTimer;
for(const folder of [root,path.join(root,'icons')])watch(folder,()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{for(const client of clients)client.write('data: update\n\n');},120);});
const server=http.createServer(async(req,res)=>{
  if(req.url==='/__live') {res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('data: connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
  const target=path.resolve(root,relative);
  if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);res.end('Forbidden');return;}
  try{await stat(target);const data=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);}
  catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
});
server.listen(4173,'0.0.0.0',()=>console.log('Routine dev server: http://localhost:4173'));
