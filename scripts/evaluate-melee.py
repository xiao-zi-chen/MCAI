"""Paired side-swapped live-server comparison against each agent's v1 checkpoint."""
import argparse,json,time,sys
from dataclasses import replace
from pathlib import Path
import numpy as np
import torch
from stable_baselines3 import PPO
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.observations import flatten_snapshot
from mc_pvp_env.actions import curriculum_action_to_vector
from mc_pvp_env.protocol import JsonlClient
def request(client,kind,**fields):
 reply=client.request({'v':1,'id':f'eval-{time.time_ns()}','type':kind,**fields})
 if reply.get('type')=='error':raise RuntimeError(reply.get('error'))
 return reply

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate',type=Path,default=ROOT/'runs/showcase-v2')
parser.add_argument('--baseline',type=Path,default=ROOT/'runs/showcase-agents')
parser.add_argument('--episodes',type=int,default=8)
args=parser.parse_args()
torch.set_num_threads(1)
config=replace(EnvConfig.from_json(ROOT/'runs/worker_001/env.json'),combat_mode='health')
plugin=JsonlClient(config.host,config.plugin_port,30,'eval');bots=JsonlClient(config.host,config.bot_port,30,'bots')
rows=[]
try:
 request(plugin,'register_players',arena_id=config.arena,players=[config.self_name,config.opponent_name])
 request(bots,'spawn',bots=config.bot_specs())
 time.sleep(1)
 env=MinecraftPvpEnv(config)
 for name in ['EmberAI','BastionAI']:
  old=PPO.load(args.baseline/f'{name}.zip',device='cpu');new=PPO.load(args.candidate/f'{name}.zip',device='cpu')
  for episode in range(args.episodes):
   models=[new,old] if episode%2==0 else [old,new];candidate_name=config.self_name if episode%2==0 else config.opponent_name
   request(bots,'clear_controls');time.sleep(.2);env._episode_idx=episode//2
   _,info=env.reset(seed=900+episode//2);snapshot=info['snapshot'];start=time.monotonic();steps=0
   while True:
    vectors=[]
    for index,model in enumerate(models):
     names=[config.self_name,config.opponent_name];obs=flatten_snapshot(snapshot,names[index],names[1-index],config.max_episode_ticks);obs[1]=1;obs[20]=1;obs[26:30]=0
     action,_=model.predict(obs,deterministic=True);action=int(action)
     # Both candidates receive the same published approach and cooldown assistance.
     if obs[17]*20>3.15:action=3
     vector=curriculum_action_to_vector(action)
     if obs[19]<.9:vector[7]=0
     vectors.append(vector)
    _,_,terminated,truncated,info=env._step_actions(*vectors);snapshot=info['snapshot'];steps+=1
    if terminated or truncated:break
   winner=snapshot.get('winner','');result='draw' if not winner else 'win' if winner==candidate_name else 'loss'
   row={'agent':name,'episode':episode,'candidate_side':'left' if episode%2==0 else 'right','result':result,'steps':steps,'seconds':time.monotonic()-start,'reason':snapshot.get('done_reason')};rows.append(row);print(json.dumps(row),flush=True)
   (args.candidate/'evaluation.json').write_text(json.dumps({'candidate':str(args.candidate),'baseline':str(args.baseline),'conditions':'real health combat, equal weapon kit, same observation masking, approach and cooldown assistance; whole paired seeds with swapped sides','matches':rows},indent=2))
 env.close()
finally:
 request(bots,'clear_controls');request(plugin,'cleanup',arena_id=config.arena);plugin.close();bots.close()
