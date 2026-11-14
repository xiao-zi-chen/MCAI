// node --test scripts/check-replay-loading.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const vendor = createRequire(path.resolve(__dirname, '../local-viewer/package.json'));
const {mountReplayMaps} = require('../local-viewer/replay-map-http.cjs');
const {ReplayMapLoader} = require('../local-viewer/replay-map-loader.js');
const requests = require('../local-viewer/replay-request.js');
const {createAssetSender} = require('../local-viewer/viewer-asset-http.cjs');
const key = 'a'.repeat(64);
const column = index => ({x: index * 16, z: 0, chunk: JSON.stringify({blocks: [index, 1, 2]})});
const manifest = count => ({format: 1, key, count});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}
function raw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, {headers}, res => {
      const parts = [];
      res.on('data', data => parts.push(data));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(parts)}));
      res.on('error', reject);
    }).on('error', reject);
  });
}

test('renderer compression negotiates Brotli/gzip/identity and preserves the complete source', async t => {
  const app = vendor('express')(), send = createAssetSender();
  const original = Buffer.from('const value = "地图 and complete renderer bytes";\n'.repeat(1000));
  let reads = 0;
  app.get('/worker.js', (req, res, next) => send(req, res, next, 'worker', 'js', async () => {
    reads++; await pause(5); return original;
  }));
  const base = await listen(t, app);
  for (const [accept, encoding, decode] of [
    ['gzip, deflate, br, zstd', 'br', zlib.brotliDecompressSync], ['br;q=0,gzip', 'gzip', zlib.gunzipSync],
    ['br;q=0.5,gzip;q=1', 'gzip', zlib.gunzipSync],
    ['identity', undefined, value => value],
  ]) {
    const response = await raw(base + '/worker.js', {'Accept-Encoding': accept});
    assert.equal(response.headers['content-encoding'], encoding);
    assert.deepEqual(decode(response.body), original);
  }
  reads = 0;
  await Promise.all(Array.from({length: 4}, () => raw(base + '/worker.js', {'Accept-Encoding': 'br'})));
  assert.equal(reads, 0);
  assert.equal((await raw(base + '/worker.js', {'Accept-Encoding': '*;q=0,identity;q=0'})).status, 406);
});

test('concurrent asset loads share compression; failed reads and cache eviction recover', async t => {
  const app = vendor('express')(), send = createAssetSender({cacheEntries: 1});
  const reads = new Map();
  app.get('/:name', (req, res, next) => send(req, res, next, req.params.name, 'js', async () => {
    const key = req.params.name; reads.set(key, (reads.get(key) || 0) + 1);
    await pause(5);
    if (key === 'fail' && reads.get(key) === 1) throw Error('temporary fixture error');
    return key.repeat(100);
  }));
  app.use((_error, _req, res, _next) => res.status(503).end());
  const base = await listen(t, app), headers = {'Accept-Encoding': 'br'};
  await Promise.all(Array.from({length: 4}, () => raw(base + '/first', headers)));
  assert.equal(reads.get('first'), 1);
  await raw(base + '/second', headers);
  await raw(base + '/first', headers);
  assert.equal(reads.get('first'), 2);
  assert.equal((await raw(base + '/fail', headers)).status, 503);
  assert.equal((await raw(base + '/fail', headers)).status, 200);
});

test('HTTP map pages preserve every field with gzip, identity, HEAD and conditional caching', async t => {
  const app = vendor('express')();
  const chunks = [column(0), column(1), column(2)];
  mountReplayMaps(app, {mapChunk: (id, index) => id === key ? chunks[index] : null}, {cacheBytes: 160});
  const base = await listen(t, app);
  for (const index of [0, 1, 2, 0]) {
    const compressed = await raw(`${base}/api/replay-maps/${key}/${index}`, {'Accept-Encoding': 'gzip'});
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers['content-encoding'], 'gzip');
    assert.match(compressed.headers.vary, /Accept-Encoding/);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(compressed.body)), chunks[index]);
    const plain = await raw(`${base}/api/replay-maps/${key}/${index}`, {'Accept-Encoding': 'identity'});
    assert.deepEqual(JSON.parse(plain.body), chunks[index]);
    assert.notEqual(compressed.headers.etag, plain.headers.etag);
    const cached = await raw(`${base}/api/replay-maps/${key}/${index}`, {
      'Accept-Encoding': 'gzip', 'If-None-Match': compressed.headers.etag,
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
  }
  const head = await fetch(`${base}/api/replay-maps/${key}/0`, {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const suffix of [`${key}/-1`, `${key}/3`, `${key}/1.2`, `${key}/01`, `${'b'.repeat(64)}/0`, 'bad/0']) {
    assert.equal((await raw(`${base}/api/replay-maps/${suffix}`)).status, 404);
  }
});

