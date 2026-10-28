// 당첨번호 분석과 분석번호 생성. 파일·네트워크를 쓰지 않아 대시보드에서도 그대로 불러 쓴다.

/** 같은 시드면 같은 수열 (회차마다 분석번호가 고정되게) */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const band = (n) => Math.min(4, Math.floor((n - 1) / 10)); // 1~10, 11~20, 21~30, 31~40, 41~45

/** AC값: 서로 다른 차이값 개수 - 5 */
export function acValue(numbers) {
  const diffs = new Set();
  for (let i = 0; i < numbers.length; i += 1) {
    for (let j = i + 1; j < numbers.length; j += 1) diffs.add(Math.abs(numbers[i] - numbers[j]));
  }
  return diffs.size - (numbers.length - 1);
}

export function describeGame(numbers) {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const low = numbers.filter((n) => n <= 22).length;
  return { sum: sum(numbers), odd, even: 6 - odd, low, high: 6 - low, ac: acValue(numbers) };
}

function longestRun(sorted) {
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** 과거 당첨 분포에서 크게 벗어나지 않는 조합만 남긴다 */
export function passesFilters(numbers, pastSet) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const d = describeGame(sorted);
  if (d.sum < 100 || d.sum > 175) return false;
  if (d.odd < 2 || d.odd > 4) return false;
  if (d.low < 2 || d.low > 4) return false;
  if (d.ac < 7) return false;
  if (longestRun(sorted) > 2) return false;
  const bands = new Map();
  for (const n of sorted) bands.set(band(n), (bands.get(band(n)) ?? 0) + 1);
  if ([...bands.values()].some((c) => c > 3)) return false;
  if (pastSet?.has(sorted.join(","))) return false;
  return true;
}

function weightedPick(weights, count, rand, mustInclude = []) {
  const chosen = new Set(mustInclude);
  while (chosen.size < count) {
    const pool = range(1, 45).filter((n) => !chosen.has(n));
    const total = sum(pool.map((n) => weights[n]));
    let r = rand() * total;
    for (const n of pool) {
      r -= weights[n];
      if (r <= 0) {
        chosen.add(n);
        break;
      }
    }
    if (r > 0) chosen.add(pool[pool.length - 1]);
  }
  return [...chosen].sort((a, b) => a - b);
}

export function lottoStats(draws, recentCount = 20) {
  const all = Array(46).fill(0);
  const recent = Array(46).fill(0);
  const lastSeen = Array(46).fill(0);
  const recentFrom = draws.length - recentCount;
  draws.forEach((d, idx) => {
    for (const n of d.numbers) {
      all[n] += 1;
      if (idx >= recentFrom) recent[n] += 1;
      lastSeen[n] = d.round;
    }
  });
  const lastRound = draws.at(-1)?.round ?? 0;
  const gap = lastSeen.map((r, n) => (n === 0 ? 0 : lastRound - r));
  const byDesc = (arr) => range(1, 45).sort((a, b) => arr[b] - arr[a] || a - b);
  return {
    total: draws.length,
    recentCount,
    all,
    recent,
    gap,
    hot: byDesc(recent).slice(0, 8),
    cold: byDesc(recent).reverse().slice(0, 8),
    mostAll: byDesc(all).slice(0, 8),
    longAbsent: byDesc(gap).slice(0, 8)
  };
}

const STRATEGIES = [
  {
    key: "hot",
    name: "최근 흐름",
    summary: "최근 20회 자주 나온 번호에 무게",
    weights: (s) => range(0, 45).map((n) => (n === 0 ? 0 : 1 + s.recent[n] * 1.6))
  },
  {
    key: "cold",
    name: "반등 기대",
    summary: "오래 안 나온 번호와 최근 덜 나온 번호에 무게",
    weights: (s) => range(0, 45).map((n) => (n === 0 ? 0 : 1 + s.gap[n] / 4 + Math.max(0, 3 - s.recent[n])))
  },
  {
    key: "balance",
    name: "번호대 균형",
    summary: "1~45를 다섯 구간으로 나눠 고르게",
    weights: () => range(0, 45).map((n) => (n === 0 ? 0 : 1)),
    accept: (nums) => new Set(nums.map(band)).size >= 4
  },
  {
    key: "carry",
    name: "이월·이웃수",
    summary: "직전 회차 번호 1개와 그 이웃수(±1) 1개 포함",
    weights: (s) => range(0, 45).map((n) => (n === 0 ? 0 : 1 + s.recent[n] * 0.6)),
    seedNumbers: (s, draws, rand) => {
      const last = draws.at(-1)?.numbers ?? [];
      if (last.length === 0) return [];
      const carry = last[Math.floor(rand() * last.length)];
      const neighbors = last.flatMap((n) => [n - 1, n + 1]).filter((n) => n >= 1 && n <= 45 && !last.includes(n));
      const neighbor = neighbors[Math.floor(rand() * neighbors.length)];
      return neighbor ? [carry, neighbor] : [carry];
    }
  },
  {
    key: "blend",
    name: "종합",
    summary: "전체 출현 빈도·최근 흐름·미출현 기간을 함께 반영",
    weights: (s) => {
      const maxAll = Math.max(...s.all.slice(1));
      return range(0, 45).map((n) => (n === 0 ? 0 : 1 + (s.all[n] / maxAll) * 1.5 + s.recent[n] * 0.8 + s.gap[n] / 10));
    }
  }
];

