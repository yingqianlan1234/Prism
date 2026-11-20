export function parseLrc(value){
 if(typeof value!=='string')return [];
 const lines=[];
 for(const raw of value.split(/\r?\n/)){
  const stamps=[...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
  const text=raw.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g,'').trim();
  if(!text)continue;
  for(const stamp of stamps){const at=Number(stamp[1])*60+Number(stamp[2]);if(Number.isFinite(at))lines.push({at,text});}
 }
 return lines.sort((a,b)=>a.at-b.at);
}
// Match only nearby timestamped translations; leave unmatched original lines unchanged.
export function mergeTranslation(lines, translations) {
 if(!Array.isArray(lines)||!Array.isArray(translations)||!translations.length)return lines;
 let j=0;
 return lines.map(line=>{
  while(j+1<translations.length && translations[j+1].at<=line.at)j++;
  const choices=[translations[j],translations[j+1]].filter(Boolean);
  const best=choices.reduce((a,b)=>!a||Math.abs(b.at-line.at)<Math.abs(a.at-line.at)?b:a,null);
  return best&&Math.abs(best.at-line.at)<=0.15&&best.text!==line.text?{...line,translation:best.text}:line;
 });
}
