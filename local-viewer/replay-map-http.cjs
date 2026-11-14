// Serve the exact frozen map columns independently of Socket.IO heartbeats.
const {promisify} = require('node:util');
const gzip = promisify(require('node:zlib').gzip);

function mountReplayMaps(app, world, {cacheBytes = 16 * 1024 * 1024} = {}) {
  const cache = new Map();
  let bytes = 0;
  app.get('/api/replay-maps/:key/:index', async (req, res, next) => {
    const {key, index} = req.params;
    if (!/^[a-f0-9]{64}$/.test(key) || !/^(0|[1-9]\d*)$/.test(index)) return res.sendStatus(404);
    const chunk = world.mapChunk(key, Number(index));
    if (!chunk) return res.sendStatus(404);
    const compressed = Boolean(req.acceptsEncodings('gzip'));
    const identity = key + '-' + index;
    res.type('json').vary('Accept-Encoding');
    res.set('Cache-Control', 'private, max-age=86400, immutable');
    res.set('ETag', '"' + identity + (compressed ? '-gzip' : '-identity') + '"');
    if (req.fresh) return res.status(304).end();
    try {
      if (!compressed) return res.send(JSON.stringify(chunk));
      let data = cache.get(identity);
      if (data) { bytes -= data.length; cache.delete(identity); }
      else data = await gzip(JSON.stringify(chunk), {level: 3});
      // Concurrent requests may have populated the same entry while compressing.
      const previous = cache.get(identity);
      if (previous) { bytes -= previous.length; cache.delete(identity); }
      res.set('Content-Encoding', 'gzip');
      // Only completed buffers are cached; the retained cache has a byte bound.
      if (data.length <= cacheBytes) {
        cache.set(identity, data);
        bytes += data.length;
        while (bytes > cacheBytes || cache.size > 256) {
          const oldest = cache.keys().next().value;
          bytes -= cache.get(oldest).length;
          cache.delete(oldest);
        }
      }
      return res.send(data);
    } catch (error) { next(error); }
  });
}
module.exports = {mountReplayMaps};
