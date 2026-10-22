const {test}=require('node:test'),assert=require('node:assert/strict');
const {summarize,percentile}=require('./stress-scheduler.cjs');
test('a large queue or warmup cannot count as sustained target concurrency',()=>{const row={steady:false,active_arenas:4,actual_ai:8,gate:'open',metrics:{free_mb:2000,tps:20,mspt:2,tick_window:{count:100,p95_ms:4,max_ms:9}}};const result=summarize([row,{...row,steady:true,active_arenas:2,actual_ai:4},{...row,steady:true}],4);assert.equal(result.steady_full_samples,1);assert.equal(result.max_actual_ai,8);assert.equal(result.tick_window_p95_max_ms,4);assert.equal(result.tick_max_ms,9);});
test('sample percentiles are nearest rank and absent observations are not zero latency',()=>{assert.equal(percentile([], .95),null);assert.equal(percentile([1,9,3], .95),9);});

const {pressureReasons}=require('./stress-scheduler.cjs');
test('overload mode keeps all host protections while recording tick latency as a quality failure',()=>{
 const row={steady:true,metrics:{free_mb:9000,cgroup_free_mb:2000,tick_window:{p95_ms:90}},host_cpu_percent:70,disk_free_gb:40,control_age_ms:100};
 assert.deepEqual(pressureReasons(row,{min_free_mb:4096}),['tick_latency']);
 assert.deepEqual(pressureReasons(row,{min_free_mb:4096},{mode:'overload'}),[]);
 assert.deepEqual(pressureReasons({...row,metrics:{free_mb:3000,cgroup_free_mb:400},host_cpu_percent:90,disk_free_gb:5,control_age_ms:6000},{min_free_mb:4096},{mode:'overload'}),['host_memory','cgroup_memory','host_cpu','disk','control_stale']);
});

test('a second sampler cannot change capacity while the first is validating replays',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{benchmarkLock}=require('./stress-scheduler.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mcai-benchmark-')),file=path.join(dir,'coordinator.lock');
 const release=benchmarkLock(file);assert.throws(()=>benchmarkLock(file),/Another benchmark/);release();const next=benchmarkLock(file);release();assert.equal(fs.existsSync(file),true);next();fs.rmdirSync(dir);
});
