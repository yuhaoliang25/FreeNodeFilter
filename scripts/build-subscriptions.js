#!/usr/bin/env node
'use strict';
const fs=require('fs'),yaml=require('js-yaml'),crypto=require('crypto');
const raw=JSON.parse(fs.readFileSync('data/raw-sources.json','utf8'));
const proxies=[],seen=new Set(),usedNames=new Set();
const MAX_CANDIDATES=Number(process.env.MAX_CANDIDATES||1500);
function valid(p){
  if(!p||typeof p!=='object'||!p.name||!p.server||!p.port||!p.type)return false;
  const port=Number(p.port); if(!Number.isInteger(port)||port<1||port>65535)return false;
  const t=String(p.type).toLowerCase();
  if(['vless','vmess'].includes(t)&&p.uuid&&!/^[0-9a-fA-F-]{32,36}$/.test(String(p.uuid)))return false;
  if(t==='shadowsocks'&&!p.cipher)return false;
  if(t==='trojan'&&!p.password)return false;
  if(p['reality-opts']){
    const o=p['reality-opts'];
    if(!['vless','vmess','trojan'].includes(t)||typeof o!=='object'||!o['public-key'])return false;
    if(o['short-id']!==undefined&&(!/^[0-9a-fA-F]{2,16}$/.test(String(o['short-id']))||String(o['short-id']).length%2))return false;
  }
  return true;
}
function fingerprint(p){
  return crypto.createHash('sha256').update(JSON.stringify([p.type,p.server,p.port,p.uuid,p.password,p.cipher,p.network,p.tls,p.sni,p['reality-opts']])).digest('hex').slice(0,8);
}
function add(p,source){
  if(proxies.length>=MAX_CANDIDATES)return;
  if(!valid(p))return;
  const key=fingerprint(p); if(seen.has(key))return; seen.add(key);
  let name=String(p.name).trim()||String(p.server);
  if(usedNames.has(name))name=name+'-'+key;
  usedNames.add(name);
  proxies.push({...p,name,_source:source,_id:key});
}
function decodeB64Json(s){try{return JSON.parse(Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'))}catch{return null}}
function vmessProxy(u,source){
 const d=decodeB64Json(u.slice(8)); if(!d||!d.add||!d.port||!d.id)return;
 const p={type:'vmess',name:d.ps||d.add,server:d.add,port:Number(d.port),uuid:d.id,alterId:Number(d.aid||0),cipher:d.scy||'auto',tls:d.tls==='tls'};
 if(d.sni)p.sni=d.sni;
 const net=d.net||'tcp';
 if(net==='ws'){p.network='ws';p['ws-opts']={path:d.path||'/'};if(d.host)p['ws-opts'].headers={Host:d.host}}
 else if(net==='grpc'){p.network='grpc';p['grpc-opts']={['grpc-service-name']:d.path||d.serviceName||''}}
 else p.network=net;
 add(p,source);
}
function uriProxy(u,source){
 try{
  if(/^vmess:\/\//i.test(u)){vmessProxy(u,source);return}
  const x=new URL(u), t=x.protocol.slice(0,-1).toLowerCase();
  if(t==='vless'||t==='trojan'){
   const p={type:t,name:decodeURIComponent(x.hash.slice(1))||x.hostname,server:x.hostname,port:Number(x.port),tls:x.searchParams.get('security')==='tls'};
   if(t==='vless')p.uuid=decodeURIComponent(x.username); else p.password=decodeURIComponent(x.username);
   const network=x.searchParams.get('type')||x.searchParams.get('network')||'tcp'; p.network=network;
   const sni=x.searchParams.get('sni')||x.searchParams.get('host'); if(sni)p.sni=sni;
   if(network==='ws'){p['ws-opts']={path:x.searchParams.get('path')||'/'};if(x.searchParams.get('host'))p['ws-opts'].headers={Host:x.searchParams.get('host')}}
   if(network==='grpc')p['grpc-opts']={'grpc-service-name':x.searchParams.get('serviceName')||x.searchParams.get('path')||''};
   if(x.searchParams.get('flow'))p.flow=x.searchParams.get('flow');
   if(x.searchParams.get('security')==='reality')p['reality-opts']={'public-key':x.searchParams.get('pbk')||'', 'short-id':x.searchParams.get('sid')||''};
   add(p,source);
  } else if(t==='ss'){
   const decoded=Buffer.from(x.username,'base64').toString('utf8'); const i=decoded.indexOf(':');
   if(i>0)add({type:'ss',name:decodeURIComponent(x.hash.slice(1))||x.hostname,server:x.hostname,port:Number(x.port),cipher:decoded.slice(0,i),password:decoded.slice(i+1)},source);
  }
 }catch{}
}
for(const s of raw){
 let d; try{d=yaml.load(s.text)}catch{}
 if(Array.isArray(d?.proxies))d.proxies.forEach(p=>add(p,s.name));
 else if(s.format==='uri'||s.format==='base64'||/^(vless|vmess|trojan|ss):\/\//im.test(s.text)){
   for(const line of s.text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))uriProxy(line,s.name);
 }
}
const clean=proxies.map(({_source,_id,...p})=>p);
fs.mkdirSync('subscriptions',{recursive:true});
fs.writeFileSync('subscriptions/all.yaml',yaml.dump({proxies:clean},{lineWidth:-1,noRefs:true}));
try{
 const h=JSON.parse(fs.readFileSync('data/health.json','utf8'));
 const history=JSON.parse(fs.readFileSync('data/history.json','utf8'));
 const hist={};
 for(const batch of history) for(const r of batch.results) if(r.fingerprint){
   const x=hist[r.fingerprint]??={tests:0,successes:0,latencies:[]};
   x.tests+=r.rounds; x.successes+=r.successes; x.latencies.push(...r.delays.filter(v=>v>0));
 }
 const metrics=new Map(Object.entries(hist).map(([id,x])=>{
   const s=[...x.latencies].sort((a,b)=>a-b), p=q=>s.length?s[Math.min(s.length-1,Math.ceil(s.length*q)-1)]:null;
   return [id,{longRate:x.tests?x.successes/x.tests:0,avg:s.length?Math.round(s.reduce((a,b)=>a+b,0)/s.length):null,p95:p(.95),tests:x.tests}];
 }));
 const idsByName=new Map(h.results.map(x=>[x.name,x.fingerprint]));
 const google=new Set(h.results.filter(x=>x.successRate>0).map(x=>x.name));
 const stable=new Set(h.results.filter(x=>{
   const m=metrics.get(x.fingerprint)||{longRate:0,avg:null,p95:null,tests:0};
   return m.tests>=6 && m.longRate>=0.8 && x.successRate>=0.8 && x.p95Latency<=8000;
 }).map(x=>x.name));
 const reputation=JSON.parse(fs.readFileSync('data/reputation.json','utf8'));
 const quarantined=new Set(Object.entries(reputation.nodes).filter(([,x])=>x.status==='quarantine').map(([id])=>id));
 const best=new Set(h.results.filter(x=>{
   const m=metrics.get(x.fingerprint)||{longRate:0,avg:null,p95:null,tests:0};
   return !quarantined.has(x.fingerprint) && m.tests>=9 && m.longRate>=0.9 && x.successRate>=0.9 && x.p95Latency<=5000 && x.avgLatency<=2500;
 }).map(x=>x.name));
 const pick=set=>clean.filter(p=>set.has(p.name));
 fs.writeFileSync('subscriptions/google.yaml',yaml.dump({proxies:pick(google)},{lineWidth:-1,noRefs:true}));
 fs.writeFileSync('subscriptions/stable.yaml',yaml.dump({proxies:pick(stable)},{lineWidth:-1,noRefs:true}));
 fs.writeFileSync('subscriptions/best.yaml',yaml.dump({proxies:pick(best)},{lineWidth:-1,noRefs:true}));
 console.log('google/stable/best:',google.size,stable.size,best.size);
}catch(e){console.log('health data unavailable; only all.yaml generated:',e.message)}
fs.writeFileSync('data/candidates.json',JSON.stringify(proxies,null,2));
console.log('candidate nodes:',clean.length,'limit:',MAX_CANDIDATES);
