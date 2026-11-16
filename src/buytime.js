// 월요일 오전 9시 30분(KST) 구매 시각 판단. 다른 파일을 불러오지 않아서, 워크플로가 npm ci 전에 바로 쓴다.
// GitHub 예약 실행은 몇 시간씩 늦게 시작할 때가 있다. 그래서 일요일 저녁부터 한 시간마다 깨워 두고,
// 9시 30분 직전 WAIT_LIMIT 안에 깬 실행만 기다렸다가 산다. 그보다 일찍 깬 실행은 아무것도 하지 않고 끝난다.

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 구매 예약(cron, UTC). 워크플로 파일과 같아야 한다: 일 19:35~월 08:35 KST 매시, 월 09:15, 월 11:05 */
export const BUY_SCHEDULES = ["35 10-23 * * 0", "15 0 * * 1", "5 2 * * 1"];
export const WAIT_LIMIT_MS = 70 * 60000;

/** early: 너무 일찍 깸(그냥 끝) / wait: 9시 30분까지 기다렸다 삼 / late: 지났으니 아직 안 샀으면 바로 삼 */
export function buyTiming(now = new Date()) {
  const day = now.getUTCDay();
  if (day !== 0 && day !== 1) return { state: "late", ms: 0 }; // 화요일 이후에 깬 아주 늦은 예약
  const target = new Date(now);
  if (day === 0) target.setUTCDate(target.getUTCDate() + 1); // 월요일 KST 이른 아침은 UTC로 아직 일요일
  target.setUTCHours(0, 30, 0, 0); // 월 09:30 KST = 월 00:30 UTC
  const ms = target - now;
  if (ms <= 0) return { state: "late", ms: 0 };
  return { state: ms <= WAIT_LIMIT_MS ? "wait" : "early", ms };
}

// 워크플로: node src/buytime.js gate → 구매 예약인데 너무 일찍 깼으면 go=no (뒤 단계를 모두 건너뜀)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === "gate") {
  const schedule = process.env.EVENT_SCHEDULE;
  const early = BUY_SCHEDULES.includes(schedule) && buyTiming().state === "early";
  console.log(early ? "[메가로또] 너무 일찍 깼어요. 9시 30분 직전에 깨는 다음 예약에 맡기고 끝냅니다." : "[메가로또] 실행합니다.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `go=${early ? "no" : "yes"}\n`);
}
