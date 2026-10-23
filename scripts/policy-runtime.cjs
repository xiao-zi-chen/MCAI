// Shared, cached numeric actors. File reads and compilation happen once per model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const models=new Map(),compiled=new WeakMap();
function compile(model){
 if(compiled.has(model))return compiled.get(model);
 let size=model.input_size,parameters=0;const layers=[],digest=crypto.createHash('sha256');
 for(const layer of model.layers){
  if(layer.type==='linear'){
   if(!Array.isArray(layer.weight)||!(Array.isArray(layer.bias)||layer.bias instanceof Float32Array)||layer.weight.length!==layer.bias.length||!layer.bias.length)throw Error('Invalid actor layer');
   const out=layer.bias.length,w=new Float32Array(out*size),b=Float32Array.from(layer.bias);
   for(let r=0;r<out;r++){if(layer.weight[r].length!==size)throw Error('Actor layer shape mismatch');w.set(layer.weight[r],r*size);}
   if(!w.every(Number.isFinite)||!b.every(Number.isFinite))throw Error('Actor parameters must be finite');
   digest.update(Buffer.from(w.buffer));digest.update(Buffer.from(b.buffer));parameters+=w.length+b.length;
   layers.push({type:'linear',input:size,output:out,w,b});size=out;
  }else if(['tanh','relu'].includes(layer.type))layers.push({type:layer.type});
  else throw Error('Unknown actor layer');
 }
 if(size!==model.action_count)throw Error('Actor output shape mismatch');
 if(model.parameter_count!=null&&model.parameter_count!==parameters)throw Error('Actor parameter count mismatch');
 const sha256=digest.digest('hex');if(model.weights_sha256&&model.weights_sha256!==sha256)throw Error('Actor weight checksum mismatch');
 const result={layers,parameters,parameter_bytes:parameters*4,sha256};compiled.set(model,result);return result;
}
function loadModel(file){
 const key=path.resolve(file);if(models.has(key))return models.get(key);
 const model=JSON.parse(fs.readFileSync(key,'utf8'));
 if(model.parameter_encoding==='f32-le'){
  const name=model.parameter_file;
  if(typeof name!=='string'||!/^[-A-Za-z0-9_]+\.f32$/.test(name))throw Error('Invalid actor parameter filename');
  const raw=fs.readFileSync(path.join(path.dirname(key),name));
  if(raw.length!==model.parameter_bytes||raw.length%4)throw Error('Actor parameter byte count mismatch');
  const values=new Float32Array(raw.length/4);for(let i=0;i<values.length;i++)values[i]=raw.readFloatLE(i*4);
  const shapes=model.layers;let offset=0,size=model.input_size;
  model.layers=shapes.map(layer=>{
   if(layer.type!=='linear')return layer;
   const output=layer.output_size;if(!Number.isSafeInteger(output)||output<1||layer.input_size!==size||offset+(size+1)*output>values.length)throw Error('Actor layer shape mismatch');
   const weight=Array.from({length:output},(_,r)=>values.subarray(offset+r*size,offset+(r+1)*size));offset+=size*output;
   const bias=values.subarray(offset,offset+output);offset+=output;size=output;
   return {type:'linear',weight,bias};
  });
  if(offset!==values.length)throw Error('Unused actor parameters');
  compile(model);model.layers=shapes; // Only compiled numeric weights stay resident.
 }else if(model.parameter_encoding)throw Error('Unknown actor parameter encoding');
 else compile(model);
 models.set(key,model);return model;
}
function logits(model,features){
 if(features.length!==model.input_size||!features.every(Number.isFinite))throw Error('Invalid actor input');
 let x=features;
 for(const layer of compile(model).layers){
  if(layer.type==='linear'){
   const next=new Float64Array(layer.output);
   for(let r=0;r<layer.output;r++){let sum=layer.b[r],offset=r*layer.input;for(let c=0;c<layer.input;c++)sum+=layer.w[offset+c]*x[c];next[r]=sum;}x=next;
  }else if(layer.type==='tanh')x=x.map(Math.tanh);
  else x=x.map(v=>Math.max(0,v));
 }
 return Array.from(x);
}
module.exports={loadModel,compile,logits};
