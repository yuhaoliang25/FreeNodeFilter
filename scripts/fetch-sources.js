#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),yaml=require('js-yaml'),crypto=require('crypto');

const seedSources=yaml.load(fs.readFileSync(path.resolve('sources/sources.yaml'),'utf8')).sources||[];
const dynamicState=(()=>{try{return JSON.parse(fs.readFileSync('data/sources.json','utf8'))}catch{return {sources:[]}}})();
const seedUrls=new Set(seedSources.map(s=>s.url));

function sourceId(url){
  return 'dynamic-'+crypto.createHash('sha256').update(url).digest('hex').slice(0,12);
}

const dynamicSources=(dynamicState.sources||[])
  .filter(s=>s.url&&!seedUrls.has(s.url))
  .filter(s=>s.status!=='dead')
  .filter(s=>!s.nextProbeAt||Date.parse(s.nextProbeAt)<=Date.now())
  .slice(0,25)
  .map(s=>({
    name:s.name||sourceId(s.url),
    url:s.url,
    discoveredFrom:s.discoveredFrom||null
  }));

const sources=[...seedSources,...dynamicSources];

function decodeBase64(text){
  const s=text.trim().replace(/\s+/g,'');
  if(!/^[A-Za-z0-9+/=_-]+$/.test(s)||s.length<16)return null;
  try{return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')}catch{return null}
}
function looksLikeYaml(t){return /(^|\n)\s*proxies\s*:/m.test(t)}
function looksLikeUris(t){return /(?:vless|vmess|trojan|ss|ssr):\/\//i.test(t)}

async function main(){
 fs.mkdirSync('data',{recursive:true});
 const out=[];
 const results=await Promise.allSettled(sources.map(async s=>{
  const r=await fetch(s.url,{redirect:'follow',headers:{'user-agent':'FreeNodeFilter/0.1'}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const text=await r.text();
  const decoded=decodeBase64(text);
  let payload=text,format='yaml';
  if(!looksLikeYaml(payload)&&decoded&&(looksLikeYaml(decoded)||looksLikeUris(decoded))){payload=decoded;format='base64'}
  else if(!looksLikeYaml(payload)&&looksLikeUris(payload))format='uri';
  else if(!looksLikeYaml(payload))throw new Error('unrecognized source format');
  return {
    name:s.name,url:s.url,format,text:payload,fetchedAt:new Date().toISOString(),
    discoveredFrom:s.discoveredFrom||null
  };
 }));
 const now=new Date().toISOString();
 const registry=dynamicState;
 const registryByUrl=new Map((registry.sources||[]).map(s=>[s.url,s]));
 results.forEach((r,i)=>{
  const s=sources[i];
  const tracked=registryByUrl.get(s.url);
  if(r.status==='fulfilled'){
    out.push(r.value);
    if(tracked){
      tracked.fetchFailures=0;
      tracked.lastSeen=now;
      if(tracked.status==='dead')tracked.status='normal';
      if(tracked.status==='candidate')tracked.status='normal';
      tracked.nextProbeAt=new Date(Date.now()+(
        tracked.status==='trusted'?24:
        tracked.status==='weak'?72:12
      )*3600000).toISOString();
    }
    console.log('✓',s.name,r.value.format,r.value.text.length,'bytes');
  } else {
    const message=r.reason?.message||String(r.reason);
    if(tracked){
      tracked.fetchFailures=Number(tracked.fetchFailures||0)+1;
      tracked.lastFailureAt=now;
      if(tracked.fetchFailures>=6)tracked.status='dead';
      else if(tracked.status!=='trusted')tracked.status='weak';
      tracked.nextProbeAt=new Date(Date.now()+(
        tracked.status==='dead'?168:tracked.status==='weak'?72:12
      )*3600000).toISOString();
    }
    console.error('✗',s.name,message,'failures',tracked?.fetchFailures??'seed');
  }
 });
 registry.updatedAt=now;
 registry.version=1;
 fs.writeFileSync('data/sources.json',JSON.stringify(registry,null,2));
 fs.writeFileSync('data/raw-sources.json',JSON.stringify(out));
 if(!out.length)throw new Error('没有成功获取任何节点源');
}
main().catch(e=>{console.error(e);process.exit(1)});
