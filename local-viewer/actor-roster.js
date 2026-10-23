(function(root){
 const teams={Red:['红队','#ef7b72'],Blue:['蓝队','#77b6ff'],Green:['绿队','#7cdda0'],Yellow:['黄队','#f2ce73']};
 const roles={defender:'守卫',collector:'采集',attacker:'先锋',support:'支援',respawning:'复活中',eliminated:'已淘汰'};
 function render(container,agents,onSelect){
  const signature=JSON.stringify(agents.map(a=>[a.name,a.display_name,a.label,a.role,Math.ceil(a.health??a.hp??0),a.personality]));
  if(container.dataset.signature===signature)return;container.dataset.signature=signature;
  const opened=new Set([...container.querySelectorAll('details[open]')].map(e=>e.dataset.team));
  if(!container.dataset.ready)opened.add('Red');container.dataset.ready='1';container.classList.add('roster-list');
  const groups=[];
  for(const [team,[title,color]] of Object.entries(teams)){
   const members=agents.filter(a=>a.team===team);if(!members.length)continue;
   const group=document.createElement('details');group.className='roster-team';group.dataset.team=team;group.open=opened.has(team);group.style.setProperty('--team',color);
   const heading=document.createElement('summary');heading.textContent=title+' · '+members.length+' 位选手';group.append(heading);
   for(const actor of members){
    const card=document.createElement('button');card.type='button';card.className='actor-card';card.onclick=()=>onSelect?.(actor.name);
    const name=document.createElement('strong');name.textContent=actor.display_name||actor.name;
    const role=document.createElement('small');role.textContent=roles[actor.role||actor.preferred_role]||'对战中';
    const status=document.createElement('span');status.textContent=actor.label||Math.ceil(actor.health??actor.hp??20)+' HP';
    const detail=document.createElement('p');detail.textContent=actor.personality||'';card.append(name,role,status,detail);group.append(card);
   }
   groups.push(group);
  }
  container.replaceChildren(...groups);
 }
 root.ActorRoster={render};
})(window);