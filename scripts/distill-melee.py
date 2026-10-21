"""Collect real duels, then fit two public combat teachers into independent actors.

This is behavior cloning, not an assertion of self-discovered BedWars tactics.
The teachers use only the same 31 public/masked features as the demonstration.
"""
import argparse, hashlib, json, time
from pathlib import Path
from dataclasses import replace
import numpy as np
import torch
from stable_baselines3 import PPO
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.observations import flatten_snapshot
from mc_pvp_env.actions import curriculum_action_to_vector
from mc_pvp_env.protocol import JsonlClient
from importlib.util import spec_from_file_location, module_from_spec

ROOT=Path(__file__).resolve().parents[1]
def clean(obs):
    obs=obs.copy();obs[1]=obs[20]=1;obs[26:30]=0
    return obs

def teacher(obs,style):
    distance=obs[17]*20
    if distance>2.8:return 6
    strafe=7 if obs[12]>=0 else 8
    if style=='rush':
        if distance>2.2:return 5
        if obs[23] and obs[19]>.8 and distance>1.6:return 9
        return strafe
    if distance<1.85:return 10
    if distance>2.6:return 5
    return strafe

def request(client,kind,**fields):
    reply=client.request({'v':1,'id':f'bc-{time.time_ns()}','type':kind,**fields})
    if reply.get('type')=='error':raise RuntimeError(reply.get('error'))
    return reply

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--episodes',type=int,default=48);ap.add_argument('--output',type=Path,default=ROOT/'runs/showcase-v3');args=ap.parse_args()
    args.output.mkdir(parents=True,exist_ok=True);torch.set_num_threads(1)
    config=replace(EnvConfig.from_json(ROOT/'runs/worker_001/env.json'),combat_mode='health')
    plugin=JsonlClient(config.host,config.plugin_port,30,'bc');bots=JsonlClient(config.host,config.bot_port,30,'bots')
    features=[];episode_ids=[];duels=[];names=[config.self_name,config.opponent_name]
    prior=[PPO.load(ROOT/f'runs/showcase-v2/{name}.zip',device='cpu') for name in ['EmberAI','BastionAI']]
    env=None;start=time.monotonic()
    try:
        request(plugin,'register_players',arena_id=config.arena,players=names);request(bots,'spawn',bots=config.bot_specs());time.sleep(1)
        env=MinecraftPvpEnv(config)
        for episode in range(args.episodes):
            request(bots,'clear_controls');time.sleep(.2);env._episode_idx=episode//2
            _,info=env.reset(seed=3000+episode//2);snapshot=info['snapshot'];steps=0
            while True:
                actions=[]
                for side,name in enumerate(names):
                    obs=clean(flatten_snapshot(snapshot,name,names[1-side],config.max_episode_ticks));features.append(obs);episode_ids.append(episode)
                    style='rush' if (episode+side)%2==0 else 'fortify'
                    # Every third duel includes the previous model to broaden visited states.
                    if episode%3==2 and side==episode%2:action=int(prior[side].predict(obs,deterministic=True)[0])
                    else:action=teacher(obs,style)
                    if obs[17]*20>3.15:action=6
                    vector=curriculum_action_to_vector(action)
                    if obs[19]<.9:vector[7]=0
                    actions.append(vector)
                _,_,term,trunc,info=env._step_actions(*actions);snapshot=info['snapshot'];steps+=1
                if term or trunc:break
            row={'episode':episode,'steps':steps,'winner':snapshot.get('winner'),'reason':snapshot.get('done_reason')};duels.append(row);print(json.dumps(row),flush=True)
            (args.output/'collection-status.json').write_text(json.dumps({'episodes':len(duels),'target':args.episodes,'samples':len(features)}))
    finally:
        request(bots,'clear_controls');request(plugin,'cleanup',arena_id=config.arena)
        if env:env.close()
        plugin.close();bots.close()
    x=np.stack(features);ids=np.asarray(episode_ids);np.savez_compressed(args.output/'dataset.npz',observations=x,episode_ids=ids)
    # Whole episodes are held out, so adjacent states never cross the split.
    train=ids%5!=0;test=~train;tx=torch.tensor(x[train]);vx=torch.tensor(x[test]);results={}
    spec=spec_from_file_location('training',ROOT/'scripts/train-two-models.py');mod=module_from_spec(spec);spec.loader.exec_module(mod)
    for index,(name,style) in enumerate([('EmberAI','rush'),('BastionAI','fortify')]):
        torch.manual_seed(810+index);labels=np.asarray([teacher(obs,style) for obs in x]);ty=torch.tensor(labels[train]);vy=torch.tensor(labels[test])
        model=prior[index];params=list(model.policy.mlp_extractor.policy_net.parameters())+list(model.policy.action_net.parameters());optim=torch.optim.Adam(params,lr=.001)
        best=None;best_loss=float('inf')
        for epoch in range(140):
            for batch in torch.randperm(len(tx)).split(256):
                logits=model.policy.get_distribution(tx[batch]).distribution.logits
                loss=torch.nn.functional.cross_entropy(logits,ty[batch]);optim.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(params,1);optim.step()
            with torch.no_grad():
                vl=model.policy.get_distribution(vx).distribution.logits;loss=float(torch.nn.functional.cross_entropy(vl,vy))
                if loss<best_loss:best_loss=loss;best={k:v.clone() for k,v in model.policy.state_dict().items()}
        model.policy.load_state_dict(best)
        with torch.no_grad():accuracy=float((model.policy.get_distribution(vx).distribution.logits.argmax(1)==vy).float().mean())
        model.save(args.output/f'{name}.zip');mod.export_actor(model,args.output/f'{name}.json')
        results[name]={'teacher_profile':style,'validation_accuracy':accuracy,'validation_loss':best_loss,'actor_parameters':sum(p.numel() for p in params),'sha256':hashlib.sha256((args.output/f'{name}.json').read_bytes()).hexdigest()}
    manifest={'status':'complete','method':'behavior cloning of published combat teachers on real Minecraft observations','source':str(Path(__file__).relative_to(ROOT)),'teacher_source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'episodes':duels,'samples':len(x),'validation_split':'episode_id % 5 == 0','agents':results,'elapsed_seconds':time.monotonic()-start,'limitation':'Teacher agreement is not a win-rate measure. See separate paired live evaluation.'}
    (args.output/'training-status.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(results),flush=True)

if __name__=='__main__':main()
