#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),yaml=require('js-yaml');
const sources=yaml.load(fs.readFileSync(path.resolve('sources/sources.yaml'),'utf8')).sources||[];
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
  return {name:s.name,url:s.url,format,text:payload,fetchedAt:new Date().toISOString()};
 }));
 results.forEach((r,i)=>{
  const s=sources[i];
  if(r.status==='fulfilled'){out.push(r.value);console.log('✓',s.name,r.value.format,r.value.text.length,'bytes')}
  else console.error('✗',s.name,r.reason?.message||r.reason)
 });
 fs.writeFileSync('data/raw-sources.json',JSON.stringify(out));
 if(!out.length)throw new Error('没有成功获取任何节点源');
}
main().catch(e=>{console.error(e);process.exit(1)});
