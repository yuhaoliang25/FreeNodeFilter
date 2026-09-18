#!/usr/bin/env node
'use strict';
const fs=require('fs'),yaml=require('js-yaml'),crypto=require('crypto');
const raw=JSON.parse(fs.readFileSync('data/raw-sources.json','utf8'));
const proxies=[],seen=new Set(),usedNames=new Set(),sourcesById=new Map();
function valid(p){
  if(!p||typeof p!=='object'||!p.name||!p.server||!p.port||!p.type)return false;
  const port=Number(p.port); if(!Number.isInteger(port)||port<1||port>65535)return false;
  const t=String(p.type).toLowerCase();
  if(['vless','vmess'].includes(t)&&(!p.uuid||!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(String(p.uuid))))return false;
  if(t==='shadowsocks'&&!p.cipher)return false;
  if(t==='trojan'&&!p.password)return false;
  if(p['reality-opts']){
    const o=p['reality-opts'];
    if(!['vless','vmess','trojan'].includes(t)||typeof o!=='object'||!o['public-key'])return false;
    if(o['short-id']!==undefined&&(!/^[0-9a-fA-F]{2,16}$/.test(String(o['short-id']))||String(o['short-id']).length%2))return false;
  }
  return true;
}
function endpointIdentity(p){
  const t=String(p.type).toLowerCase();
  const auth=t==='shadowsocks'?[p.cipher||'',p.password||'']:t==='vmess'||t==='vless'?[p.uuid||'']:[p.password||''];
  const transport=p.network||'tcp';
  const tls=p.tls?'tls':'plain';
  const sni=p.sni||'';
  const reality=p['reality-opts']||{};
  const ws=p['ws-opts']||{}, grpc=p['grpc-opts']||{};
  const transportOpts={wsPath:ws.path||'',wsHost:ws.headers?.Host||'',grpcService:grpc['grpc-service-name']||''};
  return crypto.createHash('sha256').update(JSON.stringify([t,String(p.server).toLowerCase(),Number(p.port),auth,transport,transportOpts,tls,sni,p.flow||'',reality['public-key']||'',reality['short-id']||''])).digest('hex').slice(0,16);
}
function fingerprint(p){
  return endpointIdentity(p);
}
function add(p,source){
  // Mihomo requires REALITY to run over TLS. Some public sources omit
  // tls: true because their URI uses security=reality; normalize that here.
  if(p && p['reality-opts'])p.tls=true;
  if(!valid(p))return;
  const key=fingerprint(p);
  if(seen.has(key)){
    const meta=sourcesById.get(key);
    if(meta&&!meta.includes(source))meta.push(source);
    return;
  }
  seen.add(key);
  sourcesById.set(key,[source]);
  p['endpoint-id']=key;
  let name=String(p.name).trim()||String(p.server);
  if(usedNames.has(name))name=name+'-'+key;
  usedNames.add(name);
  proxies.push({...p,name,_source:source,_sources:[source],_id:key});
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
for(const p of proxies){
  const list=sourcesById.get(p._id)||[p._source];
  p._sources=[...new Set(list)];
}
const clean=proxies.map(({_source,_sources,_id,...p})=>{delete p['endpoint-id'];return p;});
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
 const sourceQuality=new Map(Object.entries(h.sourceStats||{}).map(([name,x])=>[name,x]));

 const histStats=new Map(Object.entries(hist).map(([id,x])=>{
   const observations=[];
   for(const batch of history){
     for(const r of batch.results||[])if(r.fingerprint===id&&Array.isArray(r.delays))observations.push(...r.delays);
   }
   const recent=observations.slice(-12), weights=recent.map((_,i)=>i+1), total=weights.reduce((a,b)=>a+b,0);
   const weightedRate=total?recent.reduce((s,v,i)=>s+(Number(v)>0?weights[i]:0),0)/total:0;
   return [id,{...x,recentTests:recent.length,weightedRate}];
 }));
 function currentRate(r){return Number(r.successRate||0)}
 function currentLatency(r){return r.avgLatency==null?Infinity:Number(r.avgLatency)}
 function historyMetric(id){return histStats.get(id)||{tests:0,successes:0,latencies:[],recentTests:0,weightedRate:0}}
 function stableEligible(r){
   const m=historyMetric(r.fingerprint);
   const currentOk=r.rounds>=2 && currentRate(r)>=0.8 && currentLatency(r)<=5000;
   if(!currentOk)return false;
   // Cold start: before enough history exists, require two successful
   // observations in this run. Once history accumulates, use reputation.
   if(m.tests===0)return r.successes>=2;
   return m.recentTests>=6 && m.weightedRate>=0.8;
 }
 function bestEligible(r){
   const m=historyMetric(r.fingerprint);
   const repNode=reputation.nodes?.[r.fingerprint];
   const currentOk=r.rounds>=3 && currentRate(r)>=0.9 &&
     currentLatency(r)<=2500 && Number(r.p95Latency||Infinity)<=5000;
   if(!currentOk || repNode?.status==='quarantine' || repNode?.status==='degraded')return false;
   // Cold start: three successful observations are enough for a conservative
   // first-run best pool; historical reputation takes over afterwards.
   if(m.tests===0)return r.successes>=3;
   return m.recentTests>=9 && m.weightedRate>=0.9;
 }
 const google=new Set(h.results.filter(r=>currentRate(r)>0).map(r=>r.name));
 const stable=new Set(h.results.filter(stableEligible).map(r=>r.name));
 let reputation={nodes:{}};
 try{reputation=JSON.parse(fs.readFileSync('data/reputation.json','utf8'))}catch{}
 const best=new Set(h.results.filter(bestEligible).map(r=>r.name));
 function qualityScore(r,m){
  const success=Math.max(0,Math.min(1,r.successRate||0));
  const long=Math.max(0,Math.min(1,m?.weightedRate??m?.longRate??0));
  const latency=m?.avg?Math.max(0,1-Math.min(1,m.avg/5000)):0;
  const p95=m?.p95?Math.max(0,1-Math.min(1,m.p95/10000)):0;
  const sourceList=Array.isArray(r.sources)?r.sources:[r.source].filter(Boolean);
  const sourceRates=sourceList.map(s=>Number(sourceQuality.get(s)?.nodeSuccessRate));
  const validSourceRates=sourceRates.filter(Number.isFinite);
  const sourceQualityScore=validSourceRates.length?validSourceRates.reduce((a,b)=>a+b,0)/validSourceRates.length:0;
  // Provenance is only a small confidence signal: multiple public sources
  // may copy one another, so it must never dominate actual health tests.
  const provenance=Math.min(1,Math.max(0,(sourceList.length-1)/3));
  return Math.round(100*(0.35*success+0.30*long+0.15*latency+0.10*p95+0.07*sourceQualityScore+0.03*provenance));
 }
 const pick=set=>clean.filter(p=>set.has(p.name));
 fs.writeFileSync('subscriptions/google.yaml',yaml.dump({proxies:pick(google)},{lineWidth:-1,noRefs:true}));
 fs.writeFileSync('subscriptions/stable.yaml',yaml.dump({proxies:pick(stable)},{lineWidth:-1,noRefs:true}));
 fs.writeFileSync('subscriptions/best.yaml',yaml.dump({proxies:pick(best)},{lineWidth:-1,noRefs:true}));
 const scored=h.results.map(r=>{const m=metrics.get(r.fingerprint)||{};return {...r,qualityScore:qualityScore(r,m)}}).sort((a,b)=>b.qualityScore-a.qualityScore);
 fs.writeFileSync('data/scores.json',JSON.stringify({generatedAt:new Date().toISOString(),results:scored,sourceQuality:Object.fromEntries(sourceQuality)},null,2));
 const sourceHistory=[];
 try{sourceHistory.push(...JSON.parse(fs.readFileSync('data/source-history.json','utf8')))}catch{}
 sourceHistory.push({generatedAt:new Date().toISOString(),sources:Object.fromEntries(sourceQuality)});
 fs.writeFileSync('data/source-history.json',JSON.stringify(sourceHistory.slice(-30),null,2));
 console.log('google/stable/best:',google.size,stable.size,best.size);
}catch(e){console.log('health data unavailable; only all.yaml generated:',e.message)}
fs.writeFileSync('data/candidates.json',JSON.stringify(proxies,null,2));
console.log('candidate nodes:',clean.length);
