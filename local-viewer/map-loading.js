// Shared by the HTTP viewer and its browser loading indicator.
(function(root){
 function chunkBounds(map){return [Math.floor(map.build_min[0]/16),Math.floor(map.build_max[0]/16),Math.floor(map.build_min[2]/16),Math.floor(map.build_max[2]/16)];}
 function requiredChunks(map){const [x0,x1,z0,z1]=chunkBounds(map),keys=[];for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)keys.push(x*16+','+z*16);return keys;}
 function viewDistance(map){const x=Math.max(Math.abs(map.build_min[0]),Math.abs(map.build_max[0])),z=Math.max(Math.abs(map.build_min[2]),Math.abs(map.build_max[2]));const n=Math.max(6,Math.ceil(Math.hypot(x,z)/16)+2);if(n>16)throw Error('Map exceeds spectator coverage limit');return n;}
 function progress(required,loaded){return {loaded:required.filter(key=>loaded instanceof Set?loaded.has(key):Boolean(loaded?.[key])).length,total:required.length};}
 function complete(required,loaded,outstanding=0){const p=progress(required,loaded);return p.total>0&&p.loaded===p.total&&outstanding===0;}
 const api={chunkBounds,requiredChunks,viewDistance,progress,complete};if(typeof module==='object')module.exports=api;else root.MapLoading=api;
})(typeof window==='object'?window:globalThis);