test('frozen map identity comes from archive bytes; legacy and paged delivery use the same columns', t => {
  const {ReplayWorld} = require('../local-viewer/replay-world.cjs');
  const Chunk = vendor('prismarine-chunk')('1.21.1');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-replay-map-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.ok(resolved.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'mcai-replay-map-')));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  const rules = {map: {id: 'transport-fixture', surface_y: 64, teams: {}}};
  const world = new ReplayWorld({viewerRequire: vendor, directory, rules});
  const chunks = Array.from({length: 4}, (_, i) => ({x: i * 16, z: 0, chunk: new Chunk().toJson()}));
  const archive = zlib.gzipSync(JSON.stringify({version: '1.21.1', map_id: rules.map.id, chunks}));
  fs.writeFileSync(path.join(directory, world.key(rules) + '.json.gz'), archive);
  const snapshot = world.read(rules);
  assert.equal(snapshot.archiveKey, crypto.createHash('sha256').update(archive).digest('hex'));
  assert.deepEqual(world.mapChunk(snapshot.archiveKey, 3), chunks[3]);
  assert.equal(world.mapChunk(key, 0), null);
  assert.equal(world.mapChunk(snapshot.archiveKey, -1), null);
  const record = {match_id: 'fixture', rules, events: []};
  const run = pagedMap => {
    const events = [];
    world.stream({emit: (...args) => events.push(args)}, record, {pagedMap});
    return events;
  };
  const legacy = run(false), paged = run(true);
  assert.deepEqual(legacy.filter(e => e[0] === 'loadChunk').map(e => e[1]), chunks);
  assert.equal(paged.some(e => e[0] === 'loadChunk'), false);
  assert.deepEqual(paged.at(-1)[1].map_pages, {format: 1, key: snapshot.archiveKey, count: 4});
  const {map_pages, ...metadata} = paged.at(-1)[1];
  assert.deepEqual(metadata, legacy.at(-1)[1]);
});

test('map fetching is bounded, complete, and start calls share one operation', async () => {
  let active = 0, peak = 0;
  const applied = [];
  const loader = new ReplayMapLoader(manifest(9), {
    async load(url) { peak = Math.max(peak, ++active); await pause(5); active--; return column(Number(url.split('/').at(-1))); },
    apply: chunk => applied.push(chunk),
  });
  const first = loader.start();
  assert.equal(loader.start(), first);
  await first;
  assert.equal(peak, 2);
  assert.equal(loader.completed.size, 9);
  assert.deepEqual(applied.sort((a, b) => a.x - b.x), Array.from({length: 9}, (_, i) => column(i)));
});

test('transient failures retry once; manual recovery keeps already applied columns', async () => {
  const attempts = new Map(), applied = [];
  let broken = true;
  const loader = new ReplayMapLoader(manifest(5), {concurrency: 1,
    async load(url) {
      const index = Number(url.split('/').at(-1));
      attempts.set(index, (attempts.get(index) || 0) + 1);
      if (index === 2 && broken) throw TypeError('network interrupted');
      return column(index);
    }, apply: chunk => applied.push(chunk),
  });
  await assert.rejects(loader.start(), /network interrupted/);
  assert.equal(attempts.get(2), 2);
  assert.equal(loader.completed.size, 2);
  broken = false;
  await loader.start();
  assert.equal(attempts.get(0), 1);
  assert.equal(attempts.get(1), 1);
  assert.equal(loader.error, null);
  assert.equal(applied.length, 5);
});

test('close prevents a late old-match response from changing the renderer', async () => {
  let applied = 0;
  const loader = new ReplayMapLoader(manifest(2), {
    async load() { await pause(10); return column(0); }, apply: () => applied++,
  });
  const pending = loader.start();
  loader.close();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(applied, 0);
});

test('duplicate coordinates, malformed columns and unrecognized manifests never become ready', async () => {
  for (const broken of [{...manifest(2), key: '../x'}, {...manifest(2), count: 0}, {...manifest(2), format: 2}]) {
    assert.throws(() => new ReplayMapLoader(broken, {load() {}, apply() {}}));
  }
  for (const value of [column(0), {...column(0), x: 1}, {...column(0), chunk: null}]) {
    const loader = new ReplayMapLoader(manifest(2), {load: async () => value, apply() {}});
    await assert.rejects(loader.start(), /地图分段无效/);
    assert.ok(loader.completed.size < 2);
  }
});

test('HTTP errors are recoverable messages, and a 404 is not retried', async t => {
  const base = await listen(t, (_req, res) => { res.writeHead(404); res.end('<h1>Not found</h1>'); });
  let calls = 0;
  const loader = new ReplayMapLoader(manifest(1), {
    load: async url => { calls++; return requests.json(base + url); }, apply() {},
  });
  await assert.rejects(loader.start(), /404/);
  assert.equal(calls, 1);
});

test('continuous slow JSON is allowed beyond the idle timeout', async t => {
  const base = await listen(t, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.write('{"items":[');
    let count = 0;
    const timer = setInterval(() => {
      if (count === 6) { clearInterval(timer); res.end(']}'); }
      else res.write((count ? ',' : '') + count++);
    }, 30);
    res.on('close', () => clearInterval(timer));
  });
  assert.deepEqual(await requests.json(base, {idleMs: 150}), {items: [0, 1, 2, 3, 4, 5]});
});

test('stalled body, cancellation and oversized decoded responses stop reading', async t => {
  const base = await listen(t, (_req, res) => { res.write('{"value":'); });
  await assert.rejects(requests.json(base, {idleMs: 50}));
  const controller = new AbortController();
  const pending = requests.json(base, {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  const big = await listen(t, (_req, res) => res.end(JSON.stringify('x'.repeat(100))));
  await assert.rejects(requests.json(big, {maxBytes: 20}), /回放分段过大/);
});
