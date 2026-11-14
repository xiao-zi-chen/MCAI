(function(root) {
  // A slow but active download must not fail at a fixed twenty-second deadline.
  async function readJson(url, {signal, idleMs = 20000, maxBytes = 64 * 1024 * 1024, fetcher = fetch} = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once: true});
    let timer, reader, complete = false;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new DOMException('读取超时，请重试', 'TimeoutError')), idleMs);
    };
    touch();
    try {
      const response = await fetcher(url, {signal: controller.signal});
      reader = response.body.getReader();
      const parts = [], decoder = new TextDecoder();
      let bytes = 0;
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        touch();
        bytes += value.byteLength;
        if (bytes > maxBytes) throw Error('回放分段过大');
        parts.push(decoder.decode(value, {stream: true}));
      }
      parts.push(decoder.decode());
      complete = true;
      let data;
      try { data = JSON.parse(parts.join('')); }
      catch (error) { if (response.ok) throw error; data = {}; }
      return {response, data};
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!complete) { controller.abort(); await reader?.cancel().catch(() => {}); }
      reader?.releaseLock();
    }
  }
  async function json(url, options) {
    const {response, data} = await readJson(url, options);
    if (!response.ok) {
      const error = Error('读取比赛失败（' + response.status + '）');
      error.retryable = response.status >= 500 || response.status === 429;
      throw error;
    }
    return data;
  }
  const api = {readJson, json};
  if (typeof module === 'object') module.exports = api;
  else root.ReplayRequest = api;
})(typeof window === 'object' ? window : globalThis);
