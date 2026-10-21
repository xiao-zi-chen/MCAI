// Optional publishing tool: record the actual local replay, never synthesize game outcomes.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.SKYDUEL_PLAYWRIGHT_MODULE||'playwright');
const id=process.argv[2],out=path.resolve(process.argv[3]||'runs/showcase-export');
if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Usage: node scripts/record-showcase.cjs <match-id> [output-directory]');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']}),errors=[];
 const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:out,size:{width:1600,height:900}}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3007/replays?match='+id+'&view=follow-red',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.querySelector('#play').disabled&&document.querySelector('#loading').hidden,{timeout:60000});
 await page.waitForTimeout(600);
 const started=Date.now();await page.getByRole('button',{name:'播放',exact:true}).click();
 let ended=false;
 while(!ended){
  await page.waitForTimeout(1000);
  const state=await page.evaluate(()=>({time:document.querySelector('#time').textContent,ended:document.querySelector('#play').textContent==='播放',index:Number(document.querySelector('#seek').value),max:Number(document.querySelector('#seek').max)}));
  ended=state.ended&&state.index===state.max;
  if((Date.now()-started)%30000<1200)console.log('Recording',state.time);
  if(Date.now()-started>35*60*1000)throw Error('Replay recording exceeded 35 minutes');
 }
 const elapsed=(Date.now()-started)/1000;
 await page.waitForTimeout(1000);const video=page.video();await context.close();
 const raw=await video.path(),end=Date.now();await browser.close();
 fs.writeFileSync(path.join(out,'recording.json'),JSON.stringify({match_id:id,raw:path.basename(raw),play_seconds:elapsed,tail_seconds:(end-started)/1000-elapsed,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log('Recorded',id,elapsed,'seconds');
})().catch(e=>{console.error(e);process.exit(1)});
