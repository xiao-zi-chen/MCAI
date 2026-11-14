// Keep renderer bytes unchanged while avoiding repeated large bundle transfers.
const {promisify} = require('node:util');
const zlib = require('node:zlib');
const gzip = promisify(zlib.gzip), brotli = promisify(zlib.brotliCompress);

function createAssetSender({cacheBytes = 32 * 1024 * 1024, cacheEntries = 128, Negotiator = require('negotiator')} = {}) {
  const cache = new Map(), pending = new Map();
  let bytes = 0;
  function compressed(key, encoding, load) {
    const identity = encoding + ':' + key;
    const cached = cache.get(identity);
    if (cached) { cache.delete(identity); cache.set(identity, cached); return Promise.resolve(cached); }
    if (pending.has(identity)) return pending.get(identity);
    const job = Promise.resolve().then(load).then(data => encoding === 'br'
      ? brotli(data, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 6}})
      : gzip(data, {level: 3})).then(data => {
      if (data.length <= cacheBytes) {
        cache.set(identity, data); bytes += data.length;
        while (bytes > cacheBytes || cache.size > cacheEntries) {
          const oldest = cache.keys().next().value;
          bytes -= cache.get(oldest).length; cache.delete(oldest);
        }
      }
      return data;
    }).finally(() => pending.delete(identity));
    pending.set(identity, job);
    return job;
  }
  return function asset(req, res, next, key, type, load) {
    res.type(type).vary('Accept-Encoding');
    // Browsers usually list gzip first at the same quality. Prefer Brotli on ties.
    const encoding = new Negotiator(req).encoding(['br', 'gzip', 'identity'], ['br', 'gzip', 'identity']);
    if (!encoding) return res.sendStatus(406);
    const data = encoding === 'identity' ? Promise.resolve().then(load) : compressed(key, encoding, load);
    return data.then(body => {
      if (encoding !== 'identity') res.set('Content-Encoding', encoding);
      res.send(body);
    }).catch(next);
  };
}
module.exports = {createAssetSender};
