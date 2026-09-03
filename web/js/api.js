const cache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const cacheKey = method === 'GET' ? url : null;
  const ttl = options.ttl ?? 60_000;
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.time < ttl) return hit.data;
  }

  const retries = options.retries ?? 2;
  const timeout = options.timeout ?? 8_000;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
        error.status = response.status;
        if (response.status < 500) throw error;
        lastError = error;
      } else {
        const data = await response.json();
        if (cacheKey) cache.set(cacheKey, { data, time: Date.now() });
        return data;
      }
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500) throw error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(250 * (attempt + 1));
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

export function clearApiCache() {
  cache.clear();
}
