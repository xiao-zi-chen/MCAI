const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
// The new layout puts each frame on one line. Validate the entire file without retaining it.
async function validateReplay(file,match){
 const summary=path.join(path.dirname(file),'results',path.basename(file));
 const names=match.players.map(p=>p.id),validFrame=f=>Array.isArray(f.players)&&f.players.every(p=>names.includes(p.name));
 if(!fs.existsSync(summary)){
  const r=JSON.parse(await fs.promises.readFile(file,'utf8'));
  return r.match_id===match.id&&r.arena_id===match.arena_id&&r.frames.every(validFrame);
 }
 const r=JSON.parse(await fs.promises.readFile(summary,'utf8'));
 if(r.match_id!==match.id||r.arena_id!==match.arena_id)return false;
 let header=false,frames=false,closed=false,count=0;
 const input=fs.createReadStream(file),lines=readline.createInterface({input,crlfDelay:Infinity});
 try{for await(const line of lines){
  if(!header){const h=JSON.parse(line.replace(/,$/,'')+'}');if(h.match_id!==match.id||h.arena_id!==match.arena_id)return false;header=true;}
  else if(line==='"frames":[')frames=true;
  else if(line===']}')closed=true;
  else if(frames&&!closed&&line){if(!validFrame(JSON.parse(line.replace(/,$/,''))))return false;count++;}
  else if(line)return false;
 }}finally{lines.close();input.destroy();}
 return header&&closed&&count===r.frame_count;
}
module.exports={validateReplay};
