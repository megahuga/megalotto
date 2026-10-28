// 동행복권 공개 당첨번호 조회 (로그인 필요 없음)

import { dashDate, latestLottoRound } from "./time.js";

const BASE = "https://www.dhlottery.co.kr";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  AJAX: "true",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9"
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(path, referer) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(`${BASE}${path}`, { headers: { ...HEADERS, Referer: `${BASE}${referer}` } });
    const text = await res.text();
    if (res.ok && text.trim().startsWith("{")) return JSON.parse(text);
    if (attempt === 3) throw new Error(`당첨번호 조회 실패 ${path} status=${res.status} body=${text.slice(0, 120)}`);
    await sleep(1500 * attempt);
  }
  return null;
}

export function normalizeLotto(row) {
  return {
    round: Number(row.ltEpsd),
    date: dashDate(row.ltRflYmd),
    numbers: [row.tm1WnNo, row.tm2WnNo, row.tm3WnNo, row.tm4WnNo, row.tm5WnNo, row.tm6WnNo].map(Number),
    bonus: Number(row.bnsWnNo),
    prize1: Number(row.rnk1WnAmt ?? 0),
    winners1: Number(row.rnk1WnNope ?? 0),
    // 1~5등 [1인당 당첨금, 당첨자 수]
    prizes: [1, 2, 3, 4, 5].map((r) => [Number(row[`rnk${r}WnAmt`] ?? 0), Number(row[`rnk${r}WnNope`] ?? 0)]),
    sales: Number(row.rlvtEpsdSumNtslAmt ?? 0)
  };
}

export function normalizePension(row) {
  return {
    round: Number(row.psltEpsd),
    date: dashDate(row.psltRflYmd),
    group: Number(row.wnBndNo),
    number: String(row.wnRnkVl).padStart(6, "0"),
    bonus: String(row.bnsRnkVl).padStart(6, "0")
  };
}

/** dir=center: 그 회차 주변 10개, dir=older: 커서(있는 회차)보다 작은 10개 */
async function fetchLotto(dir, round) {
  const query = dir === "center" ? `srchDir=center&srchLtEpsd=${round}` : `srchDir=older&srchCursorLtEpsd=${round}`;
  const json = await getJson(`/lt645/selectPstLt645InfoNew.do?${query}`, "/lt645/result");
  return (json?.data?.list ?? []).map(normalizeLotto);
}

/** 이미 가진 회차 다음부터 최신 회차까지 받아서 합친 목록(오름차순)을 돌려준다 */
export async function updateLottoDraws(existing = [], { now = new Date(), delayMs = 250, log = () => {} } = {}) {
  const known = new Map(existing.map((d) => [d.round, d]));
  const have = existing.reduce((max, d) => Math.max(max, d.round), 0);
  let rows = await fetchLotto("center", latestLottoRound(now));
  while (rows.length) {
    for (const row of rows) known.set(row.round, row);
    const cursor = Math.min(...rows.map((r) => r.round));
    log(`로또 ${cursor}회까지 받음`);
    if (cursor <= have + 1) break;
    await sleep(delayMs);
    rows = await fetchLotto("older", cursor);
  }
  return [...known.values()].sort((a, b) => a.round - b.round);
}

/** 연금복권은 한 번에 전체 회차가 온다 */
export async function fetchPensionDraws() {
  const json = await getJson("/pt720/selectPstPt720WnList.do", "/pt720/result");
  return (json?.data?.result ?? []).map(normalizePension).sort((a, b) => a.round - b.round);
}
