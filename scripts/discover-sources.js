#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const API='https://api.github.com';
const UA='FreeNodeFilter/0.1';
const TOKEN=process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'';
const MAX_REPOS=8;
const MAX_FILES_PER_REPO=12;
const MAX_NEW_SOURCES=60;
const stateFile=path.resolve('data/sources.json');

function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function sourceId(url){return 'dynamic-'+crypto.createHash('sha256').update(url).digest('hex').slice(0,12)}
function canonical(url){
  try{const u=new URL(url);u.hash='';u.search='';return u.toString().replace(/\\/$/,'')}catch{return null}
}
function isCandidatePath(p){
  const x=p.toLowerCase();
  return /\\.(ya?ml|json|txt|conf|list)$/.test(x)&&/(sub|node|proxy|clash|sing|v2ray|vless|vmess|trojan|ssr|ss|free)/.test(x);
}
async function api(url){
  const r=await fetch(url,{headers:{accept:'application/vnd.github+json','user-agent':UA,...(TOKEN?{authorization:'Bearer '+TOKEN}:{})}});
  if(!r.ok)throw new Error('GitHub API '+r.status+' '+url);
  return r.json();
}
async function looksLikeSource(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA}});
    if(!r.ok)return false;
    const text=(await r.text()).slice(0,200000);
    return /(^|\\n)\\s*proxies\\s*:/m.test(text)||/(?:vless|vmess|trojan|ss|ssr):\\/\\//i.test(text);
  }catch{return false}
}

function nextProbe(status,reputation){
  const hours=status==='trusted'?24:status==='normal'?12:status==='weak'?72:status==='dead'?168:6;
  if(reputation?.status==='degraded')return new Date(Date.now()+72*3600000).toISOString();
  return new Date(Date.now()+hours*3600000).toISOString();
}
function lifecycle(old,rep,fetchOk){
  const current=rep?.status||old?.status||'candidate';
  if(!fetchOk){
    const failures=Number(old?.fetchFailures||0)+1;
    return {status:failures>=6?'dead':'weak',fetchFailures:failures};
  }
  const failures=0;
  if(!rep)return {status:old?.status==='candidate'?'normal':old?.status||'normal',fetchFailures:failures};
  if(rep.status==='trusted')return {status:'trusted',fetchFailures:failures};
  if(rep.status==='degraded')return {status:'weak',fetchFailures:failures};
  if(rep.status==='weak')return {status:'weak',fetchFailures:failures};
  return {status:current==='candidate'?'normal':current,fetchFailures:failures};
}

async function main(){
  fs.mkdirSync('data',{recursive:true});
  const state=readJson(stateFile,{sources:[]});
  const repState=readJson('data/source-reputation.json',{sources:{}});
  const known=new Map();
  for(const s of (state.sources||[])){const u=canonical(s.url);if(u)known.set(u,s)}

  const queries=['free proxy nodes clash','free v2ray nodes','free proxy subscription','clash subscription nodes'];
  const repos=new Map();
  for(const q of queries){
    try{
      const d=await api(API+'/search/repositories?q='+encodeURIComponent(q)+'&sort=updated&order=desc&per_page='+MAX_REPOS);
      for(const r of (d.items||[]))if(r.full_name)repos.set(r.full_name,r);
    }catch(e){console.error('discover search failed:',e.message)}
  }

  let added=0;
  for(const repo of repos.values()){
    if(added>=MAX_NEW_SOURCES)break;
    try{
      const branch=repo.default_branch||'main';
      const tree=await api(API+'/repos/'+repo.full_name+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1');
      const files=(tree.tree||[]).filter(x=>x.type==='blob'&&x.path&&isCandidatePath(x.path)).slice(0,MAX_FILES_PER_REPO);
      for(const f of files){
        if(added>=MAX_NEW_SOURCES)break;
        const raw='https://raw.githubusercontent.com/'+repo.full_name+'/'+branch+'/'+f.path.split('/').map(encodeURIComponent).join('/');
        const u=canonical(raw);
        if(!u||known.has(u))continue;
        if(!(await looksLikeSource(u)))continue;
        const now=new Date().toISOString();
        const item={url:u,type:'github_raw',name:sourceId(u),discoveredFrom:'github:'+repo.full_name,firstSeen:now,lastSeen:now,status:'candidate',reputation:null,fetchFailures:0,nextProbeAt:now};
        known.set(u,item);state.sources.push(item);added++;console.log('NEW',u);
      }
    }catch(e){console.error('repo scan failed:',repo.full_name,e.message)}
  }

  for(const s of state.sources||[]){
    if(!s.url)continue;
    const id=s.name||sourceId(s.url);
    const rep=repState.sources?.[id]||repState.sources?.[s.url]||null;
    if(rep){s.reputation=rep.weightedNodeSuccessRate;s.status=rep.status==='trusted'?'trusted':rep.status==='degraded'?'weak':rep.status==='weak'?'weak':(s.status==='candidate'?'normal':s.status)}
    if(!s.status)s.status='candidate';
    if(!s.firstSeen)s.firstSeen=new Date().toISOString();
    if(!s.lastSeen)s.lastSeen=s.firstSeen;
    if(!s.fetchFailures)s.fetchFailures=0;
    s.name=id;
    s.nextProbeAt=nextProbe(s.status,rep);
  }

  state.updatedAt=new Date().toISOString();
  state.version=1;
  fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\\n');
  console.log('discovered:',added,'total dynamic:',state.sources.length);
}

main().catch(e=>{console.error(e);process.exit(1)});
