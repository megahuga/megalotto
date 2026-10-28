#!/usr/bin/env node
// 메가로또·메가연금 실행기
//   node src/cli.js update   당첨번호 받기 + 분석 + 당첨 확인
//   node src/cli.js buy      이번 주 로또·연금 구매 (settings.dryRun이면 구매 직전까지만)
//   node src/cli.js check    잔액·구매내역 확인
//   node src/cli.js auto     GitHub Actions 예약 시간에 맞춰 위 작업을 고른다

import { randomInt } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeLotto, analyzePension, lottoRank, pensionRank } from "./analyze.js";
import { fetchPensionDraws, updateLottoDraws } from "./draws.js";
import { buyLotto, buyPension, getBalance, getLedger, login, openSession } from "./dhlottery.js";
import { buildLottoGames, buildPensionPlan, normalizeSettings } from "./picks.js";
import { currentLottoRound, currentPensionRound, kstNow, purchaseCycles } from "./time.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = (...p) => join(ROOT, ...p);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** 오류 문구를 한 줄로 줄이고 쿠키·세션 값은 지운다 (실행 기록·저장소·화면에 남지 않게) */
export function cleanError(error) {
  return String(error?.message ?? error)
    .split(/\r?\n/)[0]
    .replace(/Call log:.*$/i, "")
    .replace(/(cookie|JSESSIONID|DHJSESSIONID|WMONID|inpUserId)\s*[:=]\s*[^\s;]*/gi, "$1=[가림]")
    .trim()
    .slice(0, 200);
}

const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;
const nowIso = () => new Date().toISOString();
const log = (...args) => console.log("[메가로또]", ...args);

/** GitHub 실행 요약 + (선택) 텔레그램 알림 */
async function notify(title, lines) {
  const text = [`*${title}*`, ...lines].join("\n");
  log(`${title}\n${lines.join("\n")}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n${lines.map((l) => `- ${l}`).join("\n")}\n\n`);
  }
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (token && chat) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" })
    }).catch((e) => log("텔레그램 알림 실패:", e.message));
  }
}

async function loadStatus() {
  return readJson(file("data", "status.json"), {});
}

async function saveStatus(patch) {
  const status = { ...(await loadStatus()), ...patch, updatedAt: nowIso() };
  await writeJson(file("data", "status.json"), status);
  return status;
}

/** 당첨번호 받기 → 분석 → 산 번호 당첨 확인 */
export async function runUpdate() {
  const lottoPath = file("data", "lotto-draws.json");
  const lotto = await updateLottoDraws(await readJson(lottoPath, []), { log });
  await writeJson(lottoPath, lotto);
  const pension = await fetchPensionDraws();
  if (pension.length) await writeJson(file("data", "pension-draws.json"), pension);
  else log("연금복권 당첨번호를 받지 못해 이전 자료를 그대로 둡니다.");
  const pensionDraws = pension.length ? pension : await readJson(file("data", "pension-draws.json"), []);

  const analysis = { generatedAt: nowIso(), lotto: analyzeLotto(lotto), pension: analyzePension(pensionDraws) };
  await writeJson(file("data", "analysis.json"), analysis);

  const results = await gradePurchases(lotto, pensionDraws);
  await saveStatus({ lastUpdate: nowIso(), latestLotto: lotto.at(-1)?.round, latestPension: pensionDraws.at(-1)?.round });
  log(`로또 ${lotto.at(-1)?.round}회 · 연금 ${pensionDraws.at(-1)?.round}회까지 반영, 다음 분석 로또 ${analysis.lotto.round}회 · 연금 ${analysis.pension.round}회`);
  if (results.length) await notify("당첨 확인", results);
}

async function gradePurchases(lottoDraws, pensionDraws) {
  const path = file("data", "purchases.json");
  const purchases = await readJson(path, []);
  const lottoByRound = new Map(lottoDraws.map((d) => [d.round, d]));
  const pensionByRound = new Map(pensionDraws.map((d) => [d.round, d]));
  const messages = [];
  for (const p of purchases) {
    if (p.result || p.dryRun) continue;
    if (p.product === "lotto" && lottoByRound.has(p.round)) {
      const draw = lottoByRound.get(p.round);
      const ranks = p.games.map((g) => (g.numbers ? lottoRank(g.numbers, draw) : null));
      p.result = { checkedAt: nowIso(), ranks };
      const wins = ranks.filter((r) => r);
      messages.push(`로또 ${p.round}회: ${wins.length ? wins.map((r) => `${r}등`).join(", ") : "낙첨"}`);
    }
    if (p.product === "pension" && pensionByRound.has(p.round)) {
      const draw = pensionByRound.get(p.round);
      const ranks = p.tickets.map((t) => pensionRank(t.group, t.number, draw));
      p.result = { checkedAt: nowIso(), ranks };
      const wins = ranks.filter((r) => r);
      messages.push(`연금 ${p.round}회: ${wins.length ? wins.map((r) => (r === "B" ? "보너스" : `${r}등`)).join(", ") : "낙첨"}`);
    }
  }
  await writeJson(path, purchases);
  return messages;
}

