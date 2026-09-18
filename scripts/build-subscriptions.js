#!/usr/bin/env node
'use strict';
const fs=require('fs'),yaml=require('js-yaml'),crypto=require('crypto');
const raw=JSON.parse(fs.readFileSync('data/raw-sources.json','utf8'));
const proxies=[],seen=new Set(),usedNames=new Set();
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
  if(!valid(p))return;
  const key=fingerprint(p); if(seen.has(key))return; seen.add(key);
  let name=String(p.name).trim()||String(p.server);
  if(usedNames.has(name))name=name+'-'+key;
  usedNames.add(name);
  proxies.push({...p,name,_source:source,_id:key});
}
for(const s of raw){
  let d; try{d=yaml.load(s.text)}catch{}
  if(Array.isArray(d?.proxies))d.proxies.forEach(p=>add(p,s.name));
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
console.log('candidate nodes:',clean.length);
