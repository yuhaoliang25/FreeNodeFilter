#!/usr/bin/env node
'use strict';
const fs=require('fs'), path=require('path');
const API=process.env.MIHOMO_API||'http://127.0.0.1:9090';
const GROUP=process.env.MIHOMO_GROUP||'FREE_NODE_POOL';
const TARGET=process.env.GOOGLE_TEST_URL||'https://www.google.com/generate_204';
const ROUNDS=Number(process.env.TEST_ROUNDS||3);
const TIMEOUT=Number(process.env.TEST_TIMEOUT||8000);
const EXPECTED=process.env.TEST_EXPECTED||'204';
async function json(url){const r=await fetch(url);const t=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+' '+t.slice(0,300));return JSON.parse(t);}
async function main(){
  const all={};
  for(let round=1;round<=ROUNDS;round++){
    const q=new URLSearchParams({url:TARGET,timeout:String(TIMEOUT),expected:EXPECTED});
    const result=await json(API+'/group/'+encodeURIComponent(GROUP)+'/delay?'+q);
    for(const [name,delay] of Object.entries(result)){
      const d=Number(delay);
      (all[name]??=[]).push(Number.isFinite(d)&&d>0?d:0);
    }
    console.log('round',round,'tested',Object.keys(result).length);
    if(round<ROUNDS) await new Promise(r=>setTimeout(r,1500));
  }
  const rows=Object.entries(all).map(([name,delays])=>{
    const ok=delays.filter(x=>x>0), sorted=[...ok].sort((a,b)=>a-b);
    const avg=ok.length?Math.round(ok.reduce((a,b)=>a+b,0)/ok.length):null;
    const p95=ok.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]:null;
    return {name,rounds:delays.length,successes:ok.length,successRate:ok.length/delays.length,avgLatency:avg,p95Latency:p95,delays};
  }).sort((a,b)=>(b.successRate-a.successRate)||(a.avgLatency??1e9)-(b.avgLatency??1e9));
  fs.mkdirSync('data',{recursive:true});
  fs.writeFileSync('data/health.json',JSON.stringify({generatedAt:new Date().toISOString(),target:TARGET,rounds:ROUNDS,timeout:TIMEOUT,expectedStatus:EXPECTED,results:rows},null,2));
  const stable=rows.filter(x=>x.successRate>=0.8);
  console.log('tested:',rows.length,'stable:',stable.length);
}
main().catch(e=>{console.error(e);process.exit(1)});
