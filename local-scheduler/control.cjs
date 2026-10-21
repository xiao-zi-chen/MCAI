const net=require('node:net');
class Control{
 constructor({host='127.0.0.1',port=25610,timeoutMs=20000}={}){this.host=host;this.port=port;this.timeoutMs=timeoutMs;this.seq=0;this.pending=new Map();}
 async connect(){if(this.socket&&!this.socket.destroyed)return;if(this.connecting)return this.connecting;
 this.connecting=new Promise((resolve,reject)=>{const socket=net.createConnection({host:this.host,port:this.port});this.socket=socket;let buffer='';socket.setNoDelay(true);
 const timer=setTimeout(()=>socket.destroy(Error('Control connect timeout')),this.timeoutMs);
 socket.once('connect',()=>{clearTimeout(timer);resolve()});socket.on('error',reject);
 socket.on('data',data=>{buffer+=data;if(buffer.length>2*1024*1024){socket.destroy(Error('Oversized control response'));return}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const r=JSON.parse(line),p=this.pending.get(r.id);if(p){this.pending.delete(r.id);clearTimeout(p.timer);r.ok?p.resolve(r.data):p.reject(Error(r.error));}}catch{}}});
 socket.on('close',()=>{clearTimeout(timer);if(this.socket===socket)this.socket=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Control connection lost'))}this.pending.clear();reject(Error('Control connection closed'))});
 }).finally(()=>this.connecting=null);return this.connecting;}
 async request(op,data={}){await this.connect();const id=String(++this.seq);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Control response timeout; reconcile before retry'))},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});this.socket.write(JSON.stringify({id,op,...data})+'\n');});}
 command(op,m,extra={}){return this.request(op,{arena_id:m.arena_id,task_id:m.id,token:m.token,...extra});}
 close(){this.socket?.destroy();}
}
module.exports={Control};
