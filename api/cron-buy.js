// 월요일 오전 9시 30분(KST) 정시 구매 깨우기 (Vercel Cron).
// GitHub 예약 실행은 몇 시간씩 늦게 시작할 때가 있어서, 정확한 시계가 저장소의 '예약 구매'(scheduled-buy)를 직접 누른다.
// 구매는 그 저장소의 GitHub Actions 안에서 하고, 이 함수는 실행 버튼만 누른다(동행복권 계정은 보지 않는다).
// 환경변수: CRON_SECRET(Vercel이 호출할 때 붙이는 비밀), LOTTO_DISPATCH_REPO(owner/repo), LOTTO_DISPATCH_TOKEN(그 저장소 Actions 쓰기만 되는 열쇠)
import { timingSafeEqual } from "node:crypto";

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(String(req.headers.authorization ?? ""), `Bearer ${secret}`)) return res.status(401).json({ ok: false });
  const repo = process.env.LOTTO_DISPATCH_REPO;
  const token = process.env.LOTTO_DISPATCH_TOKEN;
  if (!repo || !token) return res.status(503).json({ ok: false, error: "정시 실행이 설정되지 않았어요" });
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/megalotto.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { task: "scheduled-buy" } })
  });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
}
