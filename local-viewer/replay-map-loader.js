(function(root) {
  class ReplayMapLoader {
    constructor(manifest, {load, apply, concurrency = 2}) {
      if (manifest?.format !== 1 || !/^[a-f0-9]{64}$/.test(manifest.key) ||
          !Number.isSafeInteger(manifest.count) || manifest.count < 1 ||
          !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('地图索引无效');
      this.manifest = manifest;
      this.load = load;
      this.apply = apply;
      this.concurrency = concurrency;
      this.completed = new Set();
      this.coordinates = new Set();
      this.closed = false;
      this.error = null;
      this.running = null;
    }
    start() {
      if (this.closed) return Promise.reject(new DOMException('Map closed', 'AbortError'));
      if (this.running) return this.running;
      this.error = null;
      const controller = this.controller = new AbortController();
      let next = 0;
      const worker = async () => {
        while (!controller.signal.aborted && next < this.manifest.count) {
          const index = next++;
          if (this.completed.has(index)) continue;
          let chunk;
          for (let attempt = 0; ; attempt++) {
            try {
              chunk = await this.load('/api/replay-maps/' + this.manifest.key + '/' + index, controller.signal);
              break;
            } catch (error) {
              if (controller.signal.aborted || error.retryable === false || error instanceof SyntaxError || attempt >= 1) throw error;
            }
          }
          if (controller.signal.aborted) return;
          if (!chunk || !Number.isSafeInteger(chunk.x) || !Number.isSafeInteger(chunk.z) ||
              chunk.x % 16 || chunk.z % 16 || typeof chunk.chunk !== 'string' ||
              this.coordinates.has(chunk.x + ',' + chunk.z)) throw Error('地图分段无效');
          this.apply(chunk);
          this.coordinates.add(chunk.x + ',' + chunk.z);
          this.completed.add(index);
        }
      };
      const guarded = async () => {
        try { await worker(); }
        catch (error) {
          if (!controller.signal.aborted) this.error = error;
          controller.abort();
          throw error;
        }
      };
      this.running = Promise.allSettled(Array.from({length: this.concurrency}, guarded)).then(() => {
        if (this.closed) throw new DOMException('Map closed', 'AbortError');
        if (this.error) throw this.error;
      }).finally(() => { this.running = null; });
      return this.running;
    }
    close() { this.closed = true; this.controller?.abort(); }
  }
  if (typeof module === 'object') module.exports = {ReplayMapLoader};
  else root.ReplayMapLoader = ReplayMapLoader;
})(typeof window === 'object' ? window : globalThis);
