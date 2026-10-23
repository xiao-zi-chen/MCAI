"""Train larger actors on recorded Minecraft observations, without a game or GPU.

Published combat teachers provide behavior-cloning labels. Validation holds out
whole source episodes. Agreement measures imitation, not match win rate.
"""
import os
for key in ['OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']:
    os.environ[key]='1'
import argparse,datetime,hashlib,json,time
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
DIMS=[31,512,512,64,11]


def teacher(x,profile):
    style=profile['style']
    distance=x[:,17]*20
    direction=x[:,12]*profile.get('strafe_sign',1)
    if profile.get('strafe_switch'):direction*=np.where(x[:,19]>.6,1,-1)
    y=np.where(direction>=0,7,8)
    if style=='rush':
        y=np.where((x[:,23]>.5)&(x[:,19]>profile.get('critical_cooldown',.8))&(distance>1.6),9,y)
        y=np.where(distance>profile.get('press_distance',2.2),5,y)
    else:
        y=np.where(distance<profile.get('retreat_distance',1.85),10,y)
        y=np.where(distance>2.6,5,y)
    y=np.where(distance>profile.get('approach_distance',2.8),6,y)
    y=np.where((x[:,0]<profile.get('retreat_health',0))&(distance<3.2),10,y)
    return y.astype(np.int64)


def forward(x,weights,biases):
    acts=[x]
    for i,(w,b) in enumerate(zip(weights,biases)):
        x=x@w.T+b
        if i<len(weights)-1:x=np.tanh(x)
        acts.append(x)
    return acts


