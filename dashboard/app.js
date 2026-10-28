// 메가로또·메가연금 대시보드
// 체험 화면: 이 저장소의 data/*.json 을 읽는다.
// 내 저장소 연결: GitHub API로 내 비공개 저장소의 data/·config/ 를 읽고 쓰며, 실행 버튼은 Actions를 부른다.

import { analyzeLotto, analyzePension, lottoRank, pensionRank, PENSION_PRIZE } from "../src/analyze.js";
import { normalizeSettings, isValidLottoGame, LOTTO_MAX_GAMES } from "../src/picks.js";
import { currentLottoRound, currentPensionRound, kstNow } from "../src/time.js";
import { makeNickname, WALL_PHRASES } from "../src/wall.js";

// 원본 저장소 주소 (GitHub에 올린 뒤 정한 주소로 맞춘다)
const PROJECT_REPO = "https://github.com/megahuga/megalotto";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
const eok = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}억 원` : won(n));
const ext = (href, text, cls = "") => `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${text}</a>`;

const CONN_KEY = "megalotto.connection";
const DEMO_SETTINGS_KEY = "megalotto.demoSettings";
const WORKFLOW = "megalotto.yml";

// 쓰는 사람에겐 '무작위'와 '자동'이 같은 것이라 화면에는 '자동' 하나만 보인다 (옛 설정의 random도 자동으로 표시)
const SLOT_LABEL = { auto: "자동", saved: "내 번호", analysis: "분석번호", random: "자동" };
const SLOT_OPTIONS = { auto: "자동 (매주 새 번호)", saved: "내 번호", analysis: "분석번호" };
const PENSION_MODE_LABEL = {
  sameAuto: "자동 · 한 번호로 1~5조 다섯 장",
  auto5: "자동 · 다섯 장 모두 다른 번호",
  sameSaved: "내 번호 · 1~5조 다섯 장",
  sameAnalysis: "분석번호 · 1~5조 다섯 장"
};
const PENSION_MODE_HELP = {
  sameAuto: "가장 많이 쓰는 방식. 동행복권이 뽑은 6자리를 1조~5조로 한 장씩 삽니다. 조까지 맞으면 1등, 번호만 맞아도 2등이라 1·2등을 함께 노려요.",
  auto5: "다섯 장을 서로 다른 번호로 삽니다. 끝자리로 정하는 3~7등을 더 넓게 노리는 방식이에요.",
  sameSaved: "내가 정한 6자리로 1조~5조를 삽니다. 연금복권은 번호마다 한 장뿐이라, 이미 팔린 번호면 그 주 연금은 못 살 수 있어요.",
  sameAnalysis: "분석 화면의 추천 번호로 1조~5조를 삽니다."
};

const state = {
  tab: location.hash.replace("#", "") || "home",
  conn: loadJson(CONN_KEY),
  repo: null,
  runs: [],
  lotto: [],
  pension: [],
  analysis: null,
  purchases: [],
  status: {},
  settings: normalizeSettings({}),
  draft: null,
  settingsSha: null,
  lottoRound: null,
  pensionRound: null,
  drawSeg: "lotto",
  anaSeg: "lotto",
  altLotto: null,
  altPension: null,
  demoPurchases: false,
  wall: [],
  wallLive: false
};

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function saveJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 안 돼도 화면은 동작 */
  }
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2800);
}

/* ---------- GitHub ---------- */

async function gh(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.conn.token}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 160)}`);
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

// 열쇠 만드는 화면을 메가로또에 맞게 미리 채워서 연다 (GitHub가 지원하지 않는 값은 무시된다)
const TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: "메가로또 화면 연결",
  description: "메가로또 대시보드가 내 메가로또 저장소의 설정·기록을 읽고 실행 버튼을 누르는 데 씁니다.",
  expires_in: "366",
  contents: "write",
  actions: "write"
})}`;

/** 열쇠로 볼 수 있는 저장소 중 메가로또 실행 파일이 있는 것을 찾는다 */
async function findMegalottoRepo(token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", { headers });
  if (!res.ok) throw new Error(res.status === 401 ? "열쇠가 맞지 않아요. 다시 복사해 주세요" : `GitHub ${res.status}`);
  const repos = (await res.json()).sort((a, b) => /lotto/i.test(b.name) - /lotto/i.test(a.name));
  for (const r of repos.slice(0, 30)) {
    const check = await fetch(`https://api.github.com/repos/${r.full_name}/contents/.github/workflows/${WORKFLOW}`, { headers });
    if (check.ok) return r.full_name;
  }
  return null;
}

const repoPath = () =>`/repos/${state.conn.owner}/${state.conn.repo}`;
const utf8ToB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64ToUtf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function readData(name, fallback) {
  try {
    if (state.conn) {
      const text = await gh(`${repoPath()}/contents/data/${name}.json`, { raw: true });
      return text ? JSON.parse(text) : fallback;
    }
    const res = await fetch(`../data/${name}.json`, { cache: "no-store" });
    return res.ok ? await res.json() : fallback;
  } catch (e) {
    console.warn(name, e);
    return fallback;
  }
}

async function loadSettings() {
  if (state.conn) {
    const file = await gh(`${repoPath()}/contents/config/settings.json`);
    state.settingsSha = file?.sha ?? null;
    return normalizeSettings(file ? JSON.parse(b64ToUtf8(file.content)) : {});
  }
  const local = loadJson(DEMO_SETTINGS_KEY);
  if (local) return normalizeSettings(local);
  try {
    const res = await fetch("../config/settings.json", { cache: "no-store" });
    return normalizeSettings(res.ok ? await res.json() : {});
  } catch {
    return normalizeSettings({});
  }
}

async function saveSettings(settings) {
  if (!state.conn) {
    saveJson(DEMO_SETTINGS_KEY, settings);
    state.settings = settings;
    toast("체험 화면이라 이 브라우저에만 저장했어요");
    return;
  }
  const res = await gh(`${repoPath()}/contents/config/settings.json`, {
    method: "PUT",
    body: {
      message: "settings: 대시보드에서 설정 변경",
      content: utf8ToB64(`${JSON.stringify(settings, null, 2)}\n`),
      ...(state.settingsSha ? { sha: state.settingsSha } : {})
    }
  });
  state.settingsSha = res?.content?.sha ?? state.settingsSha;
  state.settings = settings;
  toast("저장했어요. 다음 구매부터 적용됩니다");
}

