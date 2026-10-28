// 동행복권 로그인·잔액·구매·구매내역.
// 사이트가 바뀌면 이 파일만 고치면 된다. 비밀번호는 어디에도 출력하지 않는다.

import { constants as cryptoConstants, createPublicKey, publicEncrypt } from "node:crypto";

const WWW = "https://www.dhlottery.co.kr";
const OL = "https://ol.dhlottery.co.kr";
const EL = "https://el.dhlottery.co.kr";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 어느 단계에서 멈췄는지 실행 기록에 남긴다 (값은 남기지 않음)
const step = (text) => console.log(`[동행복권] ${text}`);

const pageHeaders = (referer = `${WWW}/`) => ({
  "User-Agent": UA,
  "Accept-Language": "ko-KR,ko;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Referer: referer
});

const ajaxHeaders = (referer) => ({
  ...pageHeaders(referer),
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  AJAX: "true"
});

export class DhError extends Error {
  constructor(message, { blocked = false, maintenance = false } = {}) {
    super(message);
    this.blocked = blocked;
    this.maintenance = maintenance;
  }
}

function hexToBase64Url(hex) {
  let h = hex.trim().replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "").replace(/^0+/, "");
  if (h.length % 2) h = `0${h}`;
  return Buffer.from(h, "hex").toString("base64url");
}

/** 사이트 로그인 화면과 같은 방식(RSA PKCS#1)으로 암호화 */
export function rsaEncryptHex(text, modulusHex, exponentHex) {
  const key = createPublicKey({ key: { kty: "RSA", n: hexToBase64Url(modulusHex), e: hexToBase64Url(exponentHex) }, format: "jwk" });
  return publicEncrypt({ key, padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(text, "utf8")).toString("hex");
}

function checkPage(url, html = "") {
  if (url.includes("/errorPage")) {
    throw new DhError("동행복권이 이 실행 환경(IP)의 접속을 막았습니다.", { blocked: true });
  }
  if (/시스템\s*(정기\s*)?점검/.test(html) && html.length < 20000) {
    throw new DhError("동행복권 시스템 점검 중입니다.", { maintenance: true });
  }
}

/** Playwright 브라우저·컨텍스트를 연다. 연금복권 구매만 실제 화면이 필요하다. */
export async function openSession({ headless = true } = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });
  return { browser, context, close: () => browser.close() };
}

async function shareCookies(context) {
  // 로그인 쿠키를 ol·el 하위 도메인에서도 쓰도록 상위 도메인으로 복사
  const names = new Set(["JSESSIONID", "DHJSESSIONID", "WMONID"]);
  const cookies = (await context.cookies()).filter((c) => names.has(c.name));
  if (cookies.length) await context.addCookies(cookies.map((c) => ({ ...c, domain: ".dhlottery.co.kr", path: "/" })));
}

