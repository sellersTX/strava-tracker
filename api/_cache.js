// Shared cache for the API routes.
//
// This used to be @vercel/kv, gated on KV_REST_API_URL / KV_REST_API_TOKEN.
// Vercel has since migrated KV to Marketplace Redis, which exposes a REDIS_URL
// connection string instead — so those two vars no longer exist, getKV() always
// returned null, and every request re-fetched everything uncached. Same small
// get/mget/set surface, backed by node-redis, so call sites barely change.
//
// Values are stored as JSON, matching what @vercel/kv wrote, so keys cached
// before the migration still read back.

import { createClient } from "redis";

// A cache that is slow to answer is worse than no cache — every millisecond
// here is on the critical path of a user-facing request.
const CONNECT_TIMEOUT_MS = 3000;

// Reused across warm invocations; a cold start pays one connect.
let pending = null;

async function connect() {
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      // node-redis retries forever by default, which would hang the function
      // until Vercel kills it. Give up quickly and let the caller fetch live.
      reconnectStrategy: (retries) => (retries > 2 ? false : 200),
    },
  });
  // Without an error listener, a dropped connection raises an unhandled 'error'
  // event and takes down the whole function.
  client.on("error", () => {});
  return client.connect().then(() => client);
}

async function getClient() {
  if (!process.env.REDIS_URL) return null;
  if (pending) {
    try {
      const client = await pending;
      if (client.isOpen) return client;
    } catch {
      // fall through and redial
    }
    pending = null;
  }
  pending = connect().catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}

function decode(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Returns null when Redis is unconfigured or unreachable. Callers treat that as
// "no cache" and fall back to fetching, so an outage is slow rather than broken.
//
// Failures are logged, not swallowed: this cache silently no-opped for months
// after a Vercel migration renamed its env vars, and nothing said so.
export async function getCache() {
  if (!process.env.REDIS_URL) {
    console.error("[cache] REDIS_URL is not set - running with no cache");
    return null;
  }
  let client;
  try {
    client = await getClient();
  } catch (e) {
    console.error("[cache] connect failed:", e.message);
    return null;
  }
  if (!client) return null;

  return {
    async get(key) {
      try {
        return decode(await client.get(key));
      } catch (e) {
        console.error("[cache] get failed:", e.message);
        return null;
      }
    },
    async mget(keys) {
      if (!keys.length) return [];
      try {
        return (await client.mGet(keys)).map(decode);
      } catch (e) {
        console.error("[cache] mget failed:", e.message);
        return keys.map(() => null);
      }
    },
    async set(key, value) {
      try {
        await client.set(key, JSON.stringify(value));
      } catch (e) {
        // A failed write just means a future cache miss.
        console.error("[cache] set failed:", e.message);
      }
    },
  };
}