async function runTask(task) {
  if (!state.conn) {
    toast("내 저장소를 연결하면 실행할 수 있어요");
    return;
  }
  await gh(`${repoPath()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: { ref: state.repo?.default_branch ?? "main", inputs: { task } }
  });
  toast({ buy: "구매를 시작했어요. 2~3분 뒤 새로고침하세요", update: "당첨번호 업데이트를 시작했어요", check: "잔액 확인을 시작했어요" }[task]);
  setTimeout(loadRuns, 4000);
}

async function loadRuns() {
  if (!state.conn) return;
  try {
    const data = await gh(`${repoPath()}/actions/workflows/${WORKFLOW}/runs?per_page=5`);
    state.runs = data?.workflow_runs ?? [];
    if (state.tab === "home") render();
  } catch (e) {
    console.warn(e);
  }
}

/* ---------- 데이터 ---------- */

async function loadAll() {
  $("#view").innerHTML = `<div class="container empty">불러오는 중…</div>`;
  try {
    if (state.conn) state.repo = await gh(repoPath());
  } catch (e) {
    toast(`연결 실패: ${e.message}`);
    state.conn = null;
    saveJson(CONN_KEY, null);
  }
  const [lotto, pension, analysis, purchases, status, settings] = await Promise.all([
    readData("lotto-draws", []),
    readData("pension-draws", []),
    readData("analysis", null),
    readData("purchases", []),
    readData("status", {}),
    loadSettings()
  ]);
  state.lotto = lotto;
  state.pension = pension;
  state.analysis = analysis ?? { lotto: lotto.length ? analyzeLotto(lotto) : null, pension: pension.length ? analyzePension(pension) : null };
  state.status = state.conn ? status : {}; // 체험 화면엔 이 저장소 주인의 실행 상태를 보이지 않는다
  settings.lotto.slots = settings.lotto.slots.map((m) => (m === "random" ? "auto" : m));
  state.settings = settings;
  state.draft = structuredClone(settings);
  state.lottoRound = lotto.at(-1)?.round ?? null;
  state.pensionRound = pension.at(-1)?.round ?? null;
  // 체험 화면에는 이 저장소 주인의 실제 기록 대신 늘 예시를 보여 준다
  state.demoPurchases = !state.conn;
  state.purchases = state.demoPurchases ? samplePurchases() : purchases;
  render();
  loadRuns();
  loadWall();
}

/** 체험 화면 예시: 지난 회차에 그 주 분석번호로 샀다면 */
function samplePurchases() {
  const list = [];
  for (const back of [3, 2, 1]) {
    const idx = state.lotto.length - back;
    if (idx < 10) continue;
    const a = analyzeLotto(state.lotto.slice(0, idx));
    const draw = state.lotto[idx];
    list.push({ id: `demo-l-${draw.round}`, product: "lotto", round: draw.round, drawDate: draw.date, dryRun: false, demo: true, amount: 5000, games: a.games.map((g) => ({ slot: g.slot, numbers: g.numbers, source: "analysis" })) });
  }
  for (const back of [2, 1]) {
    const idx = state.pension.length - back;
    if (idx < 10) continue;
    const a = analyzePension(state.pension.slice(0, idx));
    const draw = state.pension[idx];
    list.push({ id: `demo-p-${draw.round}`, product: "pension", round: draw.round, drawDate: draw.date, dryRun: false, demo: true, amount: 5000, mode: "sameAnalysis", tickets: [1, 2, 3, 4, 5].map((g) => ({ group: g, number: a.picks[0].number })) });
  }
  return list;
}

/* ---------- 그리기 도구 ---------- */

const ballClass = (n) => `c${Math.min(5, Math.ceil(n / 10))}`;
// 추첨이 끝난 회차는 맞힌 번호만 색이 살고 못 맞힌 번호는 흐려진다
const ball = (n, { size = "", miss = false } = {}) => `<span class="ball ${ballClass(n)} ${size} ${miss ? "miss" : ""}">${n}</span>`;
function balls(numbers, { size = "", bonus = null, hits = null } = {}) {
  if (!numbers) return `<span class="pending-note">자동번호 · 산 뒤에 보여요</span>`;
  const main = numbers.map((n) => ball(n, { size, miss: hits ? !hits.includes(n) : false })).join("");
  return `<div class="balls">${main}${bonus ? `<span class="plus">+</span>${ball(bonus, { size })}` : ""}</div>`;
}
const ghostBalls = (label, size = "sm") => `<div class="balls">${Array(6).fill(`<span class="ball ghost ${size}">${label}</span>`).join("")}</div>`;
function digits(number, { group = null, size = "" } = {}) {
  const g = group ? `<span class="group-chip ${size}">${group}조</span>` : "";
  // 자리마다 색이 다른 구슬 (십만 자리 → 일 자리)
  return `<div class="digits">${g}${String(number).split("").map((d, i) => `<span class="digit p${i} ${size}">${d}</span>`).join("")}</div>`;
}
function rankBadge(rank, product) {
  if (rank === null || rank === undefined) return `<span class="rank">추첨 전</span>`;
  if (!rank) return `<span class="rank">낙첨</span>`;
  const label = rank === "B" ? "보너스" : `${rank}등`;
  const prize = product === "pension" ? PENSION_PRIZE[rank] : null;
  return `<span class="rank win">${label}${prize ? ` · ${typeof prize === "number" ? won(prize) : prize}` : ""}</span>`;
}

function nextBuyText() {
  const k = kstNow();
  const minutes = k.getUTCHours() * 60 + k.getUTCMinutes();
  let add = (1 - k.getUTCDay() + 7) % 7;
  if (add === 0 && minutes >= 9 * 60 + 30) add = 7;
  const d = new Date(k.getTime() + add * 86400000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(월) 오전 9시 30분`;
}

function weekStatus(product, round) {
  const p = [...state.purchases].reverse().find((x) => x.product === product && x.round === round && !x.demo);
  if (!p) return "구매 대기";
  return p.dryRun ? "시험만 함" : "구매 완료";
}

const weeklyAmount = (s = state.settings) => (s.lotto.enabled ? s.lotto.slots.length * 1000 : 0) + (s.pension.enabled ? 5000 : 0);

function pageTitle(eyebrow, title, sub = "") {
  return `<div class="container page-title"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>`;
}
function secHead(eyebrow, title, sub = "") {
  return `<div class="sec-head"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>`;
}

/* ---------- 이번 주 ---------- */

function plannedLottoRows() {
  const s = state.settings;
  const cur = currentLottoRound().round;
  const ana = state.analysis?.lotto?.round === cur ? state.analysis.lotto : null;
  let ai = 0;
  let si = 0;
  return s.lotto.slots
    .map((mode, idx) => {
      let body;
      if (mode === "analysis" && ana?.games?.[ai]) body = balls(ana.games[ai++].numbers, { size: "sm" });
      else if (mode === "saved" && s.lotto.saved[si]) body = balls(s.lotto.saved[si++], { size: "sm" });
      else if (mode === "random" || mode === "auto") body = `<span class="pending-note">살 때 새 번호가 정해져요</span>`;
      else body = `<span class="pending-note">${mode === "saved" ? "내 번호가 없어 자동으로 사요" : "분석이 끝나면 채워져요"}</span>`;
      return `<div class="row"><span class="lbl">${"ABCDE"[idx]} <span class="tag ${mode}">${SLOT_LABEL[mode]}</span></span>${body}</div>`;
    })
    .join("");
}

function plannedPension() {
  const s = state.settings.pension;
  const cur = currentPensionRound().round;
  const ana = state.analysis?.pension?.round === cur ? state.analysis.pension : null;
  let number = null;
  if (s.mode === "sameAnalysis") number = ana?.picks?.[0]?.number ?? null;
  if (s.mode === "sameSaved") number = s.saved || null;
  const body = number ? digits(number, { size: "sm" }) : `<span class="pending-note">살 때 동행복권이 번호를 정해요</span>`;
  return `<div class="row"><span class="lbl">1~5조</span>${body}<span class="note">${PENSION_MODE_LABEL[s.mode]}</span></div>`;
}

function heroArt() {
  const items = [
    [7, 0, 40, 150],
    [21, 150, 0, 120],
    [33, 280, 70, 110],
    [12, 70, 190, 130],
    [44, 220, 210, 140],
    [3, 330, 310, 90]
  ];
  return `<div class="hero-art" aria-hidden="true">${items
    .map(([n, x, y, size]) => `<span class="ball ${ballClass(n)}" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;font-size:${size * 0.38}px">${n}</span>`)
    .join("")}</div>`;
}

function renderHome() {
  const s = state.settings;
  const lr = currentLottoRound();
  const pr = currentPensionRound();
  const weekly = weeklyAmount();
  const balance = state.status.balance;
  const lastL = state.lotto.at(-1);
  const lastP = state.pension.at(-1);

  const hero = state.conn
    ? `<span class="eyebrow">내 메가로또 · ${esc(state.conn.owner)}</span>
       <h1>한 주 ${won(weekly)},<br />${nextBuyText()}에<br />알아서 삽니다</h1>
       <p class="lead">로또 ${s.lotto.enabled ? `${s.lotto.slots.length}게임` : "끔"} · 연금복권 ${s.pension.enabled ? "5장" : "끔"} · ${s.dryRun ? "지금은 시험 실행이라 실제로 사지 않아요" : "실제 구매가 켜져 있어요"}</p>
       <div class="actions"><button class="action" data-run="buy">지금 구매 실행 <span class="arrow">→</span></button><button class="action secondary" data-tab="settings">번호 바꾸기</button></div>`
    : `<span class="eyebrow">완전 무료 · 결제창 없음 · 소스 전부 공개</span>
       <h1>매주 복권 사기,<br />이제 잊어버리세요</h1>
       <p class="lead">매주 사러 가기 귀찮은 분을 위해 만들었습니다. 월요일 오전 9시 30분, 내 동행복권 계정으로 로또 5게임과 연금복권 5장을 대신 삽니다. 번호는 <b>자동</b>으로 두거나 <b>내 번호</b>를 정해 두면 끝. 컴퓨터를 꺼 둬도 됩니다.</p>
       <div class="actions"><button class="action" data-tab="start">무료로 시작하기 <span class="arrow">→</span></button><a class="action secondary" href="#picks">번호 고르는 법 보기</a></div>
       <p class="hero-note">충주에서 AI 회사를 하는 대표가, 회사를 알리려고 직접 쓰던 걸 무료로 공개했습니다. 내 GitHub에서 돌아가서 <b>저희는 돈도 받을 수 없고, 비밀번호도 볼 수 없습니다.</b></p>`;

  const facts = state.conn
    ? [
        ["예치금", balance === undefined ? "—" : won(balance), balance === undefined ? "잔액 확인 전" : balance < weekly ? "충전이 필요해요" : `${Math.floor(balance / Math.max(weekly, 1))}주 살 수 있어요`],
        ["한 주 금액", won(weekly), `로또 ${s.lotto.enabled ? won(s.lotto.slots.length * 1000) : "끔"} · 연금 ${s.pension.enabled ? "5,000원" : "끔"}`],
        [`로또 ${lr.round}회`, weekStatus("lotto", lr.round), `${lr.drawDate} (토) 추첨`],
        [`연금 ${pr.round}회`, weekStatus("pension", pr.round), `${pr.drawDate} (목) 추첨`]
      ]
    : [
        ["이용료", "무료", "결제창 없음 · 앞으로도 0원"],
        ["한 주 금액", "10,000원", "로또 5천 + 연금 5천"],
        ["다음 구매", nextBuyText().replace(" 오전 9시 30분", ""), "오전 9시 30분 자동"],
        ["번호", "자동 · 내 번호", "분석번호도 고를 수 있어요"]
      ];

  const runs = state.runs
    .map((r) => `<tr><td>${new Date(r.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>${r.event === "schedule" ? "예약" : "직접"}</td><td>${r.status === "completed" ? (r.conclusion === "success" ? "성공" : "실패") : "진행 중"}</td><td>${ext(esc(r.html_url), "기록", "text-link")}</td></tr>`)
    .join("");

  const week = (tone) => `<section class="band ${tone}"><div class="container">
      ${secHead(`로또 ${lr.round}회 · 연금복권 ${pr.round}회`, state.conn ? "이번 주에 살 번호" : "이번 주에 산다면 이런 번호예요", state.conn ? "설정에서 게임마다 분석번호·저장번호·무작위·자동을 고를 수 있어요." : "기본 설정(자동 5게임 + 연금 자동 5장) 기준이에요. 번호·설정에서 바꿀 수 있어요.")}
      <div class="grid g2">
        <div class="card"><h3>메가로또 <small>${koDate(lr.drawDate, { year: false })} 추첨</small></h3><div class="rows">${s.lotto.enabled ? plannedLottoRows() : `<div class="empty">로또 구매가 꺼져 있어요</div>`}</div></div>
        <div class="card"><h3>메가연금 <small>${koDate(pr.drawDate, { year: false })} 추첨</small></h3><div class="rows">${s.pension.enabled ? plannedPension() : `<div class="empty">연금복권 구매가 꺼져 있어요</div>`}</div>
          ${state.conn
            ? `<h3 class="mt">지금 실행</h3><div class="actions"><button class="action compact" data-run="buy">지금 구매</button><button class="action compact secondary" data-run="update">당첨번호 업데이트</button><button class="action compact secondary" data-run="check">잔액 확인</button></div>${runs ? `<table class="table mt"><tr><th>시각</th><th>방식</th><th>결과</th><th></th></tr>${runs}</table>` : ""}`
            : `<div class="mini-cta"><p>내 계정으로 매주 자동으로 사려면</p><button class="action compact" data-tab="start">무료로 시작하기 →</button></div>`}
        </div>
      </div>
    </div></section>`;

  const picks = (tone) => `<section class="band ${tone}" id="picks"><div class="container">
      ${secHead("번호 고르기", "번호는 이렇게 골라요", "게임마다 섞어도 됩니다. 예를 들어 내 번호 2게임 + 자동 3게임.")}
      <div class="pick-cards">
        
        <div class="pick-card"><span class="pick-ico">🎲</span><h3>자동</h3><p>판매점에서 "자동으로 주세요"와 같습니다. 매주 새 번호로 삽니다. 가장 간단해요.</p><span class="pending-note">살 때 새 번호가 정해져요</span></div>
        <div class="pick-card"><span class="pick-ico">⭐</span><h3>내 번호로</h3><p>생일·기념일처럼 정해 둔 번호를 매주 똑같이 삽니다.</p>${balls([3, 7, 15, 21, 33, 42], { size: "sm" })}</div>
        
        <div class="pick-card"><span class="pick-ico">📊</span><h3>분석번호 (참고)</h3><p>지난 당첨 흐름을 참고한 번호입니다. 당첨 확률이 오르지는 않아요.</p>${state.analysis?.lotto?.games?.[0] ? balls(state.analysis.lotto.games[0].numbers, { size: "sm" }) : ""}</div>
      </div>
      <div class="actions mt"><button class="action" data-tab="settings">번호 골라 보기 <span class="arrow">→</span></button></div>
    </div></section>`;

  const recent = (tone) => `<section class="band ${tone}"><div class="container">
      ${secHead("최근 당첨번호", "지난주 추첨 결과", `<a class="text-link" href="#draws" data-tab="draws">1회부터 전체 당첨번호 보기 →</a>`)}
      <div class="grid g2">
        ${lastL ? lottoResult(lastL, { compact: true }) : `<div class="card empty">자료 없음</div>`}
        ${lastP ? pensionResult(lastP, { compact: true }) : `<div class="card empty">자료 없음</div>`}
      </div>
    </div></section>`;

  const how = (tone) => `<section class="band ${tone}"><div class="container">
      ${secHead("PC 프로그램과 다른 점", "내 컴퓨터에 설치하지 않습니다", "메가로또는 내 GitHub 공간(무료)에 복사해 두면 GitHub 컴퓨터가 정해진 시간에 대신 실행합니다.")}
      <div class="compare">
        <div class="compare-col"><span class="compare-tag">흔한 PC 설치형</span><ul><li><i>✕</i>구매 시간에 내 PC가 <b>켜져 있어야</b> 삽니다</li><li><i>✕</i>PC가 꺼져 있거나 절전이면 그 주는 놓칩니다</li><li><i>✕</i>설치·업데이트를 직접 해야 합니다</li></ul></div>
        <div class="compare-col on"><span class="compare-tag">메가로또</span><ul><li><i>✓</i>PC를 <b>꺼 둬도</b> 매주 삽니다</li><li><i>✓</i>휴대폰으로 이 화면을 열어 확인합니다</li><li><i>✓</i>설치 없음, 업데이트도 버튼 하나</li></ul></div>
      </div>
      <div class="trust">
        <div><b>GitHub가 뭔가요?</b><p>마이크로소프트가 운영하는, 전 세계 1억 명이 넘는 개발자가 쓰는 개발 서비스입니다. 구글·마이크로소프트 같은 큰 회사들도 공개 소스 코드를 여기서 관리합니다. 메가로또는 그 안의 '자동 실행' 기능을 무료로 빌려 씁니다.</p></div>
        <div><b>왜 더 안심인가요?</b><p>내 PC에 낯선 설치 파일을 깔지 않습니다. 프로그램이 하는 일은 코드로 전부 공개돼 있고, 내 비밀번호는 GitHub 암호화 금고에만 있습니다.</p></div>
      </div>
      <ol class="timeline">
        <li><span>일요일 오전 7시</span><b>당첨번호 받고 분석</b><p>1회부터 최신 회차까지 다시 분석해 이번 주 분석번호 5게임을 만듭니다.</p></li>
        <li><span>월요일 오전 9시 30분</span><b>로또 5게임 + 연금 5장 구매</b><p>이미 샀으면 다시 사지 않고, 예치금이 모자라면 사지 않고 알려 줍니다.</p></li>
        <li><span>추첨 다음 날</span><b>당첨 확인</b><p>연금은 목요일, 로또는 토요일 추첨 뒤 구매현황에 등수를 표시합니다.</p></li>
      </ol>
    </div></section>`;

  const start3 = (tone) => `<section class="band ${tone}"><div class="container">
      ${secHead("처음 오셨나요?", "세 단계면 끝납니다", "한 번만 해 두면 매주 알아서 삽니다. 10분이면 됩니다.")}
      <div class="how3">
        <div><b>01</b><h3>내 메가로또 만들기</h3><p>버튼 한 번으로 메가로또를 내 GitHub(무료)에 복사합니다.</p></div>
        <div><b>02</b><h3>동행복권 계정 넣기</h3><p>아이디·비밀번호는 내 GitHub 금고에 <b>암호화돼</b> 들어갑니다. 넣은 뒤엔 나도 다시 볼 수 없고, 메가허가에도 오지 않습니다. 예치금도 충전해 둡니다.</p></div>
        <div><b>03</b><h3>번호 방식 고르기</h3><p>자동으로 둘지, 내 번호로 살지 고르면 끝. 결과는 이 화면에서 봅니다.</p></div>
      </div>
      ${depositNote()}
      <div class="actions mt"><button class="action" data-tab="start">무료로 시작하기 <span class="arrow">→</span></button></div>
    </div></section>`;

  const sections = state.conn ? [week("plain"), wallSection("soft"), recent("plain"), how("soft")] : [start3("plain"), picks("soft"), wallSection("plain"), how("soft"), recent("plain"), safetyBand("soft")];

  return `
    <section class="hero">
      ${heroArt()}<div class="hero-wash"></div>
      <div class="container"><div class="hero-copy">
        ${state.status.lastBuyOk === false ? `<div class="notice">지난 실행이 실패했어요: ${esc(state.status.lastError)}</div>` : ""}
        ${state.conn && balance !== undefined && balance < weekly ? `<div class="notice"><b>예치금이 모자라요.</b> 지금 ${won(balance)} · 한 주에 ${won(weekly)}이 필요합니다. 충전하지 않으면 이번 주는 사지 않습니다. ${ext("https://www.dhlottery.co.kr", "동행복권에서 충전하기 →", "text-link")}</div>` : ""}
        ${hero}
      </div>
      <div class="hero-facts">${facts.map(([a, b, c]) => `<div><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("")}</div>
      </div>
    </section>
    ${sections.join("")}`;
}

/** 예치금 안내: 미리 충전 안 하면 그 주는 못 산다 */
function depositNote() {
  return `<div class="deposit-note"><b>💳 예치금을 꼭 미리 충전해 두세요</b><p>메가로또는 동행복권 <b>예치금으로만</b> 삽니다. 예치금이 모자라면 <b>그 주는 사지 않고</b> 알림만 보냅니다(카드로 대신 결제되지 않아요). 한 주 최대 1만 원이라 한 달에 4~5만 원이면 넉넉합니다.</p></div>`;
}

/** 보안 안내: 비밀번호는 내 GitHub 금고에만, GitHub 계정만 지키면 된다 */
function safetyBand(tone = "soft") {
  return `<section class="band ${tone}"><div class="container">
    ${secHead("보안", "내 비밀번호는 내 GitHub 금고에만 있습니다")}
    <div class="safe-key"><b>GitHub 계정만 안전하게 지키면 됩니다.</b><p>동행복권 비밀번호는 메가허가를 포함해 누구의 서버에도 가지 않습니다. GitHub 2단계 인증을 켜 두면 더 안전합니다.</p></div>
    <div class="safe-box">
      <div><h3>암호화된 금고에 보관</h3><p>동행복권 아이디·비밀번호는 내 GitHub 저장소의 비밀값(Secrets)에 암호화돼 들어갑니다. 저장한 뒤에는 나도 다시 볼 수 없고, 실행 기록에도 가려집니다.</p></div>
      <div><h3>메가허가는 받지 않습니다</h3><p>이 화면과 메가허가 서버에는 동행복권 비밀번호가 오지 않습니다. 화면 연결용 GitHub 열쇠도 내 브라우저에만 저장됩니다.</p></div>
      <div><h3>코드가 전부 공개</h3><p>무슨 일을 하는지 누구나 코드를 열어 확인할 수 있습니다. 하는 일은 로그인 → 잔액 확인 → 구매 → 결과 확인뿐입니다.</p></div>
    </div>
  </div></section>`;
}

/* ---------- 당첨번호 ---------- */

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** '2026-10-24' → '2026년 10월 24일 (토)' */
function koDate(iso, { year = true } = {}) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y) return esc(iso);
  const w = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${year ? `${y}년 ` : ""}${m}월 ${d}일 (${w})`;
}

const LOTTO_RULES = ["6개 번호 일치", "5개 + 보너스 번호 일치", "5개 번호 일치", "4개 번호 일치", "3개 번호 일치"];

function lottoResult(d, { compact = false } = {}) {
  const prizes = d.prizes ?? [[d.prize1, d.winners1]];
  const table = prizes
    .map(([amt, cnt], i) => `<tr><td><b>${i + 1}등</b></td><td class="money">${won(amt)}</td><td>${cnt.toLocaleString("ko-KR")}명</td>${compact ? "" : `<td class="rule">${LOTTO_RULES[i]}</td>`}</tr>`)
    .join("");
  return `<div class="card result">
    <div class="result-head"><span class="result-kind">로또 6/45</span><div class="result-round">${d.round}회</div><div class="result-date">${koDate(d.date)} 추첨</div></div>
    <div class="result-balls">${balls(d.numbers, { size: "lg", bonus: d.bonus })}<div class="ball-legend"><span>당첨번호</span><span>보너스</span></div></div>
    <div class="jackpot"><span>1등 당첨금 (1인당)</span><b>${won(d.prize1)}</b><small>${d.winners1 ? `${d.winners1}명 당첨 · ${eok(d.prize1)}` : "1등 당첨자 없음"}</small></div>
    <table class="prize-table"><tr><th>등수</th><th>1인당 당첨금</th><th>당첨자</th>${compact ? "" : "<th>맞힌 번호</th>"}</tr>${table}</table>
    ${compact ? "" : `<p class="help mt">이번 회차 판매액 ${eok(d.sales)}</p>`}
  </div>`;
}

const PENSION_RULES = [
  ["1등", "조 + 6자리 모두", "월 700만 원 × 20년"],
  ["2등", "조 상관없이 6자리", "월 100만 원 × 10년"],
  ["보너스", "각 조 보너스 6자리", "월 100만 원 × 10년"],
  ["3등", "끝 5자리", "100만 원"],
  ["4등", "끝 4자리", "10만 원"],
  ["5등", "끝 3자리", "5만 원"],
  ["6등", "끝 2자리", "5,000원"],
  ["7등", "끝 1자리", "1,000원"]
];

function pensionResult(d, { compact = false } = {}) {
  const rows = (compact ? PENSION_RULES.slice(0, 3) : PENSION_RULES)
    .map(([r, rule, prize]) => `<tr><td><b>${r}</b></td><td class="money">${prize}</td><td class="rule">${rule}</td></tr>`)
    .join("");
  return `<div class="card result">
    <div class="result-head"><span class="result-kind">연금복권 720+</span><div class="result-round">${d.round}회</div><div class="result-date">${koDate(d.date)} 추첨</div></div>
    <div class="result-balls">${digits(d.number, { group: d.group })}<div class="ball-legend"><span>1등 번호</span></div></div>
    <div class="jackpot"><span>1등 당첨금</span><b>월 700만 원 × 20년</b><small>총 16억 8천만 원 · 보너스 번호 각 조 ${d.bonus}</small></div>
    <table class="prize-table"><tr><th>등수</th><th>당첨금</th><th>맞힐 것</th></tr>${rows}</table>
  </div>`;
}

function roundNav(kind, round) {
  const p = kind === "lotto" ? "l" : "p";
  return `<div class="nav-round"><button class="action compact secondary" data-${p}r="-1" aria-label="이전 회차">◀ 이전</button><input type="number" id="${p}RoundInput" value="${round ?? ""}" aria-label="회차" /><span>회</span><button class="action compact" id="${p}Go">보기</button><button class="action compact secondary" data-${p}r="1" aria-label="다음 회차">다음 ▶</button></div>`;
}

function renderDraws() {
  const seg = `<div class="seg"><button data-dseg="lotto" class="${state.drawSeg === "lotto" ? "on" : ""}">로또 6/45</button><button data-dseg="pension" class="${state.drawSeg === "pension" ? "on" : ""}">연금복권 720+</button></div>`;
  if (state.drawSeg === "pension") {
    const d = state.pension.find((x) => x.round === state.pensionRound) ?? state.pension.at(-1);
    const recent = state.pension.slice(-10).reverse();
    return `${pageTitle("당첨번호", "연금복권 720+ 당첨번호", `매주 목요일 저녁 7시 추첨 · 1회부터 ${state.pension.at(-1)?.round ?? "-"}회까지`)}
      <div class="container page-body">${seg}${roundNav("pension", d?.round)}
        <div class="mt">${d ? pensionResult(d) : `<div class="card empty">자료 없음</div>`}</div>
        <div class="card mt"><h3>최근 10회</h3><div class="rows">${recent.map((x) => `<button class="row row-btn draw-row" data-pick-p="${x.round}"><span class="lbl">${x.round}회 <span class="stat-sub">${koDate(x.date)}</span></span>${digits(x.number, { group: x.group, size: "sm" })}</button>`).join("")}</div></div>
      </div>`;
  }
  const d = state.lotto.find((x) => x.round === state.lottoRound) ?? state.lotto.at(-1);
  const recent = state.lotto.slice(-10).reverse();
  return `${pageTitle("당첨번호", "로또 6/45 당첨번호", `매주 토요일 저녁 8시 35분 추첨 · 1회부터 ${state.lotto.at(-1)?.round ?? "-"}회까지`)}
    <div class="container page-body">${seg}${roundNav("lotto", d?.round)}
      <div class="mt">${d ? lottoResult(d) : `<div class="card empty">자료 없음</div>`}</div>
      <div class="card mt"><h3>최근 10회 <small>누르면 자세히 보여요</small></h3><div class="rows">${recent.map((x) => `<button class="row row-btn draw-row" data-pick-l="${x.round}"><span class="lbl">${x.round}회 <span class="stat-sub">${koDate(x.date)}</span></span>${balls(x.numbers, { size: "sm", bonus: x.bonus })}<span class="stat-sub">1등 ${eok(x.prize1)}</span></button>`).join("")}</div></div>
    </div>`;
}

/* ---------- 분석 ---------- */

function renderAnalysis() {
  const seg = `<div class="seg"><button data-aseg="lotto" class="${state.anaSeg === "lotto" ? "on" : ""}">메가로또 분석</button><button data-aseg="pension" class="${state.anaSeg === "pension" ? "on" : ""}">메가연금 분석</button></div>`;
  if (state.anaSeg === "pension") {
    const a = state.altPension ?? state.analysis?.pension;
    if (!a) return `${pageTitle("분석", "메가연금 분석")}<div class="container empty">자료 없음</div>`;
    const pos = ["십만", "만", "천", "백", "십", "일"];
    return `${pageTitle("분석", `연금복권 ${a.round}회 분석번호`, `${a.basedOn?.round}회까지 자리별 출현을 분석했습니다`)}
      <div class="container page-body">${seg}
        <div class="notice info"><b>독립시행 안내</b> · 추첨은 매번 처음부터 다시 하는 무작위 추첨이라, 지난 결과로 다음 번호를 맞힐 수는 없습니다. 분석번호는 번호 고르는 수고를 덜어 주는 방법일 뿐 당첨 확률을 높이지 않습니다.</div><div class="card"><h3>분석 리포트</h3><ul class="report">${a.report.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
        <div class="card mt"><h3>추천 번호 3개 <button class="action compact secondary" id="altPension">다른 번호 보기</button></h3>
          <div class="rows">${a.picks.map((p, i) => `<div class="row"><span class="lbl">${esc(p.name)}</span>${digits(p.number, { size: "sm" })}<span class="note">${esc(p.summary)}${i === 0 && !state.altPension ? " · '분석번호' 방식으로 살 때 이 번호를 씁니다" : ""}</span><button class="action compact secondary" data-save-pension="${p.number}">내 번호로 담기</button></div>`).join("")}</div>
        </div>
        <div class="grid g2 mt">
          <div class="card"><h3>자리별 많이 나온 숫자 <small>최근 ${a.stats.recentCount}회</small></h3>
            <table class="table"><tr><th>자리</th><th>1위</th><th>2위</th><th>3위</th></tr>${a.stats.topRecentDigits.map((t, i) => `<tr><td>${pos[i]}</td>${t.map((dg) => `<td><b>${dg}</b> <span class="stat-sub">${a.stats.recentDigits[i][dg]}회</span></td>`).join("")}</tr>`).join("")}</table></div>
          <div class="card"><h3>조별 1등 횟수 <small>전체 ${a.stats.total}회</small></h3>
            <div class="rows">${[1, 2, 3, 4, 5].map((g) => `<div class="row"><span class="lbl">${g}조</span><div class="meter"><i style="width:${(a.stats.groups[g] / Math.max(...a.stats.groups)) * 100}%"></i></div><b>${a.stats.groups[g]}회</b></div>`).join("")}</div></div>
        </div>
      </div>`;
  }
  const a = state.altLotto ?? state.analysis?.lotto;
  if (!a) return `${pageTitle("분석", "메가로또 분석")}<div class="container empty">자료 없음</div>`;
  const maxRecent = Math.max(...a.stats.recent.slice(1), 1);
  return `${pageTitle("분석", `로또 ${a.round}회 분석번호`, `1회부터 ${a.basedOn?.round}회까지 당첨번호를 매주 다시 분석합니다`)}
    <div class="container page-body">${seg}
      <div class="notice info"><b>독립시행 안내</b> · 추첨은 매번 처음부터 다시 하는 무작위 추첨이라, 지난 결과로 다음 번호를 맞힐 수는 없습니다. 분석번호는 번호 고르는 수고를 덜어 주는 방법일 뿐 당첨 확률을 높이지 않습니다.</div><div class="card"><h3>분석 리포트</h3><ul class="report">${a.report.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
      <div class="card mt"><h3>추천 번호 5게임 <span class="actions"><button class="action compact secondary" id="altLotto">다른 조합 보기</button>${state.altLotto ? `<button class="action compact secondary" id="resetLotto">이번 주 기본으로</button>` : ""}</span></h3>
        ${state.altLotto ? `<div class="notice info">새로 뽑은 조합이에요. 사려면 '내 번호로 담기'를 누르고, 번호·설정에서 그 칸을 '내번호'로 두세요.</div>` : `<p class="help" style="margin:-6px 0 12px">설정에서 '분석번호'로 둔 칸은 이 번호를 순서대로 삽니다.</p>`}
        <div class="rows">${a.games.map((g) => `<div class="game"><div class="name">Game ${g.slot} · ${esc(g.name)}<small>${esc(g.summary)}</small></div>${balls(g.numbers)}<div class="why">${esc(g.reason)}</div><div class="acts"><button class="action compact secondary" data-save-lotto="${g.numbers.join(",")}">내 번호로 담기</button></div></div>`).join("")}</div>
      </div>
      <div class="card mt"><h3>최근 ${a.stats.recentCount}회 번호별 출현 <small>진한 막대 = 많이 나온 8개</small></h3>
        <div class="bars">${a.stats.recent.slice(1).map((c, i) => `<div class="${a.stats.hot.includes(i + 1) ? "hot" : ""}" style="height:${(c / maxRecent) * 100}%" title="${i + 1}번 ${c}회"></div>`).join("")}</div>
        <div class="bars-x">${Array.from({ length: 45 }, (_, i) => `<span>${i + 1}</span>`).join("")}</div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>자주 나온 번호 <small>최근 ${a.stats.recentCount}회</small></h3><div class="balls">${a.stats.hot.map((n) => ball(n, { size: "sm" })).join("")}</div>
          <h3 class="mt">덜 나온 번호</h3><div class="balls">${a.stats.cold.map((n) => ball(n, { size: "sm" })).join("")}</div></div>
        <div class="card"><h3>오래 쉰 번호</h3><div class="rows">${a.stats.longAbsent.slice(0, 6).map((x) => `<div class="row">${ball(x.n, { size: "sm" })}<span>${x.gap}회째 안 나옴</span></div>`).join("")}</div></div>
      </div>
    </div>`;
}

/* ---------- 구매현황 ---------- */

function renderHistory() {
  const lottoByRound = new Map(state.lotto.map((d) => [d.round, d]));
  const pensionByRound = new Map(state.pension.map((d) => [d.round, d]));
  const real = state.purchases.filter((p) => !p.dryRun && !p.demo);
  let wins = 0;
  // 최근 추첨이 위로, 같은 주에는 로또가 먼저
  const cards = [...state.purchases]
    .sort((a, b) => String(b.drawDate).localeCompare(String(a.drawDate)) || (a.product === "lotto" ? -1 : 1))
    .map((p) => {
      const flag = p.demo ? `<span class="chip">예시</span>` : p.dryRun ? `<span class="chip warn">시험 (구매 안 함)</span>` : `<span class="chip ok">구매</span>`;
      const counts = !p.demo && !p.dryRun;
      if (p.product === "lotto") {
        const draw = lottoByRound.get(p.round);
        const rows = p.games
          .map((g) => {
            const rank = draw ? (g.numbers ? lottoRank(g.numbers, draw) : null) : undefined;
            if (rank && counts) wins += 1;
            return `<div class="row"><span class="lbl">${g.slot} <span class="tag ${g.source}">${SLOT_LABEL[g.source] ?? esc(g.source)}</span></span>${balls(g.numbers, { size: "sm", hits: draw?.numbers })}${rankBadge(rank)}</div>`;
          })
          .join("");
        return `<div class="card mt"><h3>로또 ${p.round}회 <span class="actions">${flag}<small>${p.drawDate} 추첨 · ${won(p.amount)}</small><button class="action compact" data-wall="${esc(p.id)}">홈페이지에 공유</button><button class="action compact secondary" data-share="${esc(p.id)}">카톡으로 보내기</button></span></h3>${draw ? `<p class="stat-sub" style="margin:-6px 0 10px">당첨번호 ${draw.numbers.join(" ")} + ${draw.bonus}</p>` : ""}<div class="rows">${rows}</div></div>`;
      }
      const draw = pensionByRound.get(p.round);
      const rows = p.tickets
        .map((t) => {
          const rank = draw ? pensionRank(t.group, t.number, draw) : undefined;
          if (rank && counts) wins += 1;
          return `<div class="row">${digits(t.number, { group: t.group, size: "sm" })}${rankBadge(rank, "pension")}</div>`;
        })
        .join("");
      return `<div class="card mt"><h3>연금복권 ${p.round}회 <span class="actions">${flag}<small>${p.drawDate} 추첨 · ${won(p.amount)}</small><button class="action compact" data-wall="${esc(p.id)}">홈페이지에 공유</button><button class="action compact secondary" data-share="${esc(p.id)}">카톡으로 보내기</button></span></h3>${draw ? `<p class="stat-sub" style="margin:-6px 0 10px">당첨 ${draw.group}조 ${draw.number} · 보너스 ${draw.bonus}</p>` : ""}<div class="rows">${rows}</div></div>`;
    })
    .join("");
  return `${pageTitle("구매현황", "산 번호와 당첨 결과", "추첨이 끝나면 등수를 자동으로 표시합니다")}
    <div class="container page-body">
      ${state.demoPurchases ? `<div class="notice info">체험 화면 예시예요. 지난 회차에 그 주 분석번호로 샀다면 어땠는지 보여 줍니다.</div>` : ""}
      <div class="grid g4">
        <div class="card"><div class="stat-label">실제 구매</div><div class="stat">${real.length}건</div></div>
        <div class="card"><div class="stat-label">구매 금액</div><div class="stat">${won(real.reduce((a, p) => a + (p.amount || 0), 0))}</div></div>
        <div class="card"><div class="stat-label">당첨 게임·장</div><div class="stat">${wins}</div></div>
        <div class="card"><div class="stat-label">예치금</div><div class="stat">${state.status.balance === undefined ? "—" : won(state.status.balance)}</div></div>
      </div>
      ${cards || `<div class="card mt empty">아직 구매 기록이 없어요. 월요일 오전 9시 30분에 첫 구매를 합니다.</div>`}
    </div>`;
}

/* ---------- 설정 ---------- */

function renderSettings() {
  const d = state.draft;
  const c = state.conn ?? {};
  const slotSelect = (mode, idx) =>
    `<div class="slot"><b>${"ABCDE"[idx]}</b><select data-slot="${idx}">${Object.entries(SLOT_OPTIONS).map(([k, v]) => `<option value="${k}" ${k === mode ? "selected" : ""}>${v}</option>`).join("")}</select></div>`;
  const lmode = new Set(d.lotto.slots).size === 1 ? d.lotto.slots[0] : "mix";
  const modeCard = (key, ico, title, desc) => `<label class="choice ${lmode === key ? "on" : ""}"><input type="radio" name="lmode" value="${key}" ${lmode === key ? "checked" : ""} /><span class="pick-ico">${ico}</span><b>${title}</b><small>${desc}</small></label>`;
  const connectCard = state.conn ? `<div class="card">
        <h3>내 메가로또 <span class="chip ok">연결됨</span></h3>
        <p style="margin:-6px 0 14px"><b>${esc(c.owner)}/${esc(c.repo)}</b> 저장소와 연결돼 있어요.</p>
        <div class="actions">${ext(`https://github.com/${esc(c.owner)}/${esc(c.repo)}/settings/secrets/actions`, "동행복권 계정 넣기·바꾸기", "action compact secondary")}${ext(`https://github.com/${esc(c.owner)}/${esc(c.repo)}/actions`, "실행 기록 보기", "action compact secondary")}<button class="action compact danger" id="disconnect">이 브라우저에서 연결 끊기</button></div>
      </div>` : `<div class="card">
        <h3>내 메가로또 연결하기 <span class="chip">지금은 체험 화면</span></h3>
        <p class="help" style="margin-top:-6px">GitHub 열쇠를 하나 만들어 붙여 넣으면, 내 메가로또를 찾아 이 화면과 연결합니다. 열쇠는 이 브라우저에만 저장됩니다.</p>
        <div class="steps">
          <div class="step"><div><h3>GitHub 열쇠 만들기</h3><p>버튼을 누르면 GitHub 열쇠 만드는 화면이 열립니다. <b>Repository access</b>에서 <code>Only select repositories</code> → 내 메가로또 저장소를 고르고, <b>Permissions</b>에서 <code>Contents</code>와 <code>Actions</code>를 <code>Read and write</code>로 바꾼 뒤 <b>Generate token</b>을 누르세요.</p>
            <div class="actions">${ext(TOKEN_URL, "GitHub 열쇠 만들기 →", "action compact")}</div></div></div>
          <div class="step"><div><h3>열쇠 붙여 넣기</h3><p><code>github_pat_</code>로 시작하는 글자를 복사해 아래에 붙여 넣고 연결을 누르세요.</p>
            <div class="field" style="margin:0"><input type="password" id="cToken" placeholder="github_pat_로 시작하는 열쇠" autocomplete="off" /></div>
            <div class="actions mt"><button class="action" id="connect">연결하기</button></div>
            <details class="help mt"><summary>저장소를 직접 고르고 싶어요</summary>
              <div class="grid g2 mt"><div class="field"><label>GitHub 아이디</label><input type="text" id="cOwner" placeholder="예: megahuga" autocomplete="off" /></div><div class="field"><label>저장소 이름</label><input type="text" id="cRepo" placeholder="예: megalotto" autocomplete="off" /></div></div>
            </details></div></div>
        </div>
      </div>`;
  return `${pageTitle("번호·설정", "어떤 번호로 살까요?", state.conn ? "바꾼 뒤 맨 아래 '설정 저장'을 누르면 다음 구매부터 적용됩니다." : "체험 화면에서는 이 브라우저에만 저장됩니다. 내 것으로 쓰려면 맨 아래에서 연결하세요.")}
    <div class="container page-body">
      <div class="card">
        <h3>로또 번호 <small>한 주 최대 5게임 · 5,000원</small></h3>
        <div class="choices">
          ${modeCard("auto", "🎲", "자동", "매주 새 번호 (판매점 자동과 같음)")}
          ${modeCard("saved", "⭐", "내 번호", "정해 둔 번호를 매주 똑같이")}
          ${modeCard("analysis", "📊", "분석번호", "지난 당첨 흐름 참고")}
          ${modeCard("mix", "🧩", "게임마다 다르게", "직접 섞기")}
        </div>
        ${lmode === "mix" ? `<div class="field mt"><label>게임별로 고르기</label><div class="slots">${d.lotto.slots.map(slotSelect).join("")}</div></div>` : ""}
        <div class="actions mt"><span class="help">몇 게임 살까요?</span><select id="slotCount" style="width:auto">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === d.lotto.slots.length ? "selected" : ""}>${n}게임 · ${(n * 1000).toLocaleString("ko-KR")}원</option>`).join("")}</select></div>
        ${lmode === "saved" || lmode === "mix" ? `<h3 class="mt">내 번호 <small>${d.lotto.saved.length}/5 · 비어 있는 칸은 자동으로 삽니다</small></h3>
        <div class="rows">${d.lotto.saved.map((g, i) => `<div class="row">${balls(g, { size: "sm" })}<button class="action compact danger" data-del-saved="${i}">삭제</button></div>`).join("") || `<p class="help">아직 없어요. 아래 버튼으로 넣으세요.</p>`}</div>
        ${d.lotto.saved.length < 5 ? `<div class="actions mt"><button class="action compact" id="addSaved">+ 번호 직접 고르기</button><button class="action compact secondary" id="randSaved">🎲 아무 번호나 한 줄 뽑아 담기</button></div>` : ""}` : ""}
        <div class="switch mt"><div><div class="t">로또 사기</div><div class="d">끄면 연금복권만 삽니다.</div></div><label class="toggle"><input type="checkbox" id="sLotto" ${d.lotto.enabled ? "checked" : ""} /><span></span></label></div>
      </div>

      <div class="card mt">
        <h3>연금복권 번호 <small>한 주 5장 · 5,000원</small></h3>
        <div class="radio-list">${Object.entries(PENSION_MODE_LABEL).map(([k, v]) => `<label><input type="radio" name="pmode" value="${k}" ${d.pension.mode === k ? "checked" : ""} /><span>${v}<small>${PENSION_MODE_HELP[k]}</small></span></label>`).join("")}</div>
        ${d.pension.mode === "sameSaved" ? `<div class="field mt"><label>내 연금 번호 (6자리)</label><input type="text" id="pSaved" inputmode="numeric" maxlength="6" value="${esc(d.pension.saved)}" placeholder="예: 123456" /></div>` : ""}
        <div class="switch mt"><div><div class="t">연금복권 사기</div><div class="d">끄면 로또만 삽니다.</div></div><label class="toggle"><input type="checkbox" id="sPension" ${d.pension.enabled ? "checked" : ""} /><span></span></label></div>
      </div>

      <div class="card mt">
        <h3>매주 월요일 오전 9시 30분에</h3>
        <div class="radio-list">
          <label><input type="radio" name="runmode" value="buy" ${d.autoBuy && !d.dryRun ? "checked" : ""} /><span><b>자동으로 사기</b><small>예치금으로 이번 주 복권을 삽니다. 산 복권은 취소할 수 없어요.</small></span></label>
          <label><input type="radio" name="runmode" value="test" ${d.autoBuy && d.dryRun ? "checked" : ""} /><span><b>시험만 하기 (사지 않음)</b><small>로그인·예치금·번호까지만 확인합니다. 처음 연결했을 때 한 번 해 보세요.</small></span></label>
          <label><input type="radio" name="runmode" value="stop" ${d.autoBuy ? "" : "checked"} /><span><b>잠시 멈추기</b><small>아무것도 사지 않습니다. 당첨번호 확인은 계속합니다.</small></span></label>
        </div>
        ${depositNote()}
      </div>

      <div class="mt">${connectCard}</div>

      <div class="sticky-save"><div class="actions"><button class="action" id="saveSettings">설정 저장</button><button class="action secondary" id="resetDraft">되돌리기</button></div></div>
    </div>`;
}

/* ---------- 시작하기 ---------- */

function renderStart() {
  return `${pageTitle("무료로 시작하기", "10분이면 내 메가로또가 생깁니다", "필요한 것: GitHub 계정(무료), 동행복권 계정과 예치금. 프로그램 설치는 없습니다.")}
    <div class="container page-body">
      <div class="steps">
        <div class="step"><div><h3>GitHub 가입</h3><p>프로그램이 돌아갈 무료 공간입니다. 이미 있으면 건너뛰세요.</p><div class="actions">${ext("https://github.com/signup", "GitHub 가입하기 →", "action compact secondary")}</div></div></div>
        <div class="step"><div><h3>메가로또를 내 계정으로 복사</h3><p>버튼을 누르고 저장소 이름을 정한 뒤, 꼭 <b>Private(비공개)</b>을 고르고 만드세요. 구매 기록이 남에게 보이지 않습니다.</p><div class="actions">${ext(`${PROJECT_REPO}/generate`, "내 저장소로 복사하기 →", "action compact")}</div></div></div>
        <div class="step"><div><h3>동행복권 계정 넣기</h3><p>내 저장소 <code>Settings → Secrets and variables → Actions → New repository secret</code>에서 두 개를 넣습니다. GitHub에 로그인한 상태여야 이 화면이 열립니다.</p>
          <table><tr><td><code>DH_USER_ID</code></td><td>동행복권 아이디</td></tr><tr><td><code>DH_PASSWORD</code></td><td>동행복권 비밀번호</td></tr></table>
          <div class="lock-note"><b>🔒 넣는 순간 암호화됩니다</b><ul><li>GitHub가 비밀값을 암호화해 금고에 보관합니다. 저장한 뒤에는 <b>나도 다시 볼 수 없고</b> 바꾸거나 지울 수만 있습니다.</li><li>자동 구매가 돌 때만 잠깐 꺼내 쓰고, 실행 기록에는 <code>***</code>로 가려집니다.</li><li>메가허가를 포함해 <b>누구의 서버에도 전달되지 않습니다.</b> 내 GitHub 계정만 지키면 됩니다.</li></ul></div></div></div>
        <div class="step"><div><h3>예치금 충전</h3><p>인터넷 복권은 동행복권 사이트에 미리 넣어 둔 <b>예치금</b>으로만 삽니다. 카드나 계좌에서 바로 빠져나가지 않습니다.</p>${depositNote()}<div class="actions mt">${ext("https://www.dhlottery.co.kr", "동행복권에서 충전하기 →", "action compact")}</div></div></div>
        <div class="step"><div><h3>시험 실행</h3><p>내 저장소 <code>Actions → 메가로또·메가연금 → Run workflow</code>에서 <code>update</code>를 한 번, 이어서 <code>buy</code>를 한 번 누르세요. 처음엔 <b>시험 실행</b>이라 로그인·잔액·번호까지만 확인하고 사지 않습니다. 초록색 체크가 나오면 준비 끝입니다.</p></div></div>
        <div class="step"><div><h3>이 화면에 연결</h3><p>설정 화면에서 <b>GitHub 열쇠 만들기</b>를 누르고, 만든 열쇠를 붙여 넣으면 끝입니다. 내 메가로또 저장소는 화면이 알아서 찾습니다.</p><div class="actions"><button class="action compact" data-tab="settings">설정에서 연결하기 →</button></div></div></div></div>
        <div class="step"><div><h3>실제 구매 켜기</h3><p>설정에서 번호 방식을 고르고 <b>실제 구매</b>를 켠 뒤 저장하면, 다음 월요일 오전 9시 30분부터 매주 알아서 삽니다.</p></div></div>
      </div>

    </div>
    ${safetyBand()}
    <div class="container">
      <div class="band" style="padding-bottom:0">
        ${secHead("자주 묻는 질문", "궁금한 점")}
        <div class="faq">
          <details open><summary>정말 무료인가요?</summary><p>네. 설치비도 월 이용료도 없고, 결제창이나 카드 등록도 없습니다. 내 GitHub 계정의 무료 실행 시간(비공개 저장소 월 2,000분) 안에서 한 달에 30~60분 정도만 씁니다. 나가는 돈은 복권 값뿐입니다.</p></details>
          <details><summary>나중에 유료가 되나요?</summary><p>될 수 없는 구조입니다. 메가로또는 여러분 GitHub에 복사돼 그 안에서 돌아가고, 저희 서버를 거치지 않습니다. 그래서 저희가 돈을 받을 방법도, 비밀번호를 볼 방법도 없습니다. 소스가 전부 공개(MIT)라서 저희가 그만두더라도 지금 쓰시는 건 그대로 돌아갑니다.</p></details>
          <details><summary>왜 무료로 푸나요?</summary><p>솔직히 말씀드리면 회사를 알리려고요. 충주에서 AI 회사((주)메가허가 AI)를 하는 대표가 매주 직접 쓰려고 만든 프로그램입니다. 저희가 어떤 자동화를 만드는지 보여 드리는 게 광고보다 낫다고 생각해서 소스 코드까지 모두 공개했습니다.</p></details>
          <details><summary>비밀번호는 안전한가요?</summary><p>네. <b>GitHub 계정만 안전하게 지키면 됩니다.</b> 동행복권 아이디·비밀번호는 내 GitHub 저장소의 암호화된 비밀값에만 들어가고, 메가허가를 포함해 누구의 서버에도 가지 않습니다. 화면 연결용 GitHub 열쇠도 내 브라우저에만 저장됩니다. GitHub 2단계 인증을 켜 두시길 권합니다.</p></details>
          <details><summary>컴퓨터를 켜 둬야 하나요?</summary><p>아니요. GitHub 서버가 정해진 시간에 실행합니다. 휴대폰으로 이 화면을 열어 확인만 하면 됩니다.</p></details>
          <details><summary>분석번호를 사면 더 잘 맞나요?</summary><p>아니요. 로또·연금복권 추첨은 매 회차가 서로 영향을 주지 않는 <b>독립시행</b>이라, 어떤 번호든 당첨 확률은 똑같습니다(로또 1등 814만 5,060분의 1). 분석번호는 지난 당첨 흐름을 참고해 번호 고르는 수고를 덜어 주는 방법일 뿐입니다. 내 번호·자동과 섞어 쓸 수 있어요.</p></details><details><summary>잘못 사지거나 손해가 나면 누가 책임지나요?</summary><p>메가로또는 무료로 공개한 비공식 프로그램이라, (주)메가허가에이아이는 구매·당첨 결과, 금전 손실, 계정 문제, 동행복권 사이트가 바뀌어 생긴 오류에 대해 책임지지 않습니다. 처음엔 시험 실행으로 확인하고, 한 주 최대 1만 원 안에서만 쓰세요. 산 복권은 취소할 수 없습니다.</p></details>
          <details><summary>한 주에 얼마까지 사나요?</summary><p>로또 최대 5게임(5,000원) + 연금복권 5장(5,000원), 최대 1만 원입니다. 동행복권 인터넷 구매 한도(로또는 회차당 5천 원) 안에서만 삽니다.</p></details>
          <details><summary>동행복권 공식 프로그램인가요?</summary><p>아니요. 동행복권과 관계없는 비공식 오픈소스입니다. 동행복권 사이트가 바뀌면 구매가 실패할 수 있고, 실패하면 사지 않고 알려 줍니다.</p></details>
        </div>
      </div>
    </div>`;
}

/* ---------- 공통 ---------- */

/** 별 주기 · 고쳐 주세요(GitHub 이슈) · 의견 보내기(메일) */
function renderFeedback() {
  const mail = `mailto:contact@mega.ai.kr?subject=${encodeURIComponent("[메가로또] 의견")}&body=${encodeURIComponent("어떤 점이 좋았는지, 불편했는지 자유롭게 적어 주세요.\n\n")}`;
  return `<div class="container feedback-in">
    <div class="feedback-copy"><span class="eyebrow">함께 만들어 가요</span><h2>도움이 됐다면 ⭐ 별 하나 눌러 주세요</h2><p>GitHub 별이 많을수록 더 많은 분이 메가로또를 찾고, 저희가 계속 고쳐 나가는 힘이 됩니다. 고장 났거나 바라는 기능이 있으면 편하게 알려 주세요.</p></div>
    <div class="feedback-btns">
      ${ext(PROJECT_REPO, "⭐ GitHub 별 주기", "action")}
      ${ext(`${PROJECT_REPO}/issues/new`, "🛠 고쳐 주세요 (GitHub)", "action secondary")}
      <a class="action secondary" href="${mail}">✉ 의견 보내기 (메일)</a>
    </div>
  </div>`;
}

/* ---------- 공유 게시판 ---------- */

/** 게시판 서버가 아직 없을 때(내 PC 미리보기 등) 보여 주는 예시 */
function sampleWall() {
  const lr = currentLottoRound().round;
  const pr = currentPensionRound().round;
  const games = state.analysis?.lotto?.games ?? [];
  const items = games.slice(0, 3).map((g, i) => ({ id: `s${i}`, product: "lotto", round: lr, numbers: [g.numbers], phrase: WALL_PHRASES[(i * 3) % WALL_PHRASES.length], nickname: makeNickname(1000 + i), sample: true }));
  const pick = state.analysis?.pension?.picks?.[1]?.number;
  if (pick) items.splice(1, 0, { id: "sp", product: "pension", round: pr, numbers: [1, 2, 3, 4, 5].map((g) => ({ group: g, number: pick })), phrase: WALL_PHRASES[1], nickname: makeNickname(2024), sample: true });
  return items;
}

async function loadWall() {
  try {
    const res = await fetch("/api/wall", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    state.wall = (await res.json()).items ?? [];
    state.wallLive = true;
  } catch {
    state.wall = sampleWall();
    state.wallLive = false;
  }
  if (state.tab === "home") render();
}

function wallCard(item) {
  const lottoDraw = state.lotto.find((d) => d.round === item.round);
  const pensionDraw = state.pension.find((d) => d.round === item.round);
  let body;
  let best = undefined;
  if (item.product === "lotto") {
    body = item.numbers.map((g) => balls(g, { size: "sm", hits: lottoDraw?.numbers })).join("");
    if (lottoDraw) best = Math.min(...item.numbers.map((g) => lottoRank(g, lottoDraw) || 9));
  } else {
    const same = item.numbers.length > 1 && item.numbers.every((t) => t.number === item.numbers[0].number);
    body = same ? digits(item.numbers[0].number, { group: `${item.numbers[0].group}~${item.numbers.at(-1).group}`, size: "sm" }) : item.numbers.map((t) => digits(t.number, { group: t.group, size: "sm" })).join("");
    if (pensionDraw) {
      const ranks = item.numbers.map((t) => pensionRank(t.group, t.number, pensionDraw)).filter(Boolean);
      best = ranks.length ? ranks.sort()[0] : 9;
    }
  }
  const badge = best === undefined ? "" : best === 9 ? `<span class="rank">낙첨</span>` : rankBadge(best, item.product);
  return `<article class="wall-card">
    <header><b>${esc(item.nickname)}</b><span>${item.product === "lotto" ? "로또" : "연금복권"} ${item.round}회</span>${item.sample ? `<span class="chip">예시</span>` : ""}${badge}</header>
    <p class="wall-phrase">“${esc(item.phrase)}”</p>
    <div class="wall-nums">${body}</div>
  </article>`;
}

function wallSection(tone) {
  const items = state.wall.slice(0, 12);
  return `<section class="band ${tone}"><div class="container">
    ${secHead("공유 게시판", "이번 주 다른 분들은 이 번호를 샀어요", state.wallLive ? "메가로또로 산 번호를 정해 둔 멘트 하나와 함께 올립니다. 글은 직접 쓸 수 없어요." : "공유 게시판은 곧 열립니다. 지금 보이는 글은 예시예요.")}
    ${items.length ? `<div class="wall">${items.map(wallCard).join("")}</div>` : `<div class="card empty">아직 공유된 번호가 없어요. 첫 번째로 공유해 보세요!</div>`}
    <p class="help mt">내 번호는 <a class="text-link" href="#history" data-tab="history">구매현황</a>에서 [홈페이지에 공유]를 누르면 올라갑니다. 이름은 자동으로 정해지고, 하루 5번까지 올릴 수 있어요.</p>
  </div></section>`;
}

function openWallDialog(id) {
  const p = state.purchases.find((x) => x.id === id);
  if (!p) return;
  if (p.demo || p.dryRun) return toast("실제로 산 번호만 공유할 수 있어요");
  const known = p.product === "lotto" ? p.games.filter((g) => g.numbers) : p.tickets;
  if (!known.length) return toast("자동번호는 산 뒤에 번호가 정해지면 공유할 수 있어요");
  const preview = p.product === "lotto" ? known.map((g) => balls(g.numbers, { size: "sm" })).join("") : known.map((t) => digits(t.number, { group: t.group, size: "sm" })).join("");
  const dlg = $("#dialog");
  dlg.innerHTML = `<h3 style="margin:0 0 4px">홈페이지에 공유하기</h3><p class="help" style="margin:0 0 12px">${p.product === "lotto" ? "로또" : "연금복권"} ${p.round}회 번호를 공유 게시판에 올립니다. 함께 올릴 멘트를 하나 골라 주세요.</p>
    <div class="wall-nums" style="margin-bottom:12px">${preview}</div>
    <div class="radio-list phrase-list">${WALL_PHRASES.map((ph, i) => `<label><input type="radio" name="phrase" value="${i}" ${i === 0 ? "checked" : ""} /><span>${esc(ph)}</span></label>`).join("")}</div>
    <p class="help mt">이름은 자동으로 정해집니다. 하루 5번까지 올릴 수 있어요.</p>
    <div class="actions mt"><button class="action compact" id="wallOk">공유하기</button><button class="action compact secondary" id="wallCancel">취소</button></div>`;
  dlg.onclick = async (e) => {
    if (e.target.id === "wallCancel") return dlg.close();
    if (e.target.id !== "wallOk") return;
    const phraseId = Number(dlg.querySelector("input[name=phrase]:checked")?.value ?? 0);
    const body = { product: p.product, round: p.round, phraseId, ...(p.product === "lotto" ? { games: known.map((g) => g.numbers) } : { tickets: known.map((t) => ({ group: t.group, number: t.number })) }) };
    e.target.disabled = true;
    try {
      const res = await fetch("/api/wall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "공유 게시판이 아직 열리지 않았어요");
      dlg.close();
      toast("공유했어요! 이번 주 페이지에서 볼 수 있어요");
      loadWall();
    } catch (err) {
      e.target.disabled = false;
      toast(err.message);
    }
  };
  dlg.showModal();
}

/** 산 번호를 카톡·문자 등으로 나누는 글 */
function shareText(p) {
  const url = `${location.origin}${location.pathname}`;
  const lines =
    p.product === "lotto"
      ? [`🎱 로또 ${p.round}회 (${koDate(p.drawDate, { year: false })} 추첨) 내 번호`, ...p.games.map((g) => `${g.slot}  ${g.numbers ? g.numbers.join(" ") : "자동"}`)]
      : [`🎫 연금복권 ${p.round}회 (${koDate(p.drawDate, { year: false })} 추첨) 내 번호`, ...p.tickets.map((t) => `${t.group}조 ${t.number}`)];
  return `${lines.join("\n")}\n\n매주 알아서 사 주는 무료 프로그램 메가로또로 샀어요 → ${url}`;
}

async function sharePurchase(id) {
  const p = state.purchases.find((x) => x.id === id);
  if (!p) return;
  const text = shareText(p);
  if (navigator.share) {
    try {
      await navigator.share({ title: "메가로또 내 번호", text });
      return;
    } catch {
      /* 사용자가 닫으면 복사로 넘어간다 */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("복사했어요. 카톡이나 문자에 붙여 넣으세요");
  } catch {
    window.prompt("아래 글을 복사해 주세요", text);
  }
}

function renderMaker() {
  return `<div class="container maker-in">
    <div>
      <img class="maker-logo" src="assets/megahuga-logo.svg" alt="메가허가 AI" />
      <span class="eyebrow">만든 회사</span>
      <h2>메가로또는 (주)메가허가 AI가<br />무료로 공개한 오픈소스입니다</h2>
      <p>충주·서충주의 AI·AX 회사입니다. 매주 반복되는 일을 사람 대신 정확하게 처리하는 프로그램을 직접 만들고 운영합니다. 우리 회사·우리 가게에도 이런 자동화가 필요하면 편하게 물어보세요.</p>
      <div class="actions mt">${ext("https://mega.ai.kr", "메가허가 AI 알아보기 →", "action")}<a class="action secondary" href="mailto:contact@mega.ai.kr">contact@mega.ai.kr</a></div>
    </div>
    <div class="maker-list">
      ${ext("https://safe.mega.ai.kr", `<em>운영 중</em><b>모두의 안전안내</b><span>공공기관 현장에서 쓰고 있는 매일 안전 브리핑</span>`)}
      ${ext("https://safe.mega.ai.kr/factory/", `<em>공장용</em><b>모두의 안전안내 · 공장</b><span>작업 전 안전 공지를 매일 대신 만들고 기록을 남깁니다</span>`)}
      ${ext("https://chungju-walk.mega.ai.kr", `<em>2026년 10월 · 무료 제작</em><b>충북도청 이전 염원 도보 대장정 실시간 지도</b><span>충주시청 → 충북도청 69km, 이틀 동안 시민 응원과 현장 사진을 지도에 실시간으로</span>`)}
      ${ext("https://mega.ai.kr", `<em>AI·AX</em><b>업무 자동화 · AI 검색 홈페이지</b><span>반복 업무 자동화와 AI가 찾아 주는 홈페이지</span>`)}
      ${ext(PROJECT_REPO, `<em>오픈소스</em><b>메가로또 소스 코드</b><span>GitHub에서 전부 볼 수 있어요 (MIT)</span>`)}
    </div>
  </div>`;
}

function renderFooter() {
  return `<div class="container">
    <div><strong>(주)메가허가에이아이</strong> · 충북 충주<br />${ext("https://mega.ai.kr", "mega.ai.kr")} · <a href="mailto:contact@mega.ai.kr">contact@mega.ai.kr</a></div>
    <div class="disc"><b>꼭 읽어 주세요.</b> 로또와 연금복권 추첨은 매 회차가 <b>독립시행</b>입니다. 지난 당첨번호는 다음 추첨에 아무 영향을 주지 않으며, 분석번호를 포함한 어떤 방식도 당첨 확률을 높이거나 당첨을 보장하지 않습니다. 메가로또·메가연금은 동행복권과 관계없는 비공식 오픈소스(MIT)이며, (주)메가허가에이아이는 이 프로그램 사용으로 생긴 구매·당첨 결과, 금전 손실, 계정 문제, 동행복권 사이트 변경에 따른 오류에 대해 책임지지 않습니다. 복권은 여유 돈으로, 정해 둔 금액만 즐겨 주세요.</div>
  </div>`;
}

function renderStatusLine() {
  const el = $("#statusLine");
  if (!state.conn) {
    el.innerHTML = `<div class="container"><span class="chip">체험 화면</span><span>번호·기록은 예시예요</span><a class="text-link" href="#start" data-tab="start">내 것으로 쓰기 →</a></div>`;
    return;
  }
  const mode = state.settings.dryRun ? `<span class="chip warn">시험 실행 (구매 안 함)</span>` : `<span class="chip live">실제 구매 켜짐</span>`;
  const auto = state.settings.autoBuy ? `<span class="chip ok">매주 자동</span>` : `<span class="chip">자동구매 꺼짐</span>`;
  el.innerHTML = `<div class="container"><span class="chip ok">● ${esc(state.conn.owner)}/${esc(state.conn.repo)}</span>${mode}${auto}<span>다음 구매 ${nextBuyText()}</span></div>`;
}

function render() {
  const fn = { home: renderHome, draws: renderDraws, analysis: renderAnalysis, history: renderHistory, settings: renderSettings, start: renderStart }[state.tab] ?? renderHome;
  $("#view").innerHTML = fn();
  $("#feedback").innerHTML = renderFeedback();
  $("#maker").innerHTML = renderMaker();
  $("#footer").innerHTML = renderFooter();
  renderStatusLine();
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
}

/* ---------- 번호 고르기 ---------- */

function pickNumbers() {
  const dlg = $("#dialog");
  const chosen = new Set();
  const draw = () => {
    dlg.innerHTML = `<h3 style="margin:0 0 4px">번호 6개 고르기</h3><p class="help" style="margin:0">고른 번호는 '내 번호'가 됩니다.</p><div class="picker">${Array.from({ length: 45 }, (_, i) => i + 1)
      .map((n) => `<button data-n="${n}" class="${chosen.has(n) ? `sel ball ${ballClass(n)}` : ""}">${n}</button>`)
      .join("")}</div><div class="actions"><button class="action compact" id="pickOk" ${chosen.size === 6 ? "" : "disabled"}>담기 (${chosen.size}/6)</button><button class="action compact secondary" id="pickCancel">취소</button></div>`;
  };
  draw();
  dlg.onclick = (e) => {
    const n = Number(e.target.dataset?.n);
    if (n) {
      if (chosen.has(n)) chosen.delete(n);
      else if (chosen.size < 6) chosen.add(n);
      draw();
    } else if (e.target.id === "pickOk") {
      addSavedLotto([...chosen].sort((a, b) => a - b));
      dlg.close();
    } else if (e.target.id === "pickCancel") dlg.close();
  };
  dlg.showModal();
}

function addSavedLotto(game) {
  if (!isValidLottoGame(game)) return;
  const saved = state.draft.lotto.saved;
  if (saved.some((g) => g.join(",") === game.join(","))) return toast("이미 저장된 번호예요");
  if (saved.length >= 5) return toast("내 번호는 5줄까지예요");
  saved.push(game);
  toast("내 번호에 담았어요. 번호·설정에서 '설정 저장'을 눌러 주세요");
  render();
}

function confirmReal() {
  return new Promise((resolve) => {
    const dlg = $("#dialog");
    dlg.innerHTML = `<h3 style="margin:0 0 8px">실제 구매를 켤까요?</h3><p style="margin:0 0 8px">매주 월요일 오전 9시 30분에 동행복권 예치금으로 실제로 삽니다.<br />로또 최대 5,000원 + 연금 5,000원 = <b>한 주 최대 10,000원</b></p><p class="help">예치금은 동행복권에서 미리 충전해 두세요. 산 복권은 취소할 수 없습니다.</p><div class="actions mt"><button class="action compact" id="yes">켜기</button><button class="action compact secondary" id="no">취소</button></div>`;
    dlg.onclick = (e) => {
      if (e.target.id === "yes") (dlg.close(), resolve(true));
      if (e.target.id === "no") (dlg.close(), resolve(false));
    };
    dlg.showModal();
  });
}

/* ---------- 이벤트 ---------- */

function goTab(tab) {
  state.tab = tab;
  history.replaceState(null, "", tab === "home" ? location.pathname : `#${tab}`);
  render();
  window.scrollTo(0, 0);
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t || t.closest("dialog")) return;
  const ds = t.dataset;
  try {
    if (ds.tab) (e.preventDefault(), goTab(ds.tab));
    else if (ds.run) await runTask(ds.run);
    else if (ds.share) await sharePurchase(ds.share);
    else if (ds.wall) openWallDialog(ds.wall);
    else if (ds.dseg) (state.drawSeg = ds.dseg), render();
    else if (ds.aseg) (state.anaSeg = ds.aseg), render();
    else if (ds.lr) (state.lottoRound = Math.max(1, Math.min(state.lotto.at(-1).round, state.lottoRound + Number(ds.lr)))), render();
    else if (ds.pr) (state.pensionRound = Math.max(1, Math.min(state.pension.at(-1).round, state.pensionRound + Number(ds.pr)))), render();
    else if (ds.pickL) (state.lottoRound = Number(ds.pickL)), render(), window.scrollTo(0, 0);
    else if (ds.pickP) (state.pensionRound = Number(ds.pickP)), render(), window.scrollTo(0, 0);
    else if (t.id === "lGo")(state.lottoRound = Number($("#lRoundInput").value) || state.lottoRound), render();
    else if (t.id === "pGo") (state.pensionRound = Number($("#pRoundInput").value) || state.pensionRound), render();
    else if (t.id === "altLotto") (state.altLotto = analyzeLotto(state.lotto, { seed: Math.floor(Math.random() * 1e9) })), render();
    else if (t.id === "resetLotto") (state.altLotto = null), render();
    else if (t.id === "altPension") (state.altPension = analyzePension(state.pension, { seed: Math.floor(Math.random() * 1e9) })), render();
    else if (ds.saveLotto) addSavedLotto(ds.saveLotto.split(",").map(Number));
    else if (ds.savePension) (state.draft.pension.saved = ds.savePension), toast("연금 내 번호에 담았어요. 번호·설정에서 '설정 저장'을 눌러 주세요");
    else if (ds.delSaved) state.draft.lotto.saved.splice(Number(ds.delSaved), 1), render();
    else if (t.id === "addSaved") pickNumbers();
    else if (t.id === "randSaved") {
      const pick = new Set();
      while (pick.size < 6) pick.add(1 + Math.floor(Math.random() * 45));
      addSavedLotto([...pick].sort((x, y) => x - y));
    }
    else if (ds.preset) {
      const n = state.draft.lotto.slots.length || LOTTO_MAX_GAMES;
      const presets = { analysis: Array(5).fill("analysis"), mix: ["analysis", "analysis", "analysis", "random", "auto"], saved: Array(5).fill("saved"), auto: Array(5).fill("auto") };
      state.draft.lotto.slots = presets[ds.preset].slice(0, n);
      render();
    } else if (t.id === "saveSettings") {
      const next = normalizeSettings(state.draft);
      await saveSettings(next);
      state.draft = structuredClone(next);
      render();
    } else if (t.id === "resetDraft") (state.draft = structuredClone(state.settings)), render();
    else if (t.id === "connect") {
      const token = $("#cToken").value.trim();
      if (!token) return toast("GitHub 열쇠를 붙여 넣어 주세요");
      let owner = $("#cOwner")?.value.trim();
      let repo = $("#cRepo")?.value.trim();
      if (!owner || !repo) {
        t.disabled = true;
        t.textContent = "내 메가로또 찾는 중…";
        const found = await findMegalottoRepo(token).finally(() => (t.disabled = false));
        if (!found) {
          t.textContent = "연결하기";
          return toast("이 열쇠로 볼 수 있는 저장소에서 메가로또를 못 찾았어요. 열쇠를 만들 때 메가로또 저장소를 골랐는지 확인해 주세요");
        }
        [owner, repo] = found.split("/");
      }
      state.conn = { owner, repo, token };
      saveJson(CONN_KEY, state.conn);
      await loadAll();
      if (state.conn) toast("연결했어요");
    } else if (t.id === "disconnect") {
      state.conn = null;
      saveJson(CONN_KEY, null);
      await loadAll();
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  const d = state.draft;
  if (!d) return;
  if (t.dataset.slot) d.lotto.slots[Number(t.dataset.slot)] = t.value;
  else if (t.id === "slotCount") {
    const n = Number(t.value);
    d.lotto.slots = Array.from({ length: n }, (_, i) => d.lotto.slots[i] ?? "auto");
    render();
  } else if (t.name === "runmode") {
    if (t.value === "buy" && !(await confirmReal())) return render();
    d.autoBuy = t.value !== "stop";
    d.dryRun = t.value !== "buy";
    render();
  } else if (t.id === "sLotto") d.lotto.enabled = t.checked;
  else if (t.id === "sPension") d.pension.enabled = t.checked;
  else if (t.name === "pmode") (d.pension.mode = t.value), render();
  else if (t.name === "lmode") {
    const n = d.lotto.slots.length || LOTTO_MAX_GAMES;
    if (t.value !== "mix") d.lotto.slots = Array(n).fill(t.value);
    else if (new Set(d.lotto.slots).size === 1) d.lotto.slots = Array.from({ length: n }, (_, i) => (i < 2 ? "saved" : "auto"));
    render();
  }
  else if (t.id === "pSaved") {
    d.pension.saved = t.value.replace(/\D/g, "").slice(0, 6);
    if (d.pension.saved && d.pension.saved.length !== 6) toast("연금 번호는 6자리예요");
  }
});

// 뽐뿌 글 등에서 #start 같은 주소로 바로 들어와도 그 화면을 연다
window.addEventListener("hashchange", () => {
  const tab = location.hash.replace("#", "") || "home";
  if (tab !== state.tab) (state.tab = tab), render(), window.scrollTo(0, 0);
});

loadAll();