async function loginByForm(context, userId, password) {
  const page = await context.newPage();
  try {
    await page.goto(`${WWW}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    checkPage(page.url());
    await page.waitForSelector("#inpUserId", { timeout: 15000 });
    await page.fill("#inpUserId", userId);
    await page.locator("input[type='password']").first().fill(password);
    await page.click("#btnLogin");
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    checkPage(page.url());
    const message = (await page.content()).match(/errorMessage\s*=\s*'([^']+)'/)?.[1];
    if (message) throw new DhError(`로그인 실패: ${message}`);
  } finally {
    await page.close();
  }
}

export async function login(context, userId, password) {
  if (!userId || !password) throw new DhError("DH_USER_ID·DH_PASSWORD 비밀값이 없습니다.");
  const req = context.request;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      step(`로그인 ${attempt}번째 시도: 첫 화면`);
      await req.get(`${WWW}/`, { headers: pageHeaders() });
      step("로그인 화면");
      const loginPage = await req.get(`${WWW}/login`, { headers: pageHeaders() });
      checkPage(loginPage.url(), await loginPage.text());

      step("암호화 키 받기");
      const keyRes = await req.get(`${WWW}/login/selectRsaModulus.do`, { headers: ajaxHeaders(`${WWW}/login`) });
      const keyText = (await keyRes.text()).trim();
      checkPage(keyRes.url(), keyText);
      const key = JSON.parse(keyText);
      const modulus = key.data?.rsaModulus ?? key.rsaModulus;
      const exponent = key.data?.publicExponent ?? key.publicExponent;
      if (!modulus || !exponent) throw new DhError("로그인 암호화 키를 받지 못했습니다.");

      step("로그인 요청");
      const res = await req.post(`${WWW}/login/securityLoginCheck.do`, {
        headers: { ...pageHeaders(`${WWW}/login`), Origin: WWW },
        form: {
          userId: rsaEncryptHex(userId, modulus, exponent),
          userPswdEncn: rsaEncryptHex(password, modulus, exponent),
          inpUserId: userId
        }
      });
      const html = await res.text();
      checkPage(res.url(), html);
      const message = html.match(/errorMessage\s*=\s*'([^']+)'/)?.[1];
      if (message?.includes("아이디 또는 비밀번호")) {
        await loginByForm(context, userId, password); // 암호화 방식이 바뀐 경우 화면으로 다시 시도
      } else if (message) {
        throw new DhError(`로그인 실패: ${message}`);
      }
      step(`로그인 응답 받음 (${new URL(res.url()).pathname})`);
      await shareCookies(context);
      step("잔액으로 로그인 확인");
      await getBalance(context); // 세션이 진짜 만들어졌는지 확인
      step("로그인 성공");
      return;
    } catch (error) {
      lastError = error;
      step(`실패: ${String(error.message).split(/\r?\n/)[0].replace(/Call log:.*$/i, "").slice(0, 160)}`);
      if (error instanceof DhError && !error.maintenance && !String(error.message).includes("세션")) throw error;
      await sleep(5000 * attempt);
    }
  }
  throw lastError;
}

export async function getBalance(context) {
  await context.request.get(`${WWW}/mypage/home`, { headers: pageHeaders(), timeout: 15000 }).catch(() => {});
  const res = await context.request.get(`${WWW}/mypage/selectUserMndp.do?_=${Date.now()}`, {
    headers: { ...ajaxHeaders(`${WWW}/mypage/home`), requestMenuUri: "/mypage/home" }
  });
  const text = (await res.text()).trim();
  if (!res.ok() || !text.startsWith("{")) throw new DhError(`잔액 조회 실패(로그인 세션 확인 필요) status=${res.status()}`);
  const total = JSON.parse(text).data?.userMndp?.totalAmt ?? 0;
  return Number(String(total).replaceAll(",", "")) || 0;
}

/** 구매내역. product: 'LO40'(로또) | 'LP72'(연금) */
export async function getLedger(context, product, fromYmd, toYmd) {
  const query = new URLSearchParams({
    srchStrDt: fromYmd,
    srchEndDt: toYmd,
    sort: "",
    ltGdsCd: product,
    winResult: "",
    lramSmam: "",
    pageNum: "1",
    recordCountPerPage: "100",
    _: String(Date.now())
  });
  const res = await context.request.get(`${WWW}/mypage/selectMyLotteryledger.do?${query}`, {
    headers: ajaxHeaders(`${WWW}/mypage/mylotteryledger`)
  });
  const text = (await res.text()).trim();
  if (!res.ok() || !text.startsWith("{")) throw new DhError(`구매내역 조회 실패 status=${res.status()}`);
  const list = JSON.parse(text).data?.list;
  if (!Array.isArray(list)) throw new DhError("구매내역 형식이 바뀌었습니다.");
  return list.map((item) => ({
    date: item.eltOrdrDt,
    product: item.ltGdsCd,
    round: Number(item.ltEpsdView),
    quantity: Number(item.prchsQty) || 0,
    result: item.ltWnResult,
    prize: item.ltWnAmt ?? null,
    rank: item.wnRnk ?? null,
    orderNo: item.ntslOrdrNo ?? null
  }));
}

function hiddenValue(html, id) {
  const a = html.match(new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)["']`, "i"));
  const b = html.match(new RegExp(`value=["']([^"']*)["'][^>]*id=["']${id}["']`, "i"));
  return a?.[1] ?? b?.[1] ?? null;
}

