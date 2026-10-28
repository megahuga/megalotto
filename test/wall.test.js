import assert from "node:assert/strict";
import { test } from "node:test";
import { makeNickname, validateWallEntry, WALL_PHRASES } from "../src/wall.js";

const kst = (s) => new Date(`${s}+09:00`);
const now = kst("2026-10-28T10:00:00"); // 판매 중: 로또 1248회 · 연금 339회

test("이름은 자동으로, 같은 씨앗이면 같은 이름", () => {
  assert.equal(makeNickname(7), makeNickname(7));
  assert.match(makeNickname(7), /^\S+ \S+ \d{2}$/);
});

test("공유 글 검사: 번호·멘트만 통과, 나머지 필드는 버림", () => {
  const ok = validateWallEntry({ product: "lotto", round: 1248, phraseId: 1, games: [[45, 1, 2, 3, 4, 5], [1, 1, 2, 3, 4, 5]], memo: "광고 글" }, now);
  assert.deepEqual(ok.entry, { product: "lotto", round: 1248, numbers: [[1, 2, 3, 4, 5, 45]], phraseId: 1 });
  assert.equal(validateWallEntry({ product: "lotto", round: 1248, phraseId: WALL_PHRASES.length, games: [[1, 2, 3, 4, 5, 6]] }, now).error, "멘트를 골라 주세요.");
  assert.ok(validateWallEntry({ product: "lotto", round: 1200, phraseId: 0, games: [[1, 2, 3, 4, 5, 6]] }, now).error);
  assert.ok(validateWallEntry({ product: "pension", round: 339, phraseId: 0, tickets: [{ group: 1, number: "12a456" }] }, now).error);
  assert.deepEqual(validateWallEntry({ product: "pension", round: 338, phraseId: 2, tickets: [{ group: 3, number: "027730" }] }, now).entry.numbers, [{ group: 3, number: "027730" }]);
});
