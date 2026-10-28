// 공유 게시판: 글은 쓸 수 없고 번호 + 정해 둔 멘트 하나만 올린다 (광고·도박 홍보 글이 끼어들 틈을 없앤다)
// 서버(api/wall.js)와 대시보드가 같이 쓴다.

import { seededRandom } from "./analyze.js";
import { currentLottoRound, currentPensionRound, latestLottoRound, latestPensionRound } from "./time.js";

export const WALL_PHRASES = [
  "이번 주는 느낌이 좋아요 🍀",
  "당첨되면 부모님 여행 보내 드릴래요 ✈️",
  "1등 되면 회사에 커피 쏩니다 ☕",
  "꿈에서 본 번호예요 🌙",
  "가족 생일로 골랐어요 🎂",
  "매주 꾸준히, 언젠가는! 💪",
  "당첨되면 대출부터 갚을래요 🏠",
  "자동번호에 운을 맡겼어요 🎲",
  "당첨되면 동네 맛집 다 가 볼래요 🍜",
  "5천 원의 행복, 이번 주도 설레요 😊"
];

const ADJ = ["행운의", "느긋한", "부지런한", "웃는", "용감한", "반짝이는", "조용한", "씩씩한", "따뜻한", "날쌘"];
const ANIMAL = ["고양이", "거북이", "다람쥐", "판다", "수달", "펭귄", "여우", "참새", "토끼", "고래"];

/** 이름은 직접 못 쓰고 자동으로 정해진다 (같은 씨앗이면 같은 이름) */
export function makeNickname(seed) {
  const rand = seededRandom(Number(seed) >>> 0);
  return `${ADJ[Math.floor(rand() * ADJ.length)]} ${ANIMAL[Math.floor(rand() * ANIMAL.length)]} ${10 + Math.floor(rand() * 90)}`;
}

const isLottoGame = (g) => Array.isArray(g) && g.length === 6 && new Set(g).size === 6 && g.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);
const isTicket = (t) => t && Number.isInteger(t.group) && t.group >= 1 && t.group <= 5 && /^\d{6}$/.test(String(t.number));

/**
 * 올리려는 글 검사. 판매 중이거나 막 추첨이 끝난 회차만 받는다.
 * 돌려주는 entry 에는 검사를 통과한 값만 담는다(그 밖의 필드는 버림).
 */
export function validateWallEntry(body, now = new Date()) {
  if (!body || typeof body !== "object") return { error: "형식이 맞지 않습니다." };
  const phraseId = Number(body.phraseId);
  if (!Number.isInteger(phraseId) || phraseId < 0 || phraseId >= WALL_PHRASES.length) return { error: "멘트를 골라 주세요." };
  const round = Number(body.round);
  if (body.product === "lotto") {
    const allowed = [currentLottoRound(now).round, latestLottoRound(now)];
    if (!allowed.includes(round)) return { error: "이번 주나 지난주 회차만 공유할 수 있어요." };
    const games = Array.isArray(body.games) ? body.games.filter(isLottoGame).slice(0, 5) : [];
    if (games.length === 0) return { error: "공유할 번호가 없어요." };
    return { entry: { product: "lotto", round, numbers: games.map((g) => [...g].sort((a, b) => a - b)), phraseId } };
  }
  if (body.product === "pension") {
    const allowed = [currentPensionRound(now).round, latestPensionRound(now)];
    if (!allowed.includes(round)) return { error: "이번 주나 지난주 회차만 공유할 수 있어요." };
    const tickets = Array.isArray(body.tickets) ? body.tickets.filter(isTicket).slice(0, 5) : [];
    if (tickets.length === 0) return { error: "공유할 번호가 없어요." };
    return { entry: { product: "pension", round, numbers: tickets.map((t) => ({ group: t.group, number: String(t.number) })), phraseId } };
  }
  return { error: "로또나 연금복권만 공유할 수 있어요." };
}
