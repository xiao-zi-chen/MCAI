import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getQuickJS } from 'quickjs-emscripten';

const root = new URL('./', import.meta.url);
const source = fs.readFileSync(new URL('model-demo/policy-core.js', root), 'utf8');
const fixtures = JSON.parse(fs.readFileSync(new URL('model-demo/fixtures.json', root), 'utf8'));
const QuickJS = await getQuickJS();
const runtime = QuickJS.newRuntime();
runtime.setMemoryLimit(128 * 1024 * 1024);
runtime.setMaxStackSize(1024 * 1024);
const context = runtime.newContext();
let deadline = performance.now() + 2000;
runtime.setInterruptHandler(() => performance.now() > deadline);
function evaluate(code, budget = 20) {
  deadline = performance.now() + budget;
  const result = context.evalCode(code);
  if (result.error) {
    const error = context.dump(result.error); result.error.dispose();
    throw new Error(JSON.stringify(error));
  }
  try { return context.dump(result.value); } finally { result.value.dispose(); }
}
try {
  evaluate(source, 2000);
  let maxError = 0;
  for (let i = 0; i < fixtures.features.length; i++) {
    const actual = evaluate(`policyLogits(${JSON.stringify(fixtures.features[i])})`);
    maxError = Math.max(maxError, ...actual.map((v, j) => Math.abs(v - fixtures.logits[i][j])));
    if (maxError > 0.00002) throw new Error(`Numerical mismatch: ${maxError}`);
    const chosen = actual.indexOf(Math.max(...actual));
    const expected = fixtures.logits[i].indexOf(Math.max(...fixtures.logits[i]));
    if (chosen !== expected) throw new Error(`Action mismatch in fixture ${i}`);
  }
  evaluate(`const BENCH_FEATURES = ${JSON.stringify(fixtures.features)};`, 2000);
  for (let i = 0; i < 20; i++) evaluate(`inferFeatures(BENCH_FEATURES[${i % 32}])`);
  const times = [];
  for (let i = 0; i < 500; i++) {
    const start = performance.now();
    evaluate(`inferFeatures(BENCH_FEATURES[${i % 32}])`);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const report = {
    runtime: 'quickjs-emscripten 0.32.0 / Node ' + process.version,
    scope: 'Synthetic features; model core only, no Minecraft and no live AGX runner',
    parameters: fixtures.parameters,
    source_bytes: Buffer.byteLength(source),
    numerical_cases: fixtures.features.length,
    matching_action_cases: fixtures.features.length,
    max_abs_logit_error: maxError,
    iterations: times.length,
    mean_ms: times.reduce((a, b) => a + b, 0) / times.length,
    median_ms: times[Math.floor(times.length / 2)],
    p95_ms: times[Math.ceil(times.length * 0.95) - 1],
  };
  fs.writeFileSync(new URL('../runs/js-policy-probe.json', root), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { context.dispose(); runtime.dispose(); }
