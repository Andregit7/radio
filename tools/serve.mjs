import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),root=path.resolve(fileURLToPath(new URL(args.includes('--studio')?'../studio/':'../dist/',import.meta.url))),port=Number(args.find(a=>/^\d+$/.test(a)) || (args.includes('--studio')?4174:4173));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.zip':'application/zip'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative=requested==='/'?'index.html':requested.replace(/^\/+/,''),target=path.resolve(root,relative);
    if(target!==root && !target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const info=await stat(target);if(!info.isFile()){res.writeHead(404);res.end();return;}
    const bytes=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/`));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