/** 'A|01|07|12|27|33|442' 같은 응답 줄에서 번호 6개를 읽는다 */
export function parseLottoLines(lines = []) {
  return lines.map((line) => {
    const parts = String(line).split("|");
    const nums = parts.slice(1, 7).map((p) => Number(String(p).slice(0, 2)));
    return { slot: parts[0], numbers: nums.every((n) => n >= 1 && n <= 45) ? nums.sort((a, b) => a - b) : null };
  });
}

/**
 * 로또 구매. games: [{numbers:null|[6]}] 최대 5개.
 * dryRun이면 구매 직전 값까지만 확인하고 돌아온다.
 */
/** '2026-10-31' → 추첨일 '2026/10/31', 지급기한 '2027/10/31'(추첨일 + 1년) */
export function lottoDates(drawDateIso) {
  const [y, m, d] = drawDateIso.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d) + 365 * 86400000);
  const fmt = (dt) => `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}`;
  return { drawDate: fmt(new Date(Date.UTC(y, m - 1, d))), payLimit: fmt(limit) };
}

export async function buyLotto(context, games, { dryRun = true, round: expectedRound, drawDate: expectedDrawDate } = {}) {
  if (games.length < 1 || games.length > 5) throw new DhError("로또는 1~5게임만 살 수 있습니다.");
  const req = context.request;
  step("로또 구매 준비");
  const ready = await req.post(`${OL}/olotto/game/egovUserReadySocket.json`, {
    headers: { ...ajaxHeaders(`${OL}/olotto/game/game645.do`), Origin: OL }
  });
  const direct = (await ready.json().catch(() => ({}))).ready_ip;
  if (!direct) throw new DhError("로또 구매 준비값(ready_ip)을 받지 못했습니다.");

  // 개편 뒤 구매 화면에 회차·추첨일 숨은 값이 없을 수 있다 → 있으면 쓰고, 없으면 날짜로 계산
  const pageRes = await req.get(`${OL}/olotto/game/game645.do`, { headers: pageHeaders(`${WWW}/`) });
  const html = await pageRes.text();
  checkPage(pageRes.url(), html);
  const computed = expectedDrawDate ? lottoDates(expectedDrawDate) : {};
  const round = Number(hiddenValue(html, "curRound")) || expectedRound;
  const drawDate = hiddenValue(html, "ROUND_DRAW_DATE") ?? computed.drawDate;
  const payLimit = hiddenValue(html, "WAMT_PAY_TLMT_END_DT") ?? computed.payLimit;
  step(`로또 구매 화면 (${hiddenValue(html, "curRound") ? "화면 값" : "계산 값"}): ${round}회 · 추첨 ${drawDate}`);
  if (!round || !drawDate || !payLimit) throw new DhError("로또 회차·추첨일을 정하지 못했습니다.");
  if (expectedRound && round !== expectedRound) {
    throw new DhError(`판매 회차가 예상과 다릅니다. 화면=${round}, 계산=${expectedRound}`);
  }

  const param = games.map((g, idx) => ({
    genType: g.numbers ? "1" : "0",
    arrGameChoiceNum: g.numbers ? g.numbers.join(",") : null,
    alpabet: "ABCDE"[idx]
  }));
  const form = {
    round: String(round),
    direct,
    nBuyAmount: String(games.length * 1000),
    param: JSON.stringify(param),
    ROUND_DRAW_DATE: drawDate,
    WAMT_PAY_TLMT_END_DT: payLimit,
    gameCnt: String(games.length),
    saleMdaDcd: "10"
  };
  if (dryRun) return { dryRun: true, round, drawDate, amount: games.length * 1000, games };

  const res = await req.post(`${OL}/olotto/game/execBuy.do`, {
    headers: { ...ajaxHeaders(`${OL}/olotto/game/game645.do`), Origin: OL, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    form
  });
  const body = await res.json().catch(() => null);
  const result = body?.result ?? {};
  const ok = String(result.resultCode) === "100" || String(result.resultMsg).toUpperCase() === "SUCCESS";
  if (!ok || body?.loginYn === "N") throw new DhError(`로또 구매 실패: ${result.resultMsg ?? JSON.stringify(body)?.slice(0, 200)}`);
  const bought = parseLottoLines(result.arrGameChoiceNum);
  return {
    dryRun: false,
    round,
    drawDate,
    amount: games.length * 1000,
    games: games.map((g, idx) => ({ ...g, numbers: bought[idx]?.numbers ?? g.numbers })),
    receipt: { barcode: result.barCode1 ? [result.barCode1, result.barCode2, result.barCode3, result.barCode4, result.barCode5, result.barCode6].join(" ") : null, issueDate: result.issueDay ?? null }
  };
}

async function findPensionFrame(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const frame of page.frames()) {
      const ready = await frame
        .evaluate(() => typeof globalThis.doAuto === "function" && typeof globalThis.doOrderRequest === "function")
        .catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(300);
  }
  throw new DhError("연금복권 구매 화면을 찾지 못했습니다(사이트 변경 또는 로그인 확인).");
}

