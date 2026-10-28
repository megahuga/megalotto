// 공유 게시판 서버 (Vercel 함수). 글 하나 = Vercel Blob 파일 하나(고쳐 쓰지 않음 → 동시에 올라와도 사라지지 않는다).
//   wall/items/{역순 시각}-{id}.json   글 (이름이 역순 시각이라 목록이 최신부터 나온다)
//   wall/rate/{날짜}/{ip해시}/{id}      같은 곳에서 하루에 올린 횟수 표시
// 환경변수: Blob 저장소 연결(자동), WALL_IP_SALT(같은 곳 여부만 알아보는 비밀 소금), WALL_ADMIN_KEY(관리자 지우기)
// GET    /api/wall   최근 공유 24개
// POST   /api/wall   { product, round, games|tickets, phraseId }  → 같은 곳에서 하루 5번까지
// DELETE /api/wall   { id }  + 헤더 x-admin-key

import { createHash, timingSafeEqual } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import { makeNickname, validateWallEntry, WALL_PHRASES } from "../src/wall.js";

const ITEMS = "wall/items/";
const DAILY_LIMIT = 5;
const SHOW = 24;
const FAR = 9e15; // 역순 시각 기준

const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const parseBody = (req) => (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {});

const publicItem = (r) => ({ id: r.id, product: r.product, round: r.round, numbers: r.numbers, phrase: WALL_PHRASES[r.phraseId] ?? "", nickname: r.nickname, createdAt: r.createdAt });

async function latestItems() {
  const { blobs } = await list({ prefix: ITEMS, limit: SHOW });
  const items = await Promise.all(blobs.map((b) => fetch(b.url).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  return { listed: blobs.length, items };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
      const { listed, items } = await latestItems();
      return res.status(200).json({ items: items.filter((x) => x && x.id).map(publicItem) });
    }

    if (req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      const { entry, error } = validateWallEntry(parseBody(req));
      if (error) return res.status(400).json({ error });

      const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
      const ipHash = createHash("sha256").update(`${process.env.WALL_IP_SALT ?? ""}:${ip}`).digest("hex").slice(0, 24);
      const ratePrefix = `wall/rate/${kstDay()}/${ipHash}/`;
      const { blobs: used } = await list({ prefix: ratePrefix, limit: DAILY_LIMIT });
      if (used.length >= DAILY_LIMIT) return res.status(429).json({ error: "하루에 5번까지 공유할 수 있어요." });

      const now = Date.now();
      const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const item = { id, product: entry.product, round: entry.round, numbers: entry.numbers, phraseId: entry.phraseId, nickname: makeNickname(parseInt(ipHash.slice(0, 8), 16)), createdAt: new Date(now).toISOString() };
      const order = String(FAR - now).padStart(16, "0");
      await put(`${ITEMS}${order}-${id}.json`, JSON.stringify(item), { access: "public", contentType: "application/json", addRandomSuffix: false });
      await put(`${ratePrefix}${id}`, "1", { access: "public", contentType: "text/plain", addRandomSuffix: false });
      return res.status(201).json({ item: publicItem(item) });
    }

    if (req.method === "DELETE") {
      // 관리자만: 헤더 x-admin-key 가 WALL_ADMIN_KEY 와 같을 때 글 하나를 지운다
      res.setHeader("Cache-Control", "no-store");
      const given = createHash("sha256").update(String(req.headers["x-admin-key"] ?? "")).digest();
      const expected = createHash("sha256").update(String(process.env.WALL_ADMIN_KEY ?? "")).digest();
      if (!process.env.WALL_ADMIN_KEY || !timingSafeEqual(given, expected)) return res.status(403).json({ error: "권한이 없습니다." });
      if (parseBody(req).cleanup === true) {
        const { blobs } = await list({ limit: 1000 });
        const today = `wall/rate/${kstDay()}/`;
        const old = blobs.filter((b) => !b.pathname.startsWith(ITEMS) && !b.pathname.startsWith(today)).map((b) => b.url);
        if (old.length) await del(old);
        return res.status(200).json({ cleaned: old.length });
      }
      const id = String(parseBody(req).id ?? "");
      if (!/^[a-z0-9]+$/.test(id)) return res.status(400).json({ error: "id가 필요합니다." });
      const { blobs } = await list({ prefix: ITEMS, limit: 1000 });
      const targets = blobs.filter((b) => b.pathname.endsWith(`-${id}.json`)).map((b) => b.url);
      if (targets.length) await del(targets);
      return res.status(200).json({ removed: targets.length });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "지원하지 않는 요청입니다." });
  } catch {
    return res.status(503).json({ error: "공유 게시판에 잠시 문제가 있어요. 조금 뒤 다시 해 주세요." });
  }
}
