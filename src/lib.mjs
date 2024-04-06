import { defaultSamples, defaultTime, limits } from './constants.mjs';
import { runtime } from './runtime.mjs';
import { now } from './time.mjs';

export const AsyncFunction = (async () => {}).constructor;
const GeneratorFunction = function* () {}.constructor;
const AsyncGeneratorFunction = async function* () {}.constructor;

export const version = (() => {
  return {
    unknown: () => '',
    browser: () => '',
    node: () => process.version,
    deno: () => Deno.version.deno,
    bun: () => process.versions.bun,
  }[runtime]();
})();

export const os = (() => {
  return {
    unknown: () => 'unknown',
    browser: () => 'unknown',
    node: () => `${process.arch}-${process.platform}`,
    deno: () => Deno.build.target,
    bun: () => `${process.arch}-${process.platform}`,
  }[runtime]();
})();

export const cpu = await (async () => {
  return await {
    unknown: () => 'unknown',
    browser: () => 'unknown',
    node: async () => (await import('node:os')).cpus()[0].model,
    deno: async () => {
      try {
        const os = await import('node:os');
        if (os?.cpus?.()?.[0]?.model) return os.cpus()[0].model;
      } catch {}

      return 'unknown';
    },
    bun: async () => {
      try {
        const os = await import('node:os');
        if (os?.cpus?.()?.[0]?.model) return os.cpus()[0].model;
      } catch {}

      return 'unknown';
    },
  }[runtime]();
})();

export const noColor = (() => {
  return {
    unknown: () => false,
    browser: () => true,
    node: () => !!process.env.NO_COLOR,
    deno: () => Deno.noColor,
    bun: () => !!process.env.NO_COLOR,
  }[runtime]();
})();

export const checkBenchmarkArgs = (fn, opts = {}) => {
  if (![Function, AsyncFunction].includes(fn.constructor))
    throw new TypeError(`expected function, got ${fn.constructor.name}`);
  if (
    opts.before != null &&
    ![Function, AsyncFunction].includes(opts.before.constructor)
  )
    throw new TypeError(
      `expected function, got ${opts.before.constructor.name}`,
    );
  if (
    opts.before != null &&
    ![Function, AsyncFunction].includes(opts.after.constructor)
  )
    throw new TypeError(
      `expected function, got ${opts.after.constructor.name}`,
    );
};

export function mergeDeepRight(target, source) {
  const targetClone = structuredClone(target);

  for (const key in source) {
    if (Object.prototype.toString.call(target[key]).slice(8, -1) === 'Object') {
      if (
        Object.prototype.toString.call(target[key]).slice(8, -1) === 'Object'
      ) {
        targetClone[key] = mergeDeepRight(target[key], source[key]);
      } else {
        targetClone[key] = source[key];
      }
    } else {
      targetClone[key] = source[key];
    }
  }

  return targetClone;
}

export async function measure(fn, before, after, opts = {}) {
  if (
    ![
      Function,
      AsyncFunction,
      GeneratorFunction,
      AsyncGeneratorFunction,
    ].includes(fn.constructor)
  )
    throw new TypeError(
      `expected function or generator, got ${fn.constructor.name}`,
    );
  if ([GeneratorFunction, AsyncGeneratorFunction].includes(fn.constructor))
    throw new Error('generator is not supported yet');
  if (![Function, AsyncFunction].includes(before.constructor))
    throw new TypeError(`expected function, got ${before.constructor.name}`);
  if (![Function, AsyncFunction].includes(after.constructor))
    throw new TypeError(`expected function, got ${after.constructor.name}`);

  // biome-ignore lint/style/noParameterAssign: <explanation>
  opts = mergeDeepRight(
    {
      async: AsyncFunction === fn.constructor,
      time: defaultTime,
      warmup: true,
      samples: defaultSamples,
    },
    opts,
  );

  const generator = [GeneratorFunction, AsyncGeneratorFunction].includes(
    fn.constructor,
  );

  const t0 = now();
  !opts.async ? fn() : await fn();
  const benchmarkTime = now() - t0;

  if (opts.samples.warmup === 0 || benchmarkTime > limits.benchmark) {
    opts.warmup = false;
  }

  const asyncBefore = AsyncFunction === before.constructor;
  const asyncAfter = AsyncFunction === after.constructor;

  const benchmark = new (!opts.async ? Function : AsyncFunction)(
    '$fn',
    '$before',
    '$after',
    '$now',
    `
    let $w = ${benchmarkTime};

    const quantile = (arr, q) => {
      const base = (arr.length - 1) * q;
      const baseIndex = Math.floor(base);
      if (arr[baseIndex + 1] != null) {
        return (
          arr[baseIndex] +
          (base - baseIndex) * (arr[baseIndex + 1] - arr[baseIndex])
        );
      } else {
        return arr[baseIndex];
      }
    };

    ${
      !opts.warmup
        ? ''
        : `warmup: {
            const samples = new Array();

            ${asyncBefore ? 'await' : ''} $before();
            for (let i = 0; i < ${opts.samples.warmup - 1}; i++) {
              const t0 = $now();
              ${!opts.async ? '' : 'await'} $fn();
              const t1 = $now();

              samples.push(t1 - t0);
            }
            ${asyncAfter ? 'await' : ''} $after();

            samples.sort((a, b) => a - b);
            $w = quantile(samples, .5);
          }`
    }

    let micro = false;
    let s = 0;
    let samples = new Array();

    if ($w > ${limits.warmup}) {
      ${asyncBefore ? 'await' : ''} $before();
      while (s < ${opts.time} || ${opts.samples.benchmark} > samples.length) {
        const t0 = $now();
        ${!opts.async ? '' : 'await'} $fn();
        const t1 = $now();

        s += samples[samples.push(t1 - t0) - 1];
      }
      ${asyncAfter ? 'await' : ''} $after();
    } else {
      micro = true;
      ${asyncBefore ? 'await' : ''} $before();
      while (s < ${opts.time} || ${opts.samples.benchmark} > samples.length) {
        const t0 = $now();
        for (let i = 0; i < 256; i++) {
          ${`${!opts.async ? '' : 'await'} $fn();\n`.repeat(8)}
        }
        const t1 = $now();

        s += t1 - t0;
        samples.push((t1 - t0) / 2048);
      }
      ${asyncAfter ? 'await' : ''} $after();
    }

    const rawSamples = samples.slice();
    const rawAvg = rawSamples.reduce((a, b) => a + b, 0) / rawSamples.length;
    const rawStd = Math.sqrt(rawSamples.reduce((a, b) => a + (b - rawAvg) ** 2, 0) / (rawSamples.length - 1));

    samples.sort((a, b) => a - b);

    const q1 = quantile(samples, .25);
    const q3 = quantile(samples, .75);
    const iqr = q3 - q1;
    const l = q1 - 1.5 * iqr;
    const h = q3 + 1.5 * iqr;
    samples = samples.filter(v => v >= l && v <= h);

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const std = Math.sqrt(samples.reduce((a, b) => a + (b - avg) ** 2, 0) / (samples.length - 1));

    return {
      // samples,
      // rawSamples,
      micro,
      min: samples[0],
      max: samples[samples.length - 1],
      p50: quantile(samples, .5),
      p75: quantile(samples, .75),
      p99: quantile(samples, .99),
      p999: quantile(samples, .999),
      avg,
      std,
      rawAvg,
      rawStd,
    };
  `,
  );

  const stats = !opts.async
    ? benchmark(fn, before, after, now)
    : await benchmark(fn, before, after, now);
  return { stats, async: opts.async, warmup: opts.warmup, generator };
}
