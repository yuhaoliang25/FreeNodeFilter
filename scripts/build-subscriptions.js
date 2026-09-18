#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),yaml=require('js-yaml');
const raw=JSON.parse(fs.readFileSync('data/raw-sources.json','utf8'));
const proxies=[]; const seen=new Set();
function valid(p){
  if(!p||typeof p!=='object'||!p.name||!p.server||!p.port||!p.type) return false;
  const port=Number(p.port); if(!Number.isInteger(port)||port<1||port>65535)return false;
  if(p['reality-opts']){
    const o=p['reality-opts'];
    if(!['vless','vmess','trojan'].includes(String(p.type).toLowerCase()))return false;
    if(typeof o!=='object'||!o['public-key']||!o['short-id']||!/^[0-9a-fA-F]{2,16}$/.test(String(o['short-id']))||String(o['short-id']).length%2)return false;
  }
  return true;
}
function add(p,source){
  if(!valid(p))return;
  const key=JSON.stringify([p.type,p.server,p.port,p.uuid,p.password,p.cipher,p['network'],p.tls,p.sni,p['reality-opts']]);
  if(seen.has(key))return;
  seen.add(key); proxies.push({...p,_source:source});
}
for(const s of raw){
  let d;
  try{ d=yaml.load(s.text); }catch{}
  if(Array.isArray(d?.proxies)) d.proxies.forEach(p=>add(p,s.name));
}
const clean=proxies.map(({_source,...p})=>p);
fs.mkdirSync('subscriptions',{recursive:true});
fs.writeFileSync('subscriptions/all.yaml',yaml.dump({proxies:clean},{lineWidth:-1,noRefs:true}));
try{
  const h=JSON.parse(fs.readFileSync('data/health.json','utf8'));
  const stable=new Set(h.results.filter(x=>x.successRate>=0.8).map(x=>x.name));
  const google=new Set(h.results.filter(x=>x.successRate>0).map(x=>x.name));
  fs.writeFileSync('subscriptions/google.yaml',yaml.dump({proxies:clean.filter(p=>google.has(p.name))},{lineWidth:-1,noRefs:true}));
  fs.writeFileSync('subscriptions/stable.yaml',yaml.dump({proxies:clean.filter(p=>stable.has(p.name))},{lineWidth:-1,noRefs:true}));
}catch(e){ console.log('health data unavailable; only all.yaml generated'); }
fs.writeFileSync('data/candidates.json',JSON.stringify(proxies,null,2));
console.log('candidate nodes:',clean.length);