function reasonFor(strategy, numbers, stats, draws) {
  const d = describeGame(numbers);
  const parts = [];
  const hot = numbers.filter((n) => stats.hot.includes(n));
  const absent = numbers.filter((n) => stats.longAbsent.includes(n) || stats.gap[n] >= 10);
  const last = draws.at(-1)?.numbers ?? [];
  const carry = numbers.filter((n) => last.includes(n));
  if (hot.length) parts.push(`최근 자주 나온 번호 ${hot.join(", ")}`);
  if (absent.length) parts.push(`오래 쉰 번호 ${absent.join(", ")}`);
  if (carry.length) parts.push(`이월수 ${carry.join(", ")}`);
  if (strategy.key === "balance") parts.push(`번호대 ${new Set(numbers.map(band)).size}구간 분산`);
  parts.push(`합계 ${d.sum}`, `홀짝 ${d.odd}:${d.even}`, `고저 ${d.low}:${d.high}`, `AC ${d.ac}`);
  return parts.join(" · ");
}

/** 다음 회차 분석번호 5게임과 리포트 */
export function analyzeLotto(draws, { seed } = {}) {
  const stats = lottoStats(draws);
  const nextRound = (draws.at(-1)?.round ?? 0) + 1;
  const pastSet = new Set(draws.map((d) => [...d.numbers].sort((a, b) => a - b).join(",")));
  const used = new Set();
  const baseSeed = seed ?? nextRound * 7919;
  const games = STRATEGIES.map((strategy, idx) => {
    const rand = seededRandom(baseSeed + idx * 104729);
    const weights = strategy.weights(stats);
    let numbers = null;
    for (let attempt = 0; attempt < 20000 && !numbers; attempt += 1) {
      const must = strategy.seedNumbers ? strategy.seedNumbers(stats, draws, rand) : [];
      const candidate = weightedPick(weights, 6, rand, must);
      const key = candidate.join(",");
      if (used.has(key) || !passesFilters(candidate, pastSet)) continue;
      if (strategy.accept && !strategy.accept(candidate)) continue;
      numbers = candidate;
    }
    numbers ??= weightedPick(weights, 6, rand);
    used.add(numbers.join(","));
    return {
      slot: "ABCDE"[idx],
      strategy: strategy.key,
      name: strategy.name,
      summary: strategy.summary,
      numbers,
      reason: reasonFor(strategy, numbers, stats, draws)
    };
  });
  const last = draws.at(-1);
  const sums = draws.slice(-20).map((d) => sum(d.numbers));
  return {
    product: "lotto",
    round: nextRound,
    basedOn: last ? { round: last.round, date: last.date } : null,
    games,
    stats: {
      hot: stats.hot,
      cold: stats.cold,
      mostAll: stats.mostAll,
      longAbsent: stats.longAbsent.map((n) => ({ n, gap: stats.gap[n] })),
      recentCount: stats.recentCount,
      recent: stats.recent,
      all: stats.all,
      recentSumAvg: sums.length ? Math.round(sum(sums) / sums.length) : null
    },
    report: [
      `1회부터 ${last?.round ?? 0}회까지 ${draws.length}회 당첨번호를 분석했습니다.`,
      `최근 ${stats.recentCount}회 자주 나온 번호는 ${stats.hot.slice(0, 5).join(", ")}, 덜 나온 번호는 ${stats.cold.slice(0, 5).join(", ")}입니다.`,
      `가장 오래 쉰 번호는 ${stats.longAbsent.slice(0, 3).map((n) => `${n}(${stats.gap[n]}회)`).join(", ")}입니다.`,
      `합계 100~175, 홀짝·고저 2:4~4:2, AC 7 이상, 3연번 제외, 역대 1등 조합 제외 기준으로 5게임을 골랐습니다.`
    ]
  };
}