async function autoNumber(frame, group) {
  await frame.evaluate((g) => {
    globalThis.data = undefined;
    document.querySelector(`#lotto720_radio_group_wrapper_num${g}`)?.click();
    globalThis.doAuto();
  }, group);
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const state = await frame.evaluate(() => {
      const d = globalThis.data;
      return { code: String(d?.resultCode ?? ""), msg: d?.resultMsg ?? "", no: String(d?.selLotNo ?? "") };
    });
    if (state.code && state.code !== "100") throw new DhError(`연금복권 자동번호 실패: ${state.msg || state.code}`);
    if (/^\d{6}$/.test(state.no)) return state.no;
    await frame.page().waitForTimeout(200);
  }
  throw new DhError("연금복권 자동번호를 받지 못했습니다.");
}

/**
 * 연금복권 구매. plan: {sameNumber, number|null, groups:[1..5]}
 * 직접 고른 번호(number)는 이미 팔린 번호면 사이트가 거절할 수 있다.
 */
export async function buyPension(context, plan, { dryRun = true } = {}) {
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  try {
    step("연금복권 구매 화면");
    await page.goto(`${EL}/game/TotalGame.jsp?LottoId=LP72`, { waitUntil: "domcontentloaded", timeout: 30000 });
    checkPage(page.url());
    const frame = await findPensionFrame(page);
    step("연금복권 번호 담기");
    const tickets = [];
    let shared = plan.sameNumber ? plan.number ?? (await autoNumber(frame, 1)) : null;
    for (const group of plan.groups) {
      const number = plan.sameNumber ? shared : await autoNumber(frame, group);
      await frame.evaluate((value) => globalThis.addBuyDataOne(value, 1, "S", "A", true), `${group}${number}`);
      tickets.push({ group, number, source: plan.number ? "chosen" : "auto" });
      await page.waitForTimeout(300);
    }
    if (dryRun) return { dryRun: true, amount: tickets.length * 1000, tickets, dialogs };

    await frame.evaluate(() => globalThis.doOrderRequest());
    const started = Date.now();
    let orderNo = "";
    while (Date.now() - started < 25000 && !orderNo) {
      orderNo = ((await frame.locator("#lotto720_popup_pay .orderNo").first().textContent().catch(() => "")) ?? "").trim();
      const failed = dialogs.find((m) => /실패|오류|불가|부족|제한|로그인|매진|판매/.test(m));
      if (failed) throw new DhError(`연금복권 구매 실패: ${failed}`);
      if (!orderNo) await page.waitForTimeout(300);
    }
    if (!orderNo) throw new DhError("연금복권 구매 완료 확인을 받지 못했습니다. 구매내역을 꼭 확인하세요.");
    return { dryRun: false, amount: tickets.length * 1000, tickets, orderNo };
  } finally {
    await page.close();
  }
}
