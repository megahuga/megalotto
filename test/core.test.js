import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { test } from "node:test";
import { acValue, analyzeLotto, analyzePension, lottoRank, passesFilters, pensionRank } from "../src/analyze.js";
import { lottoDates, parseLottoLines, rsaEncryptHex } from "../src/dhlottery.js";
import { buildLottoGames, buildPensionPlan, normalizeSettings } from "../src/picks.js";
import { currentLottoRound, currentPensionRound, latestLottoRound, latestPensionRound, purchaseCycles } from "../src/time.js";
import { taskForSchedule } from "../src/cli.js";

const kst = (s) => new Date(`${s}+09:00`);

function fakeLottoDraws(count) {
  const draws = [];
  let x = 7;
  for (let round = 1; round <= count; round += 1) {
    const set = new Set();
    while (set.size < 7) {
      x = (x * 1103515245 + 12345) % 2147483648;
      set.add((x % 45) + 1);
    }
    const all = [...set];
    draws.push({ round, date: "2026-01-01", numbers: all.slice(0, 6).sort((a, b) => a - b), bonus: all[6] });
  }
  return draws;
}

test("로또 회차: 1196회 추첨(2025-11-01) 전후", () => {
  assert.equal(latestLottoRound(kst("2025-11-01T20:00:00")), 1195);
  assert.equal(latestLottoRound(kst("2025-11-01T21:30:00")), 1196);
  assert.equal(currentLottoRound(kst("2025-11-03T09:00:00")).round, 1197);
  assert.equal(currentLottoRound(kst("2025-11-03T09:00:00")).drawDate, "2025-11-08");
});

test("연금 회차: 338회 추첨(2026-10-22 목)", () => {
  assert.equal(latestPensionRound(kst("2026-10-22T18:00:00")), 337);
  assert.equal(latestPensionRound(kst("2026-10-22T20:00:00")), 338);
  assert.equal(currentPensionRound(kst("2026-10-26T09:00:00")).round, 339);
  assert.equal(currentPensionRound(kst("2026-10-26T09:00:00")).drawDate, "2026-10-29");
});

test("구매 주기: 로또 일~토, 연금 금~목", () => {
  const c = purchaseCycles(kst("2026-10-26T09:00:00")); // 월요일
  assert.equal(c.lotto.from, "20261025");
  assert.equal(c.pension.from, "20261023");
});

test("AC값과 필터", () => {
  assert.equal(acValue([1, 2, 3, 4, 5, 6]), 0);
  assert.equal(passesFilters([1, 2, 3, 4, 5, 6]), false);
  assert.equal(passesFilters([3, 14, 22, 27, 35, 41]), true);
});

test("분석번호는 같은 회차면 늘 같고, 5게임 모두 다르다", () => {
  const draws = fakeLottoDraws(300);
  const a = analyzeLotto(draws);
  const b = analyzeLotto(draws);
  assert.deepEqual(a.games.map((g) => g.numbers), b.games.map((g) => g.numbers));
  assert.equal(a.round, 301);
  assert.equal(a.games.length, 5);
  assert.equal(new Set(a.games.map((g) => g.numbers.join(","))).size, 5);
  for (const g of a.games) {
    assert.equal(g.numbers.length, 6);
    assert.ok(g.reason.includes("합계"));
  }
});

test("등수 계산", () => {
  const draw = { numbers: [1, 2, 3, 4, 5, 6], bonus: 7 };
  assert.equal(lottoRank([1, 2, 3, 4, 5, 6], draw), 1);
  assert.equal(lottoRank([1, 2, 3, 4, 5, 7], draw), 2);
  assert.equal(lottoRank([1, 2, 3, 4, 5, 8], draw), 3);
  assert.equal(lottoRank([1, 2, 3, 10, 11, 12], draw), 5);
  const p = { group: 1, number: "354154", bonus: "548210" };
  assert.equal(pensionRank(1, "354154", p), 1);
  assert.equal(pensionRank(3, "354154", p), 2);
  assert.equal(pensionRank(2, "548210", p), "B");
  assert.equal(pensionRank(2, "954154", p), 3);
  assert.equal(pensionRank(2, "000004", p), 7);
  assert.equal(pensionRank(2, "000000", p), 0);
});

test("설정 → 로또 게임: 분석·저장·랜덤·자동, 저장번호 없으면 자동", () => {
  const settings = normalizeSettings({ lotto: { slots: ["analysis", "saved", "saved", "random", "auto"], saved: [[45, 1, 2, 3, 4, 5]] } });
  const analysis = analyzeLotto(fakeLottoDraws(200));
  let i = 0;
  const games = buildLottoGames(settings, analysis, (max) => (i++ * 7) % max);
  assert.deepEqual(games.map((g) => g.source), ["analysis", "saved", "auto", "random", "auto"]);
  assert.deepEqual(games[1].numbers, [1, 2, 3, 4, 5, 45]);
  assert.equal(games[4].numbers, null);
});

test("설정은 5게임을 넘지 않고 잘못된 값은 버린다", () => {
  const s = normalizeSettings({ lotto: { slots: Array(9).fill("auto"), saved: [[1, 1, 2, 3, 4, 5]] }, pension: { mode: "x", saved: "12" } });
  assert.equal(s.lotto.slots.length, 5);
  assert.equal(s.lotto.saved.length, 0);
  assert.equal(s.pension.mode, "sameAuto");
  assert.equal(s.pension.saved, "");
});

test("연금 구매 계획", () => {
  const pension = analyzePension([{ round: 1, group: 1, number: "123456", bonus: "654321" }, { round: 2, group: 2, number: "222222", bonus: "333333" }]);
  assert.match(pension.picks[0].number, /^\d{6}$/);
  const same = buildPensionPlan(normalizeSettings({ pension: { mode: "sameAnalysis" } }), pension);
  assert.equal(same.number, pension.picks[0].number);
  assert.deepEqual(same.groups, [1, 2, 3, 4, 5]);
  const saved = buildPensionPlan(normalizeSettings({ pension: { mode: "sameSaved", saved: "007007" } }), pension);
  assert.equal(saved.number, "007007");
  assert.equal(buildPensionPlan(normalizeSettings({ pension: { mode: "auto5" } }), pension).sameNumber, false);
});

test("구매 응답 번호 읽기와 RSA 암호화", () => {
  assert.deepEqual(parseLottoLines(["A|01|07|12|27|33|442"])[0], { slot: "A", numbers: [1, 7, 12, 27, 33, 44] });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const jwk = publicKey.export({ format: "jwk" });
  const toHex = (b64url) => Buffer.from(b64url, "base64url").toString("hex");
  const hex = rsaEncryptHex("비밀번호test", toHex(jwk.n), toHex(jwk.e));
  const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(hex, "hex")).toString("utf8");
  assert.equal(plain, "비밀번호test");
});

test("로또 추첨일·지급기한 계산", () => {
  assert.deepEqual(lottoDates("2026-10-31"), { drawDate: "2026/10/31", payLimit: "2027/10/31" });
});

test("예약 시간 → 할 일", () => {
  assert.deepEqual(taskForSchedule("30 0 * * 1"), ["buy"]);
  assert.deepEqual(taskForSchedule("0 22 * * 6"), ["update", "check"]);
});
