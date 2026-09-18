#!/usr/bin/env node
'use strict';
const fs=require('fs');
const API=process.env.MIHOMO_API||'http://127.0.0.1:9090';
const GROUP=process.env.MIHOMO_GROUP||'FREE_NODE_POOL';
const PROXY_PORT=Number(process.env.MIHOMO_MIXED_PORT||7890);
const TARGET=process.env.GOOGLE_TEST_URL||'https://www.google.com/generate_204';
const TIMEOUT=Number(process.env.DIAG_TIMEOUT||8000);
async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const t=await r.text();if(!r.ok)throw new Error('API '+r.status+' '+t.slice(0,200));return t?JSON.parse(t):{}}
function classify(stderr,code){
 const s=String(stderr||'').toLowerCase();
 if(s.includes('could not resolve host')||s.includes('name or service not known'))return 'dns';
 if(s.includes('ssl')||s.includes('tls')||s.includes('certificate'))return 'tls';
 if(s.includes('timed out')||code===28)return 'timeout';
 if(s.includes('connection refused'))return 'connection_refused';
 if(s.includes('proxy'))return 'proxy';
 return 'http_or_transport';
}
async function main(){
 const h=JSON.parse(fs.readFileSync('data/health.json','utf8'));
 const failed=h.results.filter(x=>x.successRate<1).slice(0,Number(process.env.DIAG_LIMIT||100));
 const report={generatedAt:new Date().toISOString(),target:TARGET,results:{}};
 for(const n of failed){
  try{
   await api('/proxies/'+encodeURIComponent(GROUP),{method:'PUT',body:JSON.stringify({name:n.name})});
   const p=await new Promise(resolve=>{
    const {spawn}=require('child_process');
    const cp=spawn('curl',['-sS','-o','/dev/null','-w','%{http_code} %{time_total}','--connect-timeout',String(Math.ceil(TIMEOUT/1000)),'--max-time',String(Math.ceil(TIMEOUT/1000)), '--proxy','http://127.0.0.1:'+PROXY_PORT,TARGET]);
    let err='';cp.stderr.on('data',d=>err+=d);cp.on('close',code=>resolve({code,stderr:err}));
   });
   const ok=p.code===0;
   report.results[n.fingerprint||n.name]={name:n.name,diagnostic:ok?'http_success':classify(p.stderr,p.code),exitCode:p.code,stderr:p.stderr.slice(0,300)};
  }catch(e){report.results[n.fingerprint||n.name]={name:n.name,diagnostic:'api_error',error:e.message}}
 }
 fs.writeFileSync('data/diagnostics.json',JSON.stringify(report,null,2));
 console.log('diagnosed:',Object.keys(report.results).length);
}
main().catch(e=>{console.error(e);process.exit(1)});
