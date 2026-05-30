import axios from "axios";
import fs from "fs";
import path from "path";

// Define Cache Schemas
interface CacheEntry {
  etag?: string;
  lastModified?: string;
  body: string;
}

interface SourceHealthEntry {
  consecutiveFailures: number;
  lastFailureTime?: string;
  cooldownUntil?: string;
}

interface HttpCacheSchema {
  conditionalRequests: Record<string, CacheEntry>;
  sourceHealth: Record<string, SourceHealthEntry>;
}

export interface HttpGetOptions {
  cache?: boolean;
  timeout?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

// User-Agent Rotation List
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (compatible; DistrictBot/1.2; +https://districtnews.ai)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
];

function getRandomUserAgent(): string {
  const idx = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[idx];
}

// Persistent Storage Configurations
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "http_cache.json");

let memoryCache: HttpCacheSchema = {
  conditionalRequests: {},
  sourceHealth: {},
};

let isCacheLoaded = false;

function loadCache() {
  if (isCacheLoaded) return;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      memoryCache = {
        conditionalRequests: parsed.conditionalRequests || {},
        sourceHealth: parsed.sourceHealth || {},
      };
    }
  } catch (err) {
    console.error("Failed to load HTTP cache file, using in-memory:", err);
  }
  isCacheLoaded = true;
}

function saveCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memoryCache, null, 2), "utf-8");
  } catch (err) {
    // Fail silently in environments where write is prohibited (e.g. read-only serverless lambdas)
  }
}

// Source Health Monitoring Definitions
const COOLDOWN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Returns true if the hostname of the URL is currently healthy (not in cooldown).
 */
export function isHostHealthy(urlStr: string): boolean {
  loadCache();
  try {
    const url = new URL(urlStr);
    const host = url.hostname;
    const health = memoryCache.sourceHealth[host];
    if (!health) return true;

    if (health.cooldownUntil) {
      const cooldownUntil = new Date(health.cooldownUntil).getTime();
      if (Date.now() < cooldownUntil) {
        return false;
      } else {
        // Cooldown period expired, clean up status
        delete health.cooldownUntil;
        health.consecutiveFailures = 0;
        saveCache();
      }
    }
    return true;
  } catch {
    return true; // Don't block invalid URLs early, let fetch fail
  }
}

function recordSuccess(urlStr: string) {
  loadCache();
  try {
    const url = new URL(urlStr);
    const host = url.hostname;
    const health = memoryCache.sourceHealth[host];
    if (health) {
      health.consecutiveFailures = 0;
      delete health.cooldownUntil;
      delete health.lastFailureTime;
      saveCache();
    }
  } catch {
    // Ignore
  }
}

function recordFailure(urlStr: string) {
  loadCache();
  try {
    const url = new URL(urlStr);
    const host = url.hostname;
    if (!memoryCache.sourceHealth[host]) {
      memoryCache.sourceHealth[host] = { consecutiveFailures: 0 };
    }
    const health = memoryCache.sourceHealth[host];
    health.consecutiveFailures += 1;
    health.lastFailureTime = new Date().toISOString();

    if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      health.cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS).toISOString();
      console.warn(`[HTTP Client] Host ${host} marked UNHEALTHY (cooldown active until ${health.cooldownUntil})`);
    }
    saveCache();
  } catch {
    // Ignore
  }
}

// Per-Source Concurrency Limit Engine
interface ConcurrencyQueueItem {
  resolve: () => void;
  reject: (err: any) => void;
}

const activeRequestsPerHost: Record<string, number> = {};
const pendingQueuesPerHost: Record<string, ConcurrencyQueueItem[]> = {};
const MAX_CONCURRENT_REQUESTS_PER_HOST = 2;

async function acquireLock(hostname: string): Promise<() => void> {
  if (!activeRequestsPerHost[hostname]) {
    activeRequestsPerHost[hostname] = 0;
  }
  if (!pendingQueuesPerHost[hostname]) {
    pendingQueuesPerHost[hostname] = [];
  }

  if (activeRequestsPerHost[hostname] < MAX_CONCURRENT_REQUESTS_PER_HOST) {
    activeRequestsPerHost[hostname]++;
    return () => releaseLock(hostname);
  }

  return new Promise<() => void>((resolve, reject) => {
    pendingQueuesPerHost[hostname].push({
      resolve: () => {
        activeRequestsPerHost[hostname]++;
        resolve(() => releaseLock(hostname));
      },
      reject,
    });
  });
}

function releaseLock(hostname: string) {
  activeRequestsPerHost[hostname]--;
  const next = pendingQueuesPerHost[hostname]?.shift();
  if (next) {
    next.resolve();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a resilient HTTP GET request with timeouts, retries,
 * backoff, concurrency limiting, user-agent rotation, and conditional caching.
 */
export async function httpGet(
  url: string,
  options?: HttpGetOptions
): Promise<string | null> {
  const cacheEnabled = options?.cache ?? false;
  const timeout = options?.timeout ?? 10000;
  const maxRetries = options?.maxRetries ?? 3;
  const initialRetryDelayMs = options?.initialRetryDelayMs ?? 1000;

  // 1. Health Monitor Check
  if (!isHostHealthy(url)) {
    console.warn(`[HTTP Client] Request blocked: Host for ${url} is in cooldown (unhealthy)`);
    return null;
  }

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    console.error(`[HTTP Client] Invalid URL: ${url}`);
    return null;
  }

  // 2. Concurrency Lock Acquisition
  const release = await acquireLock(hostname);

  try {
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      try {
        const headers: Record<string, string> = {
          "User-Agent": getRandomUserAgent(),
          Accept: "*/*",
        };

        // 3. Conditional Request Preparation
        let cachedEntry: CacheEntry | undefined;
        if (cacheEnabled) {
          loadCache();
          cachedEntry = memoryCache.conditionalRequests[url];
          if (cachedEntry) {
            if (cachedEntry.etag) {
              headers["If-None-Match"] = cachedEntry.etag;
            }
            if (cachedEntry.lastModified) {
              headers["If-Modified-Since"] = cachedEntry.lastModified;
            }
          }
        }

        console.log(`[HTTP Client] GET (Attempt ${attempt}/${maxRetries + 1}): ${url}`);

        const response = await axios.get(url, {
          timeout,
          headers,
          maxBodyLength: 10 * 1024 * 1024,
          validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
        });

        // 4. Conditional Request 304 Handling
        if (response.status === 304) {
          console.log(`[HTTP Client] 304 Not Modified: ${url}`);
          recordSuccess(url);
          if (cachedEntry) {
            return cachedEntry.body;
          }
          return null;
        }

        const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);

        // 5. Caching Success Response
        if (cacheEnabled) {
          const etag = response.headers["etag"];
          const lastModified = response.headers["last-modified"];
          if (etag || lastModified) {
            loadCache();
            memoryCache.conditionalRequests[url] = {
              etag,
              lastModified,
              body,
            };
            saveCache();
          }
        }

        recordSuccess(url);
        return body;
      } catch (err: any) {
        const isLastAttempt = attempt > maxRetries;
        const errMsg = err?.message || String(err);
        console.error(`[HTTP Client] Attempt ${attempt} failed for ${url}: ${errMsg}`);

        if (isLastAttempt) {
          recordFailure(url);
          return null;
        }

        // Exponential backoff with jitter
        const delay = initialRetryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.log(`[HTTP Client] Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
    return null;
  } finally {
    // 6. Release Concurrency Lock
    release();
  }
}
