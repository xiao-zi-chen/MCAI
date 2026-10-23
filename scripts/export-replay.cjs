// Optional presentation exporter. Uses an existing Chrome debugging endpoint
// and FFmpeg; neither is part of the Minecraft/agent training runtime.
// Usage: node scripts/export-replay.cjs <match-id> <output.mp4>
// REPLAY_BASE_URL, REPLAY_CDP_URL, FFMPEG, EXPORT_FPS, EXPORT_WIDTH,
// EXPORT_HEIGHT and EXPORT_SECONDS can be set for other local installations.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {once}=require('node:events');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const id=process.argv[2],output=path.resolve(process.argv[3]||'');
 if(!/^[a-f0-9-]{36}$/.test(id||'')||!output.endsWith('.mp4'))throw Error('Specify a match ID and an MP4 output path');
 if(fs.existsSync(output))throw Error('Output already exists: '+output);
 const cdp=process.env.REPLAY_CDP_URL||'http://127.0.0.1:19329',base=process.env.REPLAY_BASE_URL||'http://127.0.0.1:3028';
 const fps=Number(process.env.EXPORT_FPS||25),width=Number(process.env.EXPORT_WIDTH||1600),height=Number(process.env.EXPORT_HEIGHT||900);
 if(![fps,width,height].every(v=>Number.isInteger(v)&&v>0)||width%2||height%2)throw Error('Invalid frame rate or dimensions');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const target=await fetch(cdp+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map(),errors=[];let seq=0,encoder,finished=false;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},90000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 try{
  await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:base+'/replays?match='+encodeURIComponent(id)+'&autoplay=0&view=auto'});
  let state;for(let n=0;n<180;n++){await sleep(1000);state=await evaluate(`({ready:typeof ready==='boolean'&&ready,actors:document.querySelector('#scene')?.contentWindow?.localView?.actorMeshes?.size,loading:document.querySelector('#loading')?.textContent})`);if(n%15===0)console.log(JSON.stringify(state));if(state.ready&&state.actors===16)break;}
  if(!state?.ready||state.actors!==16)throw Error('Replay scene did not become ready');
  // Advance the recorded game clock explicitly. Slow encoding or the network
  // cannot insert buffering screens, omit match time, or alter its duration.
  await evaluate(`window.requestAnimationFrame=()=>0;playing=false;true`);await sleep(150);
  const duration=await evaluate(`(()=>{
   const style=document.createElement('style');style.textContent='.side{padding:14px 16px}.roster-team{margin:6px 0}.roster-team summary{padding:5px 10px}.actor-card{grid-template-columns:minmax(0,1fr) auto;gap:2px;margin:0 7px 2px;padding:2px 7px;line-height:1.4;align-items:center}.actor-card strong{font-size:11px}.actor-card small,.actor-card p{display:none}.actor-card span{grid-column:auto;font-size:10px;white-space:nowrap}.replay-summary{padding-bottom:4px}#result{margin-bottom:8px;padding:9px 12px}.side h3{margin:9px 0 2px}#events p{padding:4px 0}';document.head.append(style);
   document.querySelectorAll('.roster-team').forEach(e=>e.open=true);
   window.__exportTimeBase=performance.now();camera.lastTime=__exportTimeBase;camera.lastAuto=0;camera.lastCollision=0;camera.snap=true;
   window.__exportFrame=async seconds=>{
    let wanted=index;while(wanted+1<record.frame_count&&record.frame_ticks[wanted+1]/20<=seconds)wanted++;
    await pages.ensure(wanted);if(wanted+1<record.frame_count&&!frameAt(wanted+1))await pages.page(Math.floor((wanted+1)/record.chunk_size));
    index=wanted;clock=Math.min(seconds,record.duration_ticks/20);
    if(lastDraw!==index){drawFrame();lastDraw=index;}
    const mode=seconds<5?'side':'auto';if(camera.mode!==mode)camera.setMode(mode);
    drawActors();camera.tick(__exportTimeBase+seconds*1000);loading.hidden=true;play.textContent='暂停';
    // Wait until the iframe has painted the updated WebGL scene.
    await new Promise(resolve=>scene.contentWindow.requestAnimationFrame(resolve));
    return {tick:frameAt(index).tick,index,heap_mb:performance.memory?.usedJSHeapSize/1048576};
   };
   return record.duration_ticks/20;
  })()`);
  const seconds=Math.min(duration,Number(process.env.EXPORT_SECONDS||duration)),frames=Math.ceil(seconds*fps);
  const temporary=output.replace(/\.mp4$/i,'.partial.mp4');if(fs.existsSync(temporary))throw Error('Partial export already exists: '+temporary);
  const log=fs.openSync(output.replace(/\.mp4$/i,'.ffmpeg.log'),'w');
  encoder=spawn(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','warning','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-an','-vf','scale=in_range=pc:out_range=tv,format=yuv420p','-c:v','libx264','-threads','2','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-color_range','tv','-movflags','+faststart','-t',String(seconds),'-n',temporary],{windowsHide:true,stdio:['pipe','ignore',log]});fs.closeSync(log);
  let pipeError;encoder.stdin.on('error',e=>{pipeError=e});const encoderExit=once(encoder,'close');
  const started=Date.now();let lastReport=0;
  for(let n=0;n<frames;n++){
   if(pipeError||encoder.exitCode!==null)throw pipeError||Error('FFmpeg stopped early');
   state=await evaluate('__exportFrame('+(n===frames-1?seconds:Math.min(duration,n/fps))+')');
   const shot=await call('Page.captureScreenshot',{format:'jpeg',quality:88,fromSurface:true,captureBeyondViewport:false});
   const data=Buffer.from(shot.data,'base64');if(!encoder.stdin.write(data))await once(encoder.stdin,'drain');
   if(n===0)fs.writeFileSync(output.replace(/\.mp4$/i,'.preview.jpg'),data);
   if(n===0||Date.now()-lastReport>15000||n===frames-1){lastReport=Date.now();console.log(JSON.stringify({frame:n+1,total:frames,match_seconds:n/fps,wall_seconds:(Date.now()-started)/1000,...state}));}
   if(errors.length)throw Error(errors.join('\n'));
  }
  encoder.stdin.end();const [code]=await encoderExit;if(code!==0)throw Error('FFmpeg exited '+code);
  fs.renameSync(temporary,output);finished=true;
  const report={match_id:id,file:output,seconds,fps,width,height,frames,wall_seconds:(Date.now()-started)/1000,bytes:fs.statSync(output).size,last_frame:state,errors};
  fs.writeFileSync(output.replace(/\.mp4$/i,'.recording.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{
  if(encoder&&!finished&&encoder.exitCode===null)encoder.kill();
  await call('Page.close').catch(()=>{});ws.close();for(const p of pending.values())clearTimeout(p.timer);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
