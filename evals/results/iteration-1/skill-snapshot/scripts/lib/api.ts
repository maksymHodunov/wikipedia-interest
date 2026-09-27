/**
 * Thin Wikimedia API client: on-disk cache, polite rate limiting, retries.
 *
 * Endpoints:
 *  - REST pageviews  https://wikimedia.org/api/rest_v1/metrics/pageviews/...
 *  - Action API      https://{lang}.wikipedia.org/w/api.php  (search, langlinks)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const USER_AGENT =
  process.env.WI_USER_AGENT ??
  "wikipedia-interest-skill/0.1 (agent skill; set WI_USER_AGENT to your contact)";
const REST = "https://wikimedia.org/api/rest_v1/metrics/pageviews";
const CACHE_DIR =
  process.env.WI_CACHE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache");
const MIN_INTERVAL_MS = 250; // ~4 req/s: the anonymous REST API throttles bursts hard (429)
let lastCall = 0;

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface PageviewItem {
  project: string;
  article: string;
  granularity: string;
  timestamp: string; // YYYYMMDDHH
  access: string;
  agent: string;
  views: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(url: string): string {
  return join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".json");
}

/** GET JSON with a disk cache (default TTL 7 days). Throws ApiError with .status on 4xx. */
export async function getJson<T = unknown>(url: string, ttlHours = 24 * 7, retries = 5): Promise<T> {
  const p = cachePath(url);
  if (existsSync(p) && Date.now() - statSync(p).mtimeMs < ttlHours * 3600_000) {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        await sleep(Math.max(retryAfter * 1000, 3000 * (attempt + 1)));
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new ApiError(`HTTP ${res.status}: ${url}`, res.status);
      const data = (await res.json()) as T;
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(p, JSON.stringify(data));
      } catch {
        // read-only skill directory: keep working without a cache (set WI_CACHE_DIR to a writable path)
      }
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new ApiError(`failed after ${retries} retries (${String(lastErr)}): ${url}. If this is HTTP 429, wait a minute and re-run — cached calls are not repeated.`);
}

export type Granularity = "daily" | "monthly";
export type Agent = "user" | "automated" | "spider" | "all-agents";

/** Per-article pageviews. Dates are YYYYMMDD. Returns [] when the article has no data (404). */
export async function pageviews(
  project: string,
  article: string,
  start: string,
  end: string,
  opts: { granularity?: Granularity; agent?: Agent; access?: string } = {},
): Promise<PageviewItem[]> {
  const { granularity = "monthly", agent = "user", access = "all-access" } = opts;
  const title = encodeURIComponent(article.replace(/ /g, "_"));
  const url = `${REST}/per-article/${project}/${access}/${agent}/${title}/${granularity}/${start}/${end}`;
  try {
    return (await getJson<{ items: PageviewItem[] }>(url)).items ?? [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  }
}

/** Whole-project pageviews (all articles) — used to normalise interest across languages. */
export async function projectTotal(
  project: string,
  start: string,
  end: string,
  granularity: Granularity = "monthly",
): Promise<PageviewItem[]> {
  const url = `${REST}/aggregate/${project}/all-access/user/${granularity}/${start}/${end}`;
  return (await getJson<{ items: PageviewItem[] }>(url)).items ?? [];
}

async function actionApi<T>(lang: string, params: Record<string, string | number>): Promise<T> {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), format: "json", formatversion: "2" });
  return getJson<T>(`https://${lang}.wikipedia.org/w/api.php?${q}`, 24 * 30);
}

export interface SearchHit { title: string; snippet: string }

/** Full-text search in one language edition. */
export async function search(lang: string, query: string, limit = 5): Promise<SearchHit[]> {
  const data = await actionApi<{ query?: { search?: { title: string; snippet?: string }[] } }>(lang, {
    action: "query", list: "search", srsearch: query, srlimit: limit, srprop: "snippet",
  });
  return (data.query?.search ?? []).map((h) => ({ title: h.title, snippet: (h.snippet ?? "").replace(/<[^>]+>/g, "") }));
}

/** Titles of the same article in other editions via interlanguage links: { lang: title }. Includes the canonical (redirect-resolved) source title. */
export async function langlinks(lang: string, title: string): Promise<Record<string, string>> {
  const data = await actionApi<{ query?: { pages?: { title?: string; missing?: boolean; langlinks?: { lang: string; title: string }[] }[] } }>(lang, {
    action: "query", prop: "langlinks", titles: title, lllimit: "max", redirects: 1,
  });
  const out: Record<string, string> = {};
  for (const p of data.query?.pages ?? []) {
    if (p.missing) continue;
    for (const ll of p.langlinks ?? []) out[ll.lang] = ll.title;
    if (p.title) out[lang] = p.title;
  }
  return out;
}
