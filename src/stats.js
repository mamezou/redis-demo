export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// nearest-rank 法: n 件のうち ceil(p/100 * n) 番目 (5 回なら最大値)
export function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * s.length) - 1);
  return s[idx];
}

// fn を runs 回実行し、各回の所要時間 (ms) を performance.now() で計測する。
// before は計測対象外の前処理 (データのリセットなど)
export async function measure(fn, { runs = 5, before } = {}) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    if (before) await before();
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return { samples, median: median(samples), p95: percentile(samples, 95) };
}

export function fmtMs(ms) {
  return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2);
}
