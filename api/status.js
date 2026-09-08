import { createClient } from "redis";

// Health check. Reports whether Strava credentials are present and whether the
// Redis cache is actually reachable — the cache failing open is invisible to
// users, so it needs somewhere to be visible.
export default async function handler(req, res) {
  const out = {
    connected: !!process.env.STRAVA_REFRESH_TOKEN,
    redisUrlPresent: !!process.env.REDIS_URL,
    redisUrlScheme: (process.env.REDIS_URL || "").split("://")[0] || null,
    cache: "unknown",
  };

  if (!process.env.REDIS_URL) {
    out.cache = "no REDIS_URL";
    return res.json(out);
  }

  let client;
  try {
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => (retries > 2 ? false : 200),
      },
    });
    client.on("error", () => {});
    await client.connect();
    const probe = `status:probe:${Date.now()}`;
    await client.set(probe, JSON.stringify({ ok: true }));
    const back = await client.get(probe);
    await client.del(probe);
    out.cache = back ? "ok" : "write-then-read returned nothing";
  } catch (e) {
    out.cache = `failed: ${e.name}: ${e.message}`;
  } finally {
    try {
      if (client?.isOpen) await client.quit();
    } catch {
      // nothing useful to do
    }
  }

  res.json(out);
}
