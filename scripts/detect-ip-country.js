#!/usr/bin/env node
'use strict';
const fs=require('fs'),dns=require('dns').promises,https=require('https');
const INPUT='data/candidates.json',OUTPUT='data/ip-geolocation.json';
const CACHE=(()=>{try{return JSON.parse(fs.readFileSync(OUTPUT,'utf8'))}catch{return {}}})();
const MAX_NODES=Number(process.env.GEO_MAX_NODES||1000),CONCURRENCY=Number(process.env.GEO_CONCURRENCY||6);
function httpJson(url,timeout=7000){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'user-agent':'NodeProbe/1.0'},timeout},res=>{let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error('HTTP '+res.statusCode));try{resolve(JSON.parse(body))}catch{reject(new Error('invalid JSON'))}})});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject)})}
async function resolveIp(host){if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return host;try{return (await dns.lookup(host,{family:4})).address}catch{return null}}
async function geo(ip){const urls=['https://ipwho.is/'+encodeURIComponent(ip),'https://ipapi.co/'+encodeURIComponent(ip)+'/json/'];for(const url of urls){try{const d=await httpJson(url),code=String(d.country_code||d.countryCode||'').toUpperCase();if(code.length===2)return {country_code:code,country:d.country||d.country_name||null,city:d.city||null,region:d.region||d.region_name||null,latitude:Number.isFinite(Number(d.latitude))?Number(d.latitude):null,longitude:Number.isFinite(Number(d.longitude))?Number(d.longitude):null,provider:url.startsWith('https://ipwho.is')?'ipwho.is':'ipapi.co'}}catch{}}return null}
async function main(){const nodes=JSON.parse(fs.readFileSync(INPUT,'utf8')).slice(0,MAX_NODES),byHost=new Map();for(const p of nodes){const h=String(p.server||'').trim();if(h){if(!byHost.has(h))byHost.set(h,[]);byHost.get(h).push(p.name)}}
const result={};for(const x of Object.values(CACHE))if(x&&x.host)result[x.host]=x;const pending=[...byHost.keys()].filter(h=>!result[h]?.ip||!result[h]?.country_code);let cursor=0;
async function worker(){while(true){const i=cursor++;if(i>=pending.length)return;const host=pending[i],entry={host,ip:null,node_count:byHost.get(host)?.length||0,checked_at:new Date().toISOString()};entry.ip=await resolveIp(host);if(!entry.ip){entry.error='dns_failed';result[host]=entry;continue}const g=await geo(entry.ip);if(g)Object.assign(entry,g);else entry.error='geo_failed';result[host]=entry}}
await Promise.all(Array.from({length:Math.max(1,CONCURRENCY)},worker));fs.writeFileSync(OUTPUT,JSON.stringify(result,null,2));console.log('IP geolocation:',Object.keys(result).length,'hosts;',pending.length,'new lookups')}
main().catch(e=>{console.error(e);process.exit(1)})