function credentials() {
  // 비밀값을 붙여 넣을 때 딸려 들어간 끝 줄바꿈은 뗀다
  return { id: process.env.DH_USER_ID?.trim(), pw: process.env.DH_PASSWORD?.replace(/[\r\n]+$/, "") };
}

/** 이번 주 구매 */
export async function runBuy({ force = false } = {}) {
  const settings = normalizeSettings(await readJson(file("config", "settings.json"), {}));
  if (!settings.autoBuy && !force) {
    log("자동구매가 꺼져 있어 건너뜁니다.");
    return;
  }
  const dryRun = settings.dryRun || process.env.DRY_RUN === "true";
  const analysis = await readJson(file("data", "analysis.json"), {});
  const purchasesPath = file("data", "purchases.json");
  const purchases = await readJson(purchasesPath, []);
  const lottoRound = currentLottoRound();
  const pensionRound = currentPensionRound();
  const cycles = purchaseCycles();
  const lines = [];
  const { id, pw } = credentials();

  const session = await openSession();
  try {
    await login(session.context, id, pw);
    let balance = await getBalance(session.context);
    lines.push(`로그인 성공 · 예치금 ${won(balance)}`);

    if (settings.lotto.enabled && settings.lotto.slots.length) {
      const already = (await getLedger(session.context, "LO40", cycles.lotto.from, cycles.lotto.to)).filter((x) => x.quantity > 0);
      const need = settings.lotto.slots.length * 1000;
      if (already.length && !dryRun) {
        lines.push(`로또 ${lottoRound.round}회: 이번 주 이미 ${already.reduce((a, x) => a + x.quantity, 0)}게임 구매 → 건너뜀`);
      } else if (balance < need && !dryRun) {
        lines.push(`로또: 예치금 부족(필요 ${won(need)}, 잔액 ${won(balance)}) → 충전해 주세요`);
      } else {
        const lottoAnalysis = analysis.lotto?.round === lottoRound.round ? analysis.lotto : null;
        if (!lottoAnalysis) lines.push(`분석번호가 ${lottoRound.round}회 기준이 아니라 분석 칸은 자동으로 삽니다`);
        const games = buildLottoGames(settings, lottoAnalysis, randomInt);
        const result = await buyLotto(session.context, games, { dryRun, round: lottoRound.round, drawDate: lottoRound.drawDate });
        purchases.push({ id: `lotto-${result.round}-${Date.now()}`, product: "lotto", round: result.round, drawDate: lottoRound.drawDate, boughtAt: nowIso(), dryRun, amount: result.amount, games: result.games });
        if (!dryRun) balance -= result.amount;
        lines.push(`로또 ${result.round}회 ${result.games.length}게임 ${dryRun ? "시험(구매 안 함)" : "구매 완료"}`);
        for (const g of result.games) lines.push(`  ${g.slot} ${g.numbers ? g.numbers.join(" ") : "자동"} (${g.source})`);
      }
    }

    if (settings.pension.enabled) {
      const already = (await getLedger(session.context, "LP72", cycles.pension.from, cycles.pension.to)).filter((x) => x.quantity > 0);
      if (already.length && !dryRun) {
        lines.push(`연금 ${pensionRound.round}회: 이번 주 이미 구매 → 건너뜀`);
      } else if (balance < 5000 && !dryRun) {
        lines.push(`연금: 예치금 부족(필요 5,000원, 잔액 ${won(balance)}) → 충전해 주세요`);
      } else {
        const pensionAnalysis = analysis.pension?.round === pensionRound.round ? analysis.pension : null;
        const plan = buildPensionPlan(settings, pensionAnalysis);
        if (plan.note) lines.push(`연금: ${plan.note}`);
        const result = await buyPension(session.context, plan, { dryRun });
        purchases.push({ id: `pension-${pensionRound.round}-${Date.now()}`, product: "pension", round: pensionRound.round, drawDate: pensionRound.drawDate, boughtAt: nowIso(), dryRun, amount: result.amount, mode: plan.mode, tickets: result.tickets, orderNo: result.orderNo ?? null });
        if (!dryRun) balance -= result.amount;
        lines.push(`연금 ${pensionRound.round}회 ${result.tickets.length}장 ${dryRun ? "시험(구매 안 함)" : "구매 완료"}: ${result.tickets.map((t) => `${t.group}조 ${t.number}`).join(", ")}`);
      }
    }

    await writeJson(purchasesPath, purchases);
    await saveStatus({ balance, balanceAt: nowIso(), lastBuy: nowIso(), lastBuyOk: true, lastError: null });
    await notify(dryRun ? "메가로또 시험 실행" : "메가로또·메가연금 구매", lines);
  } catch (error) {
    await writeJson(purchasesPath, purchases);
    await saveStatus({ lastBuy: nowIso(), lastBuyOk: false, lastError: cleanError(error) });
    await notify("메가로또 구매 실패", [...lines, `오류: ${cleanError(error)}`]);
    throw error;
  } finally {
    await session.close();
  }
}

