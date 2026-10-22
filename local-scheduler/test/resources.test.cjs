const {test}=require('node:test'),assert=require('node:assert/strict');
const {hasHeadroom}=require('../resources.cjs');
test('shared-host and cgroup headroom are separate limits',()=>{const cfg={min_free_mb:4096,min_cgroup_free_mb:512};assert.equal(hasHeadroom({free_mb:12000,cgroup_free_mb:2000},cfg,256),true);assert.equal(hasHeadroom({free_mb:12000,cgroup_free_mb:600},cfg,256),false);assert.equal(hasHeadroom({free_mb:4200,cgroup_free_mb:2000},cfg,256),false);assert.equal(hasHeadroom({free_mb:12000},cfg,256),true);});