export function pensionStats(draws, recentCount = 20) {
  const groups = Array(6).fill(0);
  const digits = Array.from({ length: 6 }, () => Array(10).fill(0));
  const recentDigits = Array.from({ length: 6 }, () => Array(10).fill(0));
  const recentFrom = draws.length - recentCount;
  draws.forEach((d, idx) => {
    groups[d.group] += 1;
    [...d.number].forEach((ch, pos) => {
      digits[pos][Number(ch)] += 1;
      if (idx >= recentFrom) recentDigits[pos][Number(ch)] += 1;
    });
  });
  const top = (arr) => range(0, 9).sort((a, b) => arr[b] - arr[a] || a - b);
  return {
    total: draws.length,
    recentCount,
    groups,
    digits,
    recentDigits,
    topDigits: digits.map((arr) => top(arr).slice(0, 3)),
    topRecentDigits: recentDigits.map((arr) => top(arr).slice(0, 3))
  };
}

/** 연금복권 분석번호 3개 (6자리) */
export function analyzePension(draws, { seed } = {}) {
  const stats = pensionStats(draws);
  const nextRound = (draws.at(-1)?.round ?? 0) + 1;
  const past = new Set(draws.flatMap((d) => [d.number, d.bonus]));
  const plans = [
    { key: "recent", name: "최근 흐름", summary: "최근 20회 자리별로 자주 나온 숫자에 무게", weight: (pos, dgt) => 1 + stats.recentDigits[pos][dgt] * 1.5 },
    { key: "all", name: "전체 빈도", summary: "1회부터 자리별 출현 빈도에 무게", weight: (pos, dgt) => stats.digits[pos][dgt] },
    { key: "even", name: "고르게", summary: "자리마다 같은 확률", weight: () => 1 }
  ];
  const picks = plans.map((plan, idx) => {
    const rand = seededRandom((seed ?? nextRound * 6007) + idx * 15485863);
    let number = "";
    for (let attempt = 0; attempt < 200; attempt += 1) {
      number = range(0, 5)
        .map((pos) => {
          const w = range(0, 9).map((dgt) => plan.weight(pos, dgt));
          let r = rand() * sum(w);
          for (let dgt = 0; dgt <= 9; dgt += 1) {
            r -= w[dgt];
            if (r <= 0) return dgt;
          }
          return 9;
        })
        .join("");
      if (!past.has(number)) break;
    }
    return { key: plan.key, name: plan.name, summary: plan.summary, number };
  });
  const last = draws.at(-1);
  return {
    product: "pension",
    round: nextRound,
    basedOn: last ? { round: last.round, date: last.date } : null,
    picks,
    stats,
    report: [
      `1회부터 ${last?.round ?? 0}회까지 ${draws.length}회 당첨번호를 자리별로 분석했습니다.`,
      `최근 ${stats.recentCount}회 자리별로 가장 많이 나온 숫자: ${stats.topRecentDigits.map((t) => t[0]).join(" ")}`,
      `조별 1등 횟수: ${range(1, 5).map((g) => `${g}조 ${stats.groups[g]}회`).join(", ")}`
    ]
  };
}

/** 로또 등수 (0 = 낙첨) */
export function lottoRank(numbers, draw) {
  const hit = numbers.filter((n) => draw.numbers.includes(n)).length;
  if (hit === 6) return 1;
  if (hit === 5 && numbers.includes(draw.bonus)) return 2;
  if (hit === 5) return 3;
  if (hit === 4) return 4;
  if (hit === 3) return 5;
  return 0;
}

/** 연금복권 등수. 'B' = 보너스, 0 = 낙첨 */
export function pensionRank(group, number, draw) {
  const num = String(number).padStart(6, "0");
  if (num === draw.number) return Number(group) === draw.group ? 1 : 2;
  if (num === draw.bonus) return "B";
  for (let len = 5; len >= 1; len -= 1) {
    if (num.slice(-len) === draw.number.slice(-len)) return 8 - len; // 끝 5자리=3등 … 끝 1자리=7등
  }
  return 0;
}

export const PENSION_PRIZE = { 1: "월 700만 원×20년", 2: "월 100만 원×10년", 3: 1000000, 4: 100000, 5: 50000, 6: 5000, 7: 1000, B: "월 100만 원×10년" };