/** 잔액과 최근 구매내역 (로그인 필요) */
export async function runCheck() {
  const { id, pw } = credentials();
  if (!id || !pw) {
    log("동행복권 비밀값이 없어 잔액 확인은 건너뜁니다.");
    return;
  }
  const session = await openSession();
  try {
    await login(session.context, id, pw);
    const balance = await getBalance(session.context);
    const k = kstNow();
    const to = `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`;
    const from = new Date(k.getTime() - 35 * 86400000);
    const fromYmd = `${from.getUTCFullYear()}${String(from.getUTCMonth() + 1).padStart(2, "0")}${String(from.getUTCDate()).padStart(2, "0")}`;
    const ledger = [...(await getLedger(session.context, "LO40", fromYmd, to)), ...(await getLedger(session.context, "LP72", fromYmd, to))];
    await writeJson(file("data", "ledger.json"), { checkedAt: nowIso(), items: ledger });
    await saveStatus({ balance, balanceAt: nowIso() });
    const low = balance < 10000 ? " → 다음 주 구매에 1만 원이 필요합니다. 충전해 주세요" : "";
    await notify("예치금 확인", [`예치금 ${won(balance)}${low}`]);
  } finally {
    await session.close();
  }
}

/** 접속 점검: 로그인 없이 동행복권 주소마다 응답·시간을 본다 */
export async function runDiagnose() {
  const urls = [
    "https://www.dhlottery.co.kr/",
    "https://www.dhlottery.co.kr/login",
    "https://www.dhlottery.co.kr/login/selectRsaModulus.do",
    "https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=older&srchCursorLtEpsd=20",
    "https://www.dhlottery.co.kr/mypage/home",
    "https://ol.dhlottery.co.kr/olotto/game/game645.do",
    "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LP72",
    "https://m.dhlottery.co.kr/"
  ];
  const where = await fetch("https://ipinfo.io/json").then((r) => r.json()).catch(() => ({}));
  const lines = [`실행 위치: ${where.country ?? "?"} ${where.region ?? ""} (${where.org ?? ""})`];
  for (const url of urls) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Accept-Language": "ko-KR,ko;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(20000)
      });
      lines.push(`${res.status} ${Date.now() - started}ms ${url} → ${res.url}`);
    } catch (e) {
      lines.push(`실패 ${Date.now() - started}ms ${url} (${e.name === "TimeoutError" ? "20초 응답 없음" : e.message})`);
    }
  }
  await notify("동행복권 접속 점검", lines);
}

/** Actions 예약 시간(cron)에 맞춰 할 일을 고른다 */
export function taskForSchedule(schedule) {
  if (schedule === "30 0 * * 1") return ["buy"];
  return ["update", "check"];
}

async function main() {
  const [command = "auto", flag] = process.argv.slice(2);
  const tasks =
    command === "auto" ? (process.env.TASK && process.env.TASK !== "auto" ? [process.env.TASK] : taskForSchedule(process.env.EVENT_SCHEDULE)) : [command];
  for (const task of tasks) {
    if (task === "update") await runUpdate();
    else if (task === "buy") await runBuy({ force: flag === "--force" || process.env.FORCE === "true" });
    else if (task === "diagnose") await runDiagnose();
    else if (task === "check") await runCheck().catch((e) => log("잔액 확인 실패:", e.message));
    else throw new Error(`모르는 명령: ${task}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("[메가로또] 실패:", cleanError(error));
    process.exit(1);
  });
}
