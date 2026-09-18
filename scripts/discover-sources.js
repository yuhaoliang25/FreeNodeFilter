#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

const API='https://api.github.com';
const UA='FreeNodeFilter/0.1';
const TOKEN=process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'';
const MAX_REPOS=8;
const MAX_FILES_PER_REPO=12;
const MAX_NEW_SOURCES=60;

const seedFile=path.resolve('sources/sources.yaml');
const stateFile=path.resolve('data/sources.json');

function readJson(file,fallback){
  try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}
}

function canonical(url){
  try{
    const u=new URL(url);
    u.hash='';
    u.search='';
    return u.toString().replace(/\\/$/,'');
  }catch{return null}
}

function isCandidatePath(p){
  const x=p.toLowerCase();
  if(!/\\.(ya?ml|json|txt|conf|list)$/.test(x))return false;
  return /(sub|node|proxy|clash|sing|v2ray|vless|vmess|trojan|ssr|ss|free)/.test(x);
}

async function api(url){
  const r=await fetch(url,{
    headers:{
      accept:'application/vnd.github+json',
      'user-agent':UA,
      ...(TOKEN?{authorization:'Bearer '+TOKEN}:{})
    }
  });
  if(!r.ok)throw new Error('GitHub API '+r.status+' '+url);
  return r.json();
}

async function looksLikeSource(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA}});
    if(!r.ok)return false;
    const text=(await r.text()).slice(0,200000);
    if(/(^|\\n)\\s*proxies\\s*:/m.test(text))return true;
    if(/(?:vless|vmess|trojan|ss|ssr):\\/\\//i.test(text))return true;
    return false;
  }catch{return false}
}

async function main(){
  fs.mkdirSync('data',{recursive:true});
  const state=readJson(stateFile,{sources:[]});
  const known=new Map();

  for(const s of (state.sources||[])){
    const u=canonical(s.url);
    if(u)known.set(u,s);
  }

  let queries=[
    'free proxy nodes clash',
    'free v2ray nodes',
    'free proxy subscription',
    'clash subscription nodes'
  ];

  const repos=new Map();
  for(const q of queries){
    try{
      const d=await api(API+'/search/repositories?q='+encodeURIComponent(q)+'&sort=updated&order=desc&per_page='+MAX_REPOS);
      for(const r of (d.items||[])) if(r.full_name) repos.set(r.full_name,r);
    }catch(e){console.error('discover search failed:',e.message)}
  }

  let added=0;
  for(const repo of repos.values()){
    if(added>=MAX_NEW_SOURCES)break;
    try{
      const branch=repo.default_branch||'main';
      const tree=await api(API+'/repos/'+repo.full_name+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1');
      const files=(tree.tree||[])
        .filter(x=>x.type==='blob'&&x.path&&isCandidatePath(x.path))
        .slice(0,MAX_FILES_PER_REPO);

      for(const f of files){
        if(added>=MAX_NEW_SOURCES)break;
        const raw='https://raw.githubusercontent.com/'+repo.full_name+'/'+branch+'/'+f.path.split('/').map(encodeURIComponent).join('/');
        const u=canonical(raw);
        if(!u||known.has(u))continue;
        if(!(await looksLikeSource(u)))continue;

        const now=new Date().toISOString();
        const item={
          url:u,
          type:'github_raw',
          discoveredFrom:'github:'+repo.full_name,
          firstSeen:now,
          lastSeen:now,
          status:'candidate',
          reputation:null
        };
        known.set(u,item);
        state.sources.push(item);
        added++;
        console.log('NEW',u);
      }
    }catch(e){
      console.error('repo scan failed:',repo.full_name,e.message);
    }
  }

  state.sources=(state.sources||[]).map(s=>{
    if(!s.firstSeen)s.firstSeen=new Date().toISOString();
    if(!s.lastSeen)s.lastSeen=s.firstSeen;
    if(!s.status)s.status='candidate';
    return s;
  });

  fs.writeFileSync(stateFile,JSON.stringify({
    version:1,
    updatedAt:new Date().toISOString(),
    sources:state.sources
  },null,2)+'\\n');

  console.log('discovered:',added,'total dynamic:',state.sources.length);
}

main().catch(e=>{console.error(e);process.exit(1)});
