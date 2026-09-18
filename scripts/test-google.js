#!/usr/bin/env node
'use strict';
const fs=require('fs');
const API=process.env.MIHOMO_API||'http://127.0.0.1:9090';
const GROUP=process.env.MIHOMO_GROUP||'FREE_NODE_POOL';
const TARGET=process.env.GOOGLE_TEST_URL||'https://www.google.com/generate_204';
const ROUNDS=Number(process.env.TEST_ROUNDS||3), TIMEOUT=Number(process.env.TEST_TIMEOUT||8000), EXPECTED=process.env.TEST_EXPECTED||'204';
const STAGE1_LIMIT=Number(process.env.STAGE1_LIMIT||1500);
const STAGE2_LIMIT=Number(process.env.STAGE2_LIMIT||300);
const STAGE3_LIMIT=Number(process.env.STAGE3_LIMIT||100);
const FAST_TIMEOUT=Number(process.env.FAST_TIMEOUT||5000);
async function json(url){const r=await fetch(url);const t=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+' '+t.slice(0,300));return JSON.parse(t)}
async function main(){
 const all={};
 const candidates=JSON.parse(fs.readFileSync('data/candidates.json','utf8'));
 const sourceByName=new Map(candidates.map(x=>[x.name,x._source||'unknown']));
 const ids=new Map(candidates.map(x=>[x.name,x['endpoint-id']||x._id]));
 const rep=(()=>{try{return JSON.parse(fs.readFileSync('data/reputation.json','utf8')).nodes||{}}catch{return {}}})();
 const now=Date.now();
 function score(p){
  const r=rep[p._id];
  if(!r)return 50;
  const rate=Math.max(0,Math.min(1,Number(r.longTermSuccessRate||0)));
  const recent=Math.max(0,Math.min(1,1-(Number(r.recentFailures||0)/6)));
  const age=Math.max(0,now-Date.parse(r.lastSeen||0));
  const freshness=age<=86400000?1:age<=604800000?.7:.4;
  if(r.status==='quarantine')return -100;
  if(r.status==='degraded')return 15+rate*25+recent*10;
  return 40+rate*35+recent*15+freshness*10;
 }
 function budget(p){
  const s=score(p);
  if(s<0)return 0;
  if(s<35)return 1;
  if(s<65)return 2;
  return 3;
 }
 const ranked=[...candidates].sort((a,b)=>score(b)-score(a));
 const known=ranked.filter(p=>rep[p._id] && rep[p._id].status!=='quarantine');
 const fresh=ranked.filter(p=>!rep[p._id]);
 const degraded=ranked.filter(p=>rep[p._id]?.status==='degraded');
 const exploitLimit=Math.floor(STAGE1_LIMIT*0.7);
 const exploreLimit=Math.floor(STAGE1_LIMIT*0.2);
 const recoveryLimit=STAGE1_LIMIT-exploitLimit-exploreLimit;
 function takeUnique(arr,n,used){
  const out=[];
  for(const p of arr)if(!used.has(p.name)&&out.length<n){used.add(p.name);out.push(p.name)}
  return out;
 }
 const used=new Set();
 const names=[
   ...takeUnique(known,exploitLimit,used),
   ...takeUnique(fresh,exploreLimit,used),
   ...takeUnique(degraded,recoveryLimit,used)
 ];
 async function testGroup(selected,timeout){
  if(!selected.length)return {};
  const q=new URLSearchParams({url:TARGET,timeout:String(timeout),expected:EXPECTED});
  const result=await json(API+'/group/'+encodeURIComponent(GROUP)+'/delay?'+q);
  for(const [name,delay] of Object.entries(result)){const d=Number(delay);(all[name]??=[]).push(Number.isFinite(d)&&d>0?d:0)}
  return result;
 }
 const budgets=new Map(candidates.map(p=>[p.name,budget(p)]));
 const r1=await testGroup(names,FAST_TIMEOUT);
 const survivors1=Object.entries(r1).filter(([,d])=>Number(d)>0).sort((a,b)=>Number(a[1])-Number(b[1])).slice(0,STAGE2_LIMIT).map(([n])=>n);
 console.log('stage1:',names.length,'->',survivors1.length);
 const r2=await testGroup(survivors1,TIMEOUT);
 const survivors2=Object.entries(r2).filter(([,d])=>Number(d)>0).sort((a,b)=>Number(a[1])-Number(b[1])).slice(0,STAGE3_LIMIT).map(([n])=>n);
 console.log('stage2:',survivors1.length,'->',survivors2.length);
 for(let round=1;round<=ROUNDS;round++){
  if(round===1)continue;
  const eligible=survivors2.filter(name=>(budgets.get(name)||3)>=round);
  const result=await testGroup(eligible,TIMEOUT);
  console.log('deep round',round,'tested',Object.keys(result).length);
  if(round<ROUNDS)await new Promise(r=>setTimeout(r,1500));
 }
 // Stage-1/2 failures are intentionally retained in the report with fewer rounds.
 const rows=Object.entries(all).map(([name,delays])=>{
  const ok=delays.filter(x=>x>0),sorted=[...ok].sort((a,b)=>a-b),pct=p=>ok.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]:null;
  return {name,fingerprint:ids.get(name)||null,source:sourceByName.get(name)||'unknown',rounds:delays.length,successes:ok.length,successRate:ok.length/delays.length,avgLatency:ok.length?Math.round(ok.reduce((a,b)=>a+b,0)/ok.length):null,p50Latency:pct(.5),p95Latency:pct(.95),maxLatency:ok.length?Math.max(...ok):null,delays};
 }).sort((a,b)=>(b.successRate-a.successRate)||(a.avgLatency??1e9)-(b.avgLatency??1e9));
 const report={generatedAt:new Date().toISOString(),identity:'endpoint-id-v1',target:TARGET,rounds:ROUNDS,timeout:TIMEOUT,expectedStatus:EXPECTED,staging:{stage1:STAGE1_LIMIT,stage2:STAGE2_LIMIT,stage3:STAGE3_LIMIT,fastTimeout:FAST_TIMEOUT},results:rows};
 fs.mkdirSync('data',{recursive:true});
 report.sourceStats={};
 for(const r of rows){
   const s=report.sourceStats[r.source]??={nodes:0,successful:0,totalTests:0,totalSuccesses:0,latencies:[]};
   s.nodes++;
   if(r.successes>0)s.successful++;
   s.totalTests+=r.rounds;
   s.totalSuccesses+=r.successes;
   if(r.avgLatency)s.latencies.push(r.avgLatency);
 }
 for(const s of Object.values(report.sourceStats)){
   s.successRate=s.totalTests?s.totalSuccesses/s.totalTests:0;
   s.nodeSuccessRate=s.nodes?s.successful/s.nodes:0;
   s.avgLatency=s.latencies.length?Math.round(s.latencies.reduce((a,b)=>a+b,0)/s.latencies.length):null;
   delete s.latencies;
 }
 fs.writeFileSync('data/health.json',JSON.stringify(report,null,2));
 let history=[]; try{history=JSON.parse(fs.readFileSync('data/history.json','utf8'))}catch{}
 history.push(report); history=history.slice(-30);
 fs.writeFileSync('data/history.json',JSON.stringify(history,null,2));
 const now=Date.now(), current=new Map(rows.map(r=>[r.fingerprint,r]));
 const reputation={generatedAt:new Date().toISOString(),nodes:{}};
 for(const [id,r] of current){
   const past=history.flatMap(b=>b.results||[]).filter(x=>x.fingerprint===id);
   const tests=past.reduce((n,x)=>n+x.rounds,0), successes=past.reduce((n,x)=>n+x.successes,0);
   const failures=tests-successes, recent=past.slice(-6), recentFailures=recent.reduce((n,x)=>n+(x.rounds-x.successes),0);
   const status=recentFailures>=6?'quarantine':(recentFailures>=3?'degraded':'active');
   reputation.nodes[id]={name:r.name,longTermSuccessRate:tests?successes/tests:0,totalTests:tests,totalFailures:failures,recentFailures,status,lastSeen:new Date().toISOString()};
 }
 fs.writeFileSync('data/reputation.json',JSON.stringify(reputation,null,2));
 console.log('tested:',rows.length,'stable:',rows.filter(x=>x.successRate>=.8).length,'best:',rows.filter(x=>x.successRate>=.9&&x.p95Latency<=5000&&x.avgLatency<=2500).length);
}
main().catch(e=>{console.error(e);process.exit(1)});
