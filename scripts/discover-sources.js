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
async function fetchText(url,limit=200000){
  const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return (await r.text()).slice(0,limit);
}
function candidateUrl(url){
  try{
    const u=new URL(url);
    if(!/^https?:$/.test(u.protocol))return null;
    const host=u.hostname.toLowerCase();
    const pathAndQuery=(u.pathname+' '+u.search).toLowerCase();
    const githubHost=host==='raw.githubusercontent.com'||host==='gist.githubusercontent.com'||host==='github.com';
    const looksNamed=/(sub|subscription|node|proxy|clash|v2ray|vless|vmess|trojan|ssr|free|yaml|yml|txt|json)/.test(pathAndQuery);
    if(!githubHost&&!looksNamed)return null;
    if(host==='github.com'&&u.pathname.includes('/blob/')){
      const parts=u.pathname.split('/').filter(Boolean);
      if(parts.length>=4){
        const branch=parts[2];
        const file=parts.slice(3).join('/');
        return canonical('https://raw.githubusercontent.com/'+parts[0]+'/'+parts[1]+'/'+branch+'/'+file);
      }
    }
    return canonical(u.toString());
  }catch{return null}
}
function extractSourceUrls(text){
  const found=new Set();
  const re=/https?:\\/\\/[^\\s"'<>\\])}]+/gi;
  for(const m of text.matchAll(re)){
    const u=candidateUrl(m[0].replace(/[.,;:]+$/,''));
    if(u)found.add(u);
  }
  return [...found];
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
  const addCandidate=async(u,from,type='discovered_url')=>{
    if(added>=MAX_NEW_SOURCES||!u||known.has(u))return false;
    if(!(await looksLikeSource(u)))return false;
    const now=new Date().toISOString();
    const item={url:u,type,name:sourceId(u),discoveredFrom:from,firstSeen:now,lastSeen:now,status:'candidate',reputation:null,fetchFailures:0,nextProbeAt:now};
    known.set(u,item);state.sources.push(item);added++;
    console.log('NEW',u,'from',from);
    return true;
  };

  // Frontier 1: repository files discovered through GitHub search.
  for(const repo of repos.values()){
    if(added>=MAX_NEW_SOURCES)break;
    try{
      const branch=repo.default_branch||'main';
      const tree=await api(API+'/repos/'+repo.full_name+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1');
      const files=(tree.tree||[]).filter(x=>x.type==='blob'&&x.path&&isCandidatePath(x.path)).slice(0,MAX_FILES_PER_REPO);
      for(const f of files){
        if(added>=MAX_NEW_SOURCES)break;
        const raw='https://raw.githubusercontent.com/'+repo.full_name+'/'+branch+'/'+f.path.split('/').map(encodeURIComponent).join('/');
        await addCandidate(canonical(raw),'github:'+repo.full_name,'github_raw');
      }
      // Also inspect README text: many repositories publish links to sources
      // without putting the actual subscription in the repository tree.
      if(added<MAX_NEW_SOURCES){
        try{
          const readme=await api(API+'/repos/'+repo.full_name+'/readme');
          const text=Buffer.from(readme.content||'','base64').toString('utf8');
          for(const u of extractSourceUrls(text)){
            if(added>=MAX_NEW_SOURCES)break;
            await addCandidate(u,'github:'+repo.full_name,'discovered_url');
          }
        }catch{}
      }
    }catch(e){console.error('repo scan failed:',repo.full_name,e.message)}
  }

  // Frontier 2: existing sources can discover additional sources. Only a
  // bounded number of parents are expanded per run to prevent an unbounded
  // crawler from turning the workflow into a general web spider.
  const frontier=(state.sources||[])
    .filter(s=>s.url&&!s.nextProbeAt||s.url&&Date.parse(s.nextProbeAt||0)<=Date.now())
    .slice(0,20);
  for(const parent of frontier){
    if(added>=MAX_NEW_SOURCES)break;
    try{
      const text=await fetchText(parent.url,120000);
      for(const u of extractSourceUrls(text)){
        if(added>=MAX_NEW_SOURCES)break;
        await addCandidate(u,parent.name||parent.url,'source_link');
      }
    }catch{}
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
