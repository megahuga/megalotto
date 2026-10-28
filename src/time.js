// 한국 시간과 회차 계산. 브라우저(대시보드)와 Node 양쪽에서 쓴다.

const DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET = 9 * 60 * 60 * 1000;

// 로또6/45 1회 추첨: 2002-12-07(토) 20:45 KST
const LOTTO_FIRST_DRAW = Date.UTC(2002, 11, 7);
// 연금복권720+ 1회 추첨: 2020-05-07(목) 19:05 KST
const PENSION_FIRST_DRAW = Date.UTC(2020, 4, 7);

/** KST 기준 달력 값을 UTC 필드로 담은 Date (getUTC* 로 읽는다) */
export function kstNow(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET);
}

export function ymd(date, sep = "-") {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return [y, m, d].join(sep);
}

/** '20261024' → '2026-10-24' */
export function dashDate(compact) {
  const s = String(compact ?? "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

function kstMidnight(now) {
  const k = kstNow(now);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}

function minutesOfDay(now) {
  const k = kstNow(now);
  return k.getUTCHours() * 60 + k.getUTCMinutes();
}

/** 추첨이 끝난 마지막 로또 회차 (토 21:00 KST 이후면 그날 회차 포함) */
export function latestLottoRound(now = new Date()) {
  const today = kstMidnight(now);
  let weeks = Math.floor((today - LOTTO_FIRST_DRAW) / (7 * DAY));
  const isSaturday = (today - LOTTO_FIRST_DRAW) % (7 * DAY) === 0;
  if (isSaturday && minutesOfDay(now) < 21 * 60) weeks -= 1;
  return weeks + 1;
}

/** 지금 판매 중인 로또 회차와 추첨일 */
export function currentLottoRound(now = new Date()) {
  const round = latestLottoRound(now) + 1;
  return { round, drawDate: ymd(new Date(LOTTO_FIRST_DRAW + (round - 1) * 7 * DAY)) };
}

/** 추첨이 끝난 마지막 연금복권 회차 (목 19:30 KST 이후면 그날 회차 포함) */
export function latestPensionRound(now = new Date()) {
  const today = kstMidnight(now);
  let weeks = Math.floor((today - PENSION_FIRST_DRAW) / (7 * DAY));
  const isThursday = (today - PENSION_FIRST_DRAW) % (7 * DAY) === 0;
  if (isThursday && minutesOfDay(now) < 19 * 60 + 30) weeks -= 1;
  return weeks + 1;
}

export function currentPensionRound(now = new Date()) {
  const round = latestPensionRound(now) + 1;
  return { round, drawDate: ymd(new Date(PENSION_FIRST_DRAW + (round - 1) * 7 * DAY)) };
}

/** 로또 구매 주기(일~토) 시작일과 연금 구매 주기(금~목) 시작일, YYYYMMDD */
export function purchaseCycles(now = new Date()) {
  const today = kstMidnight(now);
  const weekday = new Date(today).getUTCDay(); // 0=일
  const lottoStart = new Date(today - weekday * DAY);
  const pensionStart = new Date(today - ((weekday + 2) % 7) * DAY); // 금요일
  return {
    lotto: { from: ymd(lottoStart, ""), to: ymd(new Date(today), "") },
    pension: { from: ymd(pensionStart, ""), to: ymd(new Date(today), "") }
  };
}
