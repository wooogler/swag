import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
(function(){try{const t=readFileSync(resolve(process.cwd(),'.env'),'utf8');for(const l of t.split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}}catch{}})();
const SC='/tmp/claude-1000/-home-sangwonlee-swag/4bc76ef4-451a-47e0-8dc8-f22177ab5d76/scratchpad/';
async function main(){
  const { buildJelsonSuggestions, jelsonToIntent } = await import('@/lib/score/jelson-suggest');
  const { DEFAULT_SCORE_CONFIG } = await import('@/lib/score/default-config');
  const defByCode = new Map<string,{label:string,def:string}>();
  for (const s of buildJelsonSuggestions(DEFAULT_SCORE_CONFIG)) { const {title,definition}=jelsonToIntent(s); defByCode.set(s.code,{label:title,def:definition}); }
  const j = JSON.parse(readFileSync(SC+'stability-post.json','utf8'));
  const qById = new Map<number,any>(j.queries.map((q:any)=>[q.messageId,q]));
  const cap=(s:string|null,n:number)=> !s?'':(s.length<=n?s:s.slice(0,Math.floor(n*0.7))+' […] '+s.slice(-Math.floor(n*0.3)));
  const cells = j.flippedCells.map((c:any,i:number)=>{
    const q=qById.get(c.messageId); const d=defByCode.get(c.code)!;
    const cnt:Record<string,number>={}; c.ratings.forEach((r:string)=>cnt[r]=(cnt[r]||0)+1);
    return { i, code:c.code, label:d.label, definition:d.def,
      q: cap(q.queryText,600).replace(/\s+/g,' '),
      prior: (q.prevQueryText||q.prevResponseText)? ('student: '+cap(q.prevQueryText,200).replace(/\s+/g,' ')+' | bot: '+cap(q.prevResponseText,300).replace(/\s+/g,' ')) : '',
      observed: cnt };
  });
  writeFileSync(SC+'adj-post.json', JSON.stringify(cells));
  console.log('post-fix flip cells for adjudication:', cells.length, 'bytes:', JSON.stringify(cells).length);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