def metrics(x,y,weights,biases):
    predictions=[];loss=0.
    for begin in range(0,len(x),512):
        output=forward(x[begin:begin+512],weights,biases)[-1]
        output-=output.max(axis=1,keepdims=True)
        probabilities=np.exp(output);probabilities/=probabilities.sum(axis=1,keepdims=True)
        labels=y[begin:begin+512]
        loss-=np.log(np.maximum(probabilities[np.arange(len(labels)),labels],1e-10)).sum()
        predictions.extend(probabilities.argmax(axis=1))
    return {'accuracy':float(np.mean(np.asarray(predictions)==y)),'cross_entropy':float(loss/len(y))}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'runs/trained-models')
    parser.add_argument('--profiles',type=Path)
    parser.add_argument('--epochs',type=int,default=100)
    parser.add_argument('--batch-size',type=int,default=256)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    source=np.load(args.dataset,allow_pickle=False)
    x=source['observations'].astype(np.float32);episodes=source['episode_ids']
    if x.ndim!=2 or x.shape[1]!=31 or len(x)!=len(episodes) or not np.isfinite(x).all():raise ValueError('Invalid recorded observation dataset')
    x[:,1]=x[:,20]=1;x[:,26:30]=0
    train=episodes%5!=0;valid=~train
    if train.sum()<1000 or valid.sum()<200:raise ValueError('Need independent episode validation data')
    manifest={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'behavior_cloning_on_recorded_minecraft_observations','architecture':DIMS,'dataset_sha256':hashlib.sha256(args.dataset.read_bytes()).hexdigest(),'source_episodes':len(np.unique(episodes)),'samples':len(x),'training_samples':int(train.sum()),'validation_samples':int(valid.sum()),'validation_split':'episode_id % 5 == 0','teacher':'published distance, facing, cooldown and grounded-state policy','source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'agents':{},'complete':False,'limitations':['Teacher agreement is not a win-rate measurement.','Team planning and safe movement are separate public controller logic.']}
    started=time.monotonic()
    profiles=json.loads(args.profiles.read_text(encoding='utf-8'))['profiles'] if args.profiles else [{'id':'EmberAI','style':'rush'},{'id':'BastionAI','style':'fortify'}]
    for index,profile in enumerate(profiles):
        name,style=profile['id'],profile['style']
        rng=np.random.default_rng(profile.get('seed',20261023+index))
        weights=[(rng.normal(size=(b,a))*np.sqrt(2/(a+b))).astype(np.float32) for a,b in zip(DIMS[:-1],DIMS[1:])]
        biases=[np.zeros(b,np.float32) for b in DIMS[1:]]
        params=[*weights,*biases];moments=[np.zeros_like(v) for v in params];variances=[np.zeros_like(v) for v in params]
        tx=x[train];vx=x[valid];ty=teacher(tx,profile);vy=teacher(vx,profile)
        before=metrics(vx,vy,weights,biases);best=None;best_score=float('inf');step=0;history=[]
        for epoch in range(args.epochs):
            order=rng.permutation(len(tx))
            for begin in range(0,len(order),args.batch_size):
                batch=order[begin:begin+args.batch_size];obs=tx[batch].copy();labels=ty[batch]
                acts=forward(obs,weights,biases);output=acts[-1]
                shifted=output-output.max(axis=1,keepdims=True);prob=np.exp(shifted);prob/=prob.sum(axis=1,keepdims=True)
                grad=prob;grad[np.arange(len(batch)),labels]-=1;grad/=len(batch)
                gw=[None]*len(weights);gb=[None]*len(biases)
                for layer in range(len(weights)-1,-1,-1):
                    gw[layer]=grad.T@acts[layer]+1e-5*weights[layer];gb[layer]=grad.sum(axis=0)
                    if layer:grad=(grad@weights[layer])*(1-acts[layer]**2)
                gradients=[*gw,*gb];norm=np.sqrt(sum(float(np.sum(g*g)) for g in gradients));scale=min(1.,1./max(norm,1e-10));step+=1
                rate=.0007*(.3+.7*(1-epoch/max(args.epochs,1)))
                for param,g,m,v in zip(params,gradients,moments,variances):
                    g*=scale;m*=.9;m+=.1*g;v*=.999;v+=.001*g*g
                    param-=rate*(m/(1-.9**step))/(np.sqrt(v/(1-.999**step))+1e-8)
            score=metrics(vx,vy,weights,biases)
            if score['cross_entropy']<best_score:
                best_score=score['cross_entropy'];best=([w.copy() for w in weights],[b.copy() for b in biases],epoch+1,score)
            if epoch%10==0 or epoch==args.epochs-1:
                row={'model':name,'epoch':epoch+1,**score};history.append(row);print(json.dumps(row),flush=True)
                (args.output/'training-progress.json').write_text(json.dumps({'current':row,'elapsed_seconds':time.monotonic()-started}))
        weights,biases,best_epoch,score=best
        if score['accuracy']<.94:raise RuntimeError(name+' failed held-out teacher-agreement threshold')
        parameter_count=sum(w.size+b.size for w,b in zip(weights,biases))
        raw=b''.join(w.astype('<f4').tobytes()+b.astype('<f4').tobytes() for w,b in zip(weights,biases))
        if len(raw)<1024*1024:raise RuntimeError('Actual trained parameters must exceed one MiB')
        binary=args.output/(name+'.f32');binary.write_bytes(raw)
        layers=[]
        for i,(w,b) in enumerate(zip(weights,biases)):
            layers.append({'type':'linear','input_size':int(w.shape[1]),'output_size':int(w.shape[0])})
            if i<len(weights)-1:layers.append({'type':'tanh'})
        actor={'input_size':31,'action_count':11,'model_version':'squads-bc-512-20261023','profile':profile,'parameter_count':int(parameter_count),'parameter_bytes':len(raw),'weights_sha256':hashlib.sha256(raw).hexdigest(),'parameter_encoding':'f32-le','parameter_file':binary.name,'layers':layers}
        file=args.output/(name+'.json');file.write_text(json.dumps(actor,separators=(',',':')))
        fixture_x=vx[:32];fixture={'features':fixture_x.tolist(),'logits':forward(fixture_x,weights,biases)[-1].tolist()}
        (args.output/(name+'.fixtures.json')).write_text(json.dumps(fixture,separators=(',',':')))
        manifest['agents'][name]={'style':style,'profile':profile,'parameters':int(parameter_count),'parameter_bytes':len(raw),'json_bytes':file.stat().st_size,'json_sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'weights_sha256':hashlib.sha256(raw).hexdigest(),'before_training':before,'validation':score,'best_epoch':best_epoch,'optimizer_steps':step,'history':history}
        (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2))
    manifest['complete']=True;manifest['elapsed_seconds']=time.monotonic()-started
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2));print('TRAINING_COMPLETE',flush=True)


if __name__=='__main__':main()
