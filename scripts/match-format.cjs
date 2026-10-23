const path=require('node:path');
const root=path.resolve(__dirname,'..');
function loadRules(file=process.env.SKYDUEL_RULES_FILE||'competition/rules.json'){
 const rules=require(path.resolve(root,file)),teams=Object.keys(rules.map.teams);
 if(rules.match.teams!==teams.length||!Number.isInteger(rules.match.players_per_team)||rules.match.players_per_team<1)throw Error('Invalid rules team format');
 return rules;
}
function defaultRoster(rules){return Object.keys(rules.map.teams).flatMap((team,t)=>Array.from({length:rules.match.players_per_team},(_,slot)=>({name:rules.match.players_per_team===1?['EmberAI','BastionAI'][t]:team+'AI_'+(slot+1),model:(rules.match.players_per_team===1?t:slot)%2?'BastionAI':'EmberAI',style:rules.match.players_per_team===1?(t?'fortify':'rush'):(slot<2?'fortify':'rush'),seed:101+t*7919+slot*97,team,slot})));}
function validateRoster(roster,rules){
 const expected=rules.match.teams*rules.match.players_per_team;
 if(roster.length!==expected||new Set(roster.map(p=>p.name.toLowerCase())).size!==expected)throw Error(`Exactly ${expected} unique players required`);
 for(const p of roster)if(!/^[A-Za-z0-9_]{3,16}$/.test(p.name))throw Error('Invalid player name');
 if(rules.match.players_per_team>1)for(const team of Object.keys(rules.map.teams)){
  const members=roster.filter(p=>p.team===team);
  if(members.length!==rules.match.players_per_team||new Set(members.map(p=>p.slot)).size!==members.length||members.some(p=>!Number.isInteger(p.slot)||p.slot<0||p.slot>=members.length))throw Error('Invalid squad: '+team);
 }
 return roster;
}
module.exports={loadRules,defaultRoster,validateRoster};
