#!/usr/bin/env node
'use strict';
const fs=require('fs'), path=require('path'), yaml=require('js-yaml');
const sources=yaml.load(fs.readFileSync(path.resolve('sources/sources.yaml'),'utf8')).sources||[];
async function main(){
  fs.mkdirSync('data',{recursive:true});
  const out=[];
  for(const s of sources){
    try{
      const r=await fetch(s.url,{redirect:'follow'});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const text=await r.text();
      out.push({name:s.name,url:s.url,text});
      console.log('✓',s.name,text.length,'bytes');
    }catch(e){ console.error('✗',s.name,e.message); }
  }
  fs.writeFileSync('data/raw-sources.json',JSON.stringify(out));
  if(!out.length) throw new Error('没有成功获取任何节点源');
}
main().catch(e=>{console.error(e);process.exit(1)});
