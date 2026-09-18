#!/usr/bin/env node
'use strict';

const fs=require('fs');

const candidates=JSON.parse(fs.readFileSync('data/candidates.json','utf8'));
const MIN_SOURCE_NODES=5;
const MIN_INTERSECTION=2;
const MIN_JACCARD=0.10;
const MAX_PAIRS_PER_SOURCE=20;
const SIMILARITY_THRESHOLD=0.30;

const sourceNodes=new Map();
const endpointSources=new Map();

for(const p of candidates){
  const id=p._id;
  if(!id)continue;
  const names=[...(new Set(Array.isArray(p._sources)?p._sources:[p._source].filter(Boolean)))];
  for(const source of names){
    if(!sourceNodes.has(source))sourceNodes.set(source,new Set());
    sourceNodes.get(source).add(id);
    if(!endpointSources.has(id))endpointSources.set(id,new Set());
    endpointSources.get(id).add(source);
  }
}

const eligible=[...sourceNodes.entries()]
  .filter(([,nodes])=>nodes.size>=MIN_SOURCE_NODES)
  .map(([source,nodes])=>({source,nodes}))
  .sort((a,b)=>b.nodes.size-a.nodes.size);

const intersection=new Map();

function pairKey(a,b){return a<b?a+'\n'+b:b+'\n'+a;}
function pairMap(key){
  let m=intersection.get(key);
  if(!m){m={a:key.split('\n')[0],b:key.split('\n')[1],intersection:0};intersection.set(key,m)}
  return m;
}

for(const sources of endpointSources.values()){
  const arr=[...sources].filter(s=>sourceNodes.get(s)?.size>=MIN_SOURCE_NODES).sort();
  for(let i=0;i<arr.length;i++){
    for(let j=i+1;j<arr.length;j++){
      pairMap(pairKey(arr[i],arr[j])).intersection++;
    }
  }
}

const pairs=[];
for(const x of intersection.values()){
  const aSize=sourceNodes.get(x.a).size;
  const bSize=sourceNodes.get(x.b).size;
  const union=aSize+bSize-x.intersection;
  const jaccard=union?x.intersection/union:0;
  if(x.intersection>=MIN_INTERSECTION && jaccard>=MIN_JACCARD){
    pairs.push({
      a:x.a,b:x.b,
      intersection:x.intersection,
      union,
      jaccard:Number(jaccard.toFixed(4))
    });
  }
}

pairs.sort((a,b)=>b.jaccard-a.jaccard||b.intersection-a.intersection);

const bySource=new Map();
for(const p of pairs){
  for(const source of [p.a,p.b]){
    if(!bySource.has(source))bySource.set(source,[]);
    bySource.get(source).push(p);
  }
}

const sources={};
for(const {source,nodes} of eligible){
  const related=(bySource.get(source)||[]).slice().sort((a,b)=>b.jaccard-a.jaccard||b.intersection-a.intersection);
  const strong=related.filter(p=>p.jaccard>=SIMILARITY_THRESHOLD);
  const dependencyPenalty=strong.reduce((sum,p)=>sum+(p.jaccard-SIMILARITY_THRESHOLD),0);
  const independenceWeight=Math.max(0.25,Math.min(1,1/(1+dependencyPenalty)));
  sources[source]={
    nodes:nodes.size,
    similarSources:related.slice(0,MAX_PAIRS_PER_SOURCE).map(p=>({
      source:p.a===source?p.b:p.a,
      intersection:p.intersection,
      union:p.union,
      jaccard:p.jaccard
    })),
    strongSimilarityCount:strong.length,
    independenceWeight:Number(independenceWeight.toFixed(4))
  };
}

const output={
  generatedAt:new Date().toISOString(),
  method:{
    description:'Endpoint-overlap graph for source similarity; similarity is an independence signal, not a source-quality penalty.',
    minSourceNodes:MIN_SOURCE_NODES,
    minIntersection:MIN_INTERSECTION,
    minJaccard:MIN_JACCARD,
    strongSimilarityThreshold:SIMILARITY_THRESHOLD
  },
  summary:{
    candidates:candidates.length,
    eligibleSources:eligible.length,
    relatedPairs:pairs.length
  },
  sources,
  pairs:pairs.slice(0,eligible.length*MAX_PAIRS_PER_SOURCE)
};

fs.writeFileSync('data/source-similarity.json',JSON.stringify(output,null,2));
console.log('source graph:',eligible.length,'eligible sources,',pairs.length,'related pairs');
