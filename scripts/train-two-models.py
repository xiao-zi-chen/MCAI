"""Short real-Minecraft PPO fine-tuning of two independently saved melee policies."""
from __future__ import annotations
import argparse
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import time
import socket

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor
from mc_pvp_env.actions import curriculum_action_to_vector, NEUTRAL_ACTION
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.protocol import JsonlClient

ROOT = Path(__file__).resolve().parents[1]

def request(client, kind, **fields):
    reply = client.request({"v": 1, "id": f"demo-{time.time_ns()}", "type": kind, **fields})
    if reply.get("type") == "error": raise RuntimeError(reply.get("error"))
    return reply

def atomic_json(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    temp.replace(path)

def actor_state(model):
    return torch.cat([p.detach().cpu().flatten() for name, p in model.policy.named_parameters() if name.startswith(('mlp_extractor.policy_net.', 'action_net.'))])

class Peer:
    def __init__(self, health=False): self.model = None; self.health=health
    def action_vector(self, obs=None, snapshot=None):
        if self.model is None or obs is None: return NEUTRAL_ACTION.copy()
        obs=np.array(obs,copy=True)
        if self.health: obs[1]=1;obs[20]=1
        action, _ = self.model.predict(obs, deterministic=True)
        vector=curriculum_action_to_vector(int(action))
        if self.health and obs[19]<0.9:vector[7]=0
        return vector

class DuelEnv(MinecraftPvpEnv):
    def reset(self, **kwargs):
        request(self.bot, 'clear_controls')
        request(self.plugin, 'register_players', arena_id=self.config.arena, players=[self.config.self_name, self.config.opponent_name])
        if self.config.combat_mode=='health':time.sleep(0.2)
        obs,info=super().reset(**kwargs)
        self.previous_hp=[20.0,20.0]
        self.previous_distance=float(np.linalg.norm(np.asarray(info['snapshot']['players'][0]['pos'])-np.asarray(info['snapshot']['players'][1]['pos'])))
        self.combat_totals={'damage_dealt':0.0,'damage_taken':0.0}
        return self.clean_observation(obs),info
    def clean_observation(self,obs):
        if self.config.combat_mode=='health':obs=obs.copy();obs[1]=1;obs[20]=1
        return obs
    def step(self,action):
        obs,reward,terminated,truncated,info=super().step(action)
        info['combat_totals']=dict(self.combat_totals)
        return self.clean_observation(obs),reward,terminated,truncated,info
    def _encode_policy_action(self,action):
        vector=super()._encode_policy_action(action)
        if self.config.combat_mode=='health' and self._last_snapshot:
            me=next((p for p in self._last_snapshot['players'] if p['name']==self.config.self_name),{})
            if me.get('attack_cooldown',0)<0.9:vector[7]=0
        return vector
    def _reward(self,snapshot):
        if self.config.combat_mode!='health':return super()._reward(snapshot)
        players={p['name']:p for p in snapshot['players']}
        me,op=players[self.config.self_name],players[self.config.opponent_name]
        hp=[float(me['hp']),float(op['hp'])]
        phase=snapshot.get('phase')
        if phase=='self_win':hp[1]=0
        elif phase=='opponent_win':hp[0]=0
        dealt=max(0,self.previous_hp[1]-hp[1]);taken=max(0,self.previous_hp[0]-hp[0])
        self.combat_totals['damage_dealt']+=dealt;self.combat_totals['damage_taken']+=taken
        distance=float(np.linalg.norm(np.asarray(me['pos'])-np.asarray(op['pos'])))
        approach=0.01*(min(self.previous_distance,8)-min(distance,8))
        reward=(dealt-self.config.opponent_hit_penalty_scale*taken)/10+approach+self.config.time_penalty_per_step
        if phase=='self_win':reward+=3
        elif phase=='opponent_win':reward-=3
        elif phase=='draw':reward-=0.5
        self.previous_hp=hp;self.previous_distance=distance
        return reward

class Progress(BaseCallback):
    def __init__(self, name, state, output):
        super().__init__()
        self.name, self.state, self.output = name, state, output
        self.rounds = []
    def _on_step(self):
        for done, info in zip(self.locals.get('dones', []), self.locals.get('infos', [])):
            if done:
                snapshot = info['snapshot']
                row = {"learner": self.name, "steps": self.model.num_timesteps, "winner": snapshot.get('winner'), "hits": snapshot.get('hit_counts'), "reason": snapshot.get('done_reason'), "episode": info.get('episode'), "combat_totals":info.get('combat_totals')}
                self.rounds.append(row)
                with (self.output/'episodes.jsonl').open('a', encoding='utf-8') as handle: handle.write(json.dumps(row) + '\n')
        return True
    def _on_rollout_end(self):
        self.state['agents'][self.name]['steps'] = self.model.num_timesteps
        self.state['active'] = self.name
        self.state['updated_at'] = time.time()
        atomic_json(self.output/'training-status.json', self.state)
        print(f"{self.name} steps={self.model.num_timesteps}, completed_episodes={len(self.rounds)}", flush=True)

def export_actor(model, path):
    layers = []
    for module in [*model.policy.mlp_extractor.policy_net, model.policy.action_net]:
        if isinstance(module, torch.nn.Linear):
            layers.append({'type':'linear','weight':module.weight.detach().cpu().tolist(),'bias':module.bias.detach().cpu().tolist()})
        elif isinstance(module, torch.nn.ReLU): layers.append({'type':'relu'})
        elif isinstance(module, torch.nn.Tanh): layers.append({'type':'tanh'})
        else: raise TypeError(str(module))
    path.write_text(json.dumps({'input_size':31,'action_count':11,'layers':layers},separators=(',',':')),encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--steps-per-agent', type=int, default=2048)
    parser.add_argument('--block-steps', type=int, default=1024)
    parser.add_argument('--config', type=Path, default=ROOT/'runs/worker_001/env.json')
    parser.add_argument('--output', type=Path, default=ROOT/'runs/showcase-agents')
    parser.add_argument('--resume-dir',type=Path)
    parser.add_argument('--health-combat',action='store_true')
    args = parser.parse_args()
    if args.steps_per_agent % args.block_steps or args.block_steps % 128: parser.error('Step counts must divide into 128-step rollouts')
    args.output.mkdir(parents=True,exist_ok=True)
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    config = EnvConfig.from_json(args.config)
    if args.health_combat:config=replace(config,combat_mode='health')
    for port in [config.plugin_port,config.bot_port]:
        deadline=time.monotonic()+60
        while True:
            try:
                with socket.create_connection((config.host,port),timeout=1):break
            except OSError:
                if time.monotonic()>deadline:raise
                time.sleep(0.5)
    setup = JsonlClient(config.host,config.plugin_port,30,'setup')
    bots = JsonlClient(config.host,config.bot_port,30,'bots')
    request(setup,'register_players',arena_id=config.arena,players=[config.self_name,config.opponent_name])
    request(bots,'spawn',bots=config.bot_specs())
    deadline = time.monotonic()+45
    while time.monotonic()<deadline:
        snap=request(setup,'snapshot_request',arena_id=config.arena)
        if len(snap.get('players',[]))==2:break
        time.sleep(0.5)
    else:raise RuntimeError('Both training bots must be present')
    base_path=ROOT/'checkpoints/champion_robo/ppo_final.zip'
    base=PPO.load(base_path,device='cpu')
    peers=[Peer(args.health_combat),Peer(args.health_combat)]
    configs=[replace(config,opponent_hit_penalty_scale=1.0,post_hit_spacing_reward=0.001,danger_close_penalty=0.001,time_penalty_per_step=-0.002),
             replace(config,self_name=config.opponent_name,opponent_name=config.self_name,opponent_hit_penalty_scale=1.5,post_hit_spacing_reward=0.01,danger_close_penalty=0.008,time_penalty_per_step=-0.001)]
    envs=[Monitor(DuelEnv(c,opponent_policy=peer)) for c,peer in zip(configs,peers)]
    models=[]
    for index,env in enumerate(envs):
        model=PPO('MlpPolicy',env,device='cpu',policy_kwargs=base.policy_kwargs,n_steps=128,batch_size=64,n_epochs=4,learning_rate=5e-5,ent_coef=0.015,gamma=0.99,seed=101+index*101,verbose=0)
        if args.resume_dir:
            previous=PPO.load(args.resume_dir/(['EmberAI','BastionAI'][index]+'.zip'),device='cpu')
            model.policy.load_state_dict(previous.policy.state_dict())
        else:model.policy.load_state_dict(base.policy.state_dict())
        models.append(model)
    initials=[actor_state(m).clone() for m in models]
    names=['EmberAI','BastionAI']
    state={'status':'training','method':'PPO fine-tuning in real Paper Minecraft, alternating frozen opponents','base_checkpoint':str(base_path),'base_sha256':hashlib.sha256(base_path.read_bytes()).hexdigest(),'macro_strategy':'scripted public movement/purchase/bridge/defense; this training changes melee decisions only','target_steps_per_agent':args.steps_per_agent,'agents':{name:{'steps':0,'profile':profile} for name,profile in zip(names,['aggressive','spacing_and_survival'])}}
    state.update(combat_mode=config.combat_mode,resume_dir=str(args.resume_dir) if args.resume_dir else None,opponent_hp_observation='masked_constant' if args.health_combat else 'privileged_research_state',attack_cooldown_guard=args.health_combat)
    atomic_json(args.output/'training-status.json',state)
    started=time.monotonic()
    try:
        for block in range(args.steps_per_agent//args.block_steps):
            for index,name in enumerate(names):
                peers[index].model=models[1-index]
                models[index].set_env(envs[index],force_reset=True)
                print(f'Training {name}, block {block+1}',flush=True)
                models[index].learn(total_timesteps=args.block_steps,reset_num_timesteps=False,callback=Progress(name,state,args.output))
                models[index].save(args.output/f'{name}.zip')
                export_actor(models[index],args.output/f'{name}.json')
        for index,name in enumerate(names):
            current=actor_state(models[index])
            delta=float(torch.linalg.vector_norm(current-initials[index]))
            if not torch.isfinite(current).all() or delta<=0:raise RuntimeError('Model did not produce a finite trained actor')
            state['agents'][name].update(steps=models[index].num_timesteps,actor_parameters=current.numel(),actor_delta_l2=delta,checkpoint_sha256=hashlib.sha256((args.output/f'{name}.zip').read_bytes()).hexdigest())
        state.update(status='complete',elapsed_seconds=time.monotonic()-started,between_agents_actor_l2=float(torch.linalg.vector_norm(actor_state(models[0])-actor_state(models[1]))))
        atomic_json(args.output/'training-status.json',state)
        print(json.dumps(state,indent=2),flush=True)
    finally:
        request(bots,'clear_controls')
        request(setup,'cleanup',arena_id=config.arena)
        for env in envs:env.close()
        setup.close();bots.close()

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
