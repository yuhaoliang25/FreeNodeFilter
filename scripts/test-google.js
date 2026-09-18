#!/usr/bin/env node
'use strict';
const fs=require('fs');
const API=process.env.MIHOMO_API||'http://127.0.0.1:9090';
const GROUP=process.env.MIHOMO_GROUP||'FREE_NODE_POOL';
const TARGET=process.env.GOOGLE_TEST_URL||'https://www.google.com/generate_204';
const ROUNDS=Number(process.env.TEST_ROUNDS||3), TIMEOUT=Number(process.env.TEST_TIMEOUT||8000), EXPECTED=process.env.TEST_EXPECTED||'204';
async function json(url){const r=await fetch(url);const t=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+' '+t.slice(0,300));return JSON.parse(t)}
async function main(){
 const all={};
 for(let round=1;round<=ROUNDS;round++){
  const q=new URLSearchParams({url:TARGET,timeout:String(TIMEOUT),expected:EXPECTED});
  const result=await json(API+'/group/'+encodeURIComponent(GROUP)+'/delay?'+q);
  for(const [name,delay] of Object.entries(result)){const d=Number(delay);(all[name]??=[]).push(Number.isFinite(d)&&d>0?d:0)}
  console.log('round',round,'tested',Object.keys(result).length);
  if(round<ROUNDS)await new Promise(r=>setTimeout(r,1500));
 }
 const rows=Object.entries(all).map(([name,delays])=>{
  const ok=delays.filter(x=>x>0),sorted=[...ok].sort((a,b)=>a-b),pct=p=>ok.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]:null;
  return {name,rounds:delays.length,successes:ok.length,successRate:ok.length/delays.length,avgLatency:ok.length?Math.round(ok.reduce((a,b)=>a+b,0)/ok.length):null,p50Latency:pct(.5),p95Latency:pct(.95),maxLatency:ok.length?Math.max(...ok):null,delays};
 }).sort((a,b)=>(b.successRate-a.successRate)||(a.avgLatency??1e9)-(b.avgLatency??1e9));
 const report={generatedAt:new Date().toISOString(),target:TARGET,rounds:ROUNDS,timeout:TIMEOUT,expectedStatus:EXPECTED,results:rows};
 fs.mkdirSync('data',{recursive:true});
 fs.writeFileSync('data/health.json',JSON.stringify(report,null,2));
 let history=[]; try{history=JSON.parse(fs.readFileSync('data/history.json','utf8'))}catch{}
 history.push(report); history=history.slice(-30);
 fs.writeFileSync('data/history.json',JSON.stringify(history,null,2));
 console.log('tested:',rows.length,'stable:',rows.filter(x=>x.successRate>=.8).length,'best:',rows.filter(x=>x.successRate>=.9&&x.p95Latency<=5000&&x.avgLatency<=2500).length);
}
main().catch(e=>{console.error(e);process.exit(1)});
