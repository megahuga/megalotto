// 설정(config/settings.json) → 이번 주 살 번호

export const LOTTO_SLOT_MODES = ["analysis", "auto", "random", "saved"];
export const PENSION_MODES = ["sameAuto", "sameAnalysis", "sameSaved", "auto5"];
export const LOTTO_MAX_GAMES = 5; // 인터넷 구매 한도: 회차당 5천 원
export const PENSION_MAX_TICKETS = 5; // 주 1만 원 = 로또 5천 + 연금 5천

export const DEFAULT_SETTINGS = {
  autoBuy: true,
  dryRun: true,
  lotto: {
    enabled: true,
    slots: ["auto", "auto", "auto", "auto", "auto"],
    saved: []
  },
  pension: {
    enabled: true,
    mode: "sameAuto",
    saved: ""
  }
};

export function normalizeSettings(raw = {}) {
  const s = structuredClone(DEFAULT_SETTINGS);
  if (typeof raw.autoBuy === "boolean") s.autoBuy = raw.autoBuy;
  if (typeof raw.dryRun === "boolean") s.dryRun = raw.dryRun;
  if (raw.lotto) {
    if (typeof raw.lotto.enabled === "boolean") s.lotto.enabled = raw.lotto.enabled;
    if (Array.isArray(raw.lotto.slots)) {
      s.lotto.slots = raw.lotto.slots.filter((m) => LOTTO_SLOT_MODES.includes(m)).slice(0, LOTTO_MAX_GAMES);
    }
    if (Array.isArray(raw.lotto.saved)) s.lotto.saved = raw.lotto.saved.filter(isValidLottoGame).map((g) => [...g].sort((a, b) => a - b));
  }
  if (raw.pension) {
    if (typeof raw.pension.enabled === "boolean") s.pension.enabled = raw.pension.enabled;
    if (PENSION_MODES.includes(raw.pension.mode)) s.pension.mode = raw.pension.mode;
    if (/^\d{6}$/.test(String(raw.pension.saved ?? ""))) s.pension.saved = String(raw.pension.saved);
  }
  return s;
}

export function isValidLottoGame(game) {
  return (
    Array.isArray(game) &&
    game.length === 6 &&
    game.every((n) => Number.isInteger(n) && n >= 1 && n <= 45) &&
    new Set(game).size === 6
  );
}

function randomGame(randomInt) {
  const chosen = new Set();
  while (chosen.size < 6) chosen.add(randomInt(45) + 1);
  return [...chosen].sort((a, b) => a - b);
}

/**
 * 로또 게임 목록. auto는 동행복권이 번호를 정한다(numbers=null).
 * 저장번호가 모자라면 그 칸은 자동으로 바꾸고 note를 남긴다.
 */
export function buildLottoGames(settings, analysis, randomInt) {
  const games = [];
  let savedIdx = 0;
  let analysisIdx = 0;
  settings.lotto.slots.forEach((mode, idx) => {
    const slot = "ABCDE"[idx];
    if (mode === "analysis" && analysis?.games?.[analysisIdx]) {
      const g = analysis.games[analysisIdx++];
      games.push({ slot, source: "analysis", numbers: g.numbers, note: g.name });
    } else if (mode === "saved" && settings.lotto.saved[savedIdx]) {
      games.push({ slot, source: "saved", numbers: settings.lotto.saved[savedIdx++] });
    } else if (mode === "random") {
      games.push({ slot, source: "random", numbers: randomGame(randomInt) });
    } else {
      const note = mode === "auto" ? undefined : `${mode === "saved" ? "저장번호" : "분석번호"}가 없어 자동으로 바꿈`;
      games.push({ slot, source: "auto", numbers: null, ...(note ? { note } : {}) });
    }
  });
  // 같은 번호 두 번 사지 않기
  const seen = new Set();
  for (const g of games) {
    if (!g.numbers) continue;
    const key = g.numbers.join(",");
    if (seen.has(key)) {
      g.numbers = randomGame(randomInt);
      g.note = "같은 번호가 있어 무작위로 바꿈";
      g.source = "random";
    }
    seen.add(g.numbers.join(","));
  }
  return games;
}

/** 연금복권 구매 계획. number=null이면 동행복권 자동번호 */
export function buildPensionPlan(settings, analysis) {
  const mode = settings.pension.mode;
  if (mode === "auto5") {
    return { mode, sameNumber: false, number: null, groups: [1, 2, 3, 4, 5] };
  }
  let number = null;
  let note;
  if (mode === "sameSaved") {
    number = settings.pension.saved || null;
    if (!number) note = "저장번호가 없어 자동번호로 바꿈";
  } else if (mode === "sameAnalysis") {
    number = analysis?.picks?.[0]?.number ?? null;
    if (!number) note = "분석번호가 없어 자동번호로 바꿈";
  }
  return { mode, sameNumber: true, number, groups: [1, 2, 3, 4, 5], ...(note ? { note } : {}) };
}
