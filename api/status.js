import { createClient } from "redis";

// Health check. Reports whether Strava credentials are present and whether the
// Redis cache is actually reachable — the cache fails open, so a dead cache is
// invisible to users and needs somewhere to be visible.
//
// Deliberately coarse: this endpoint is public, so it reports an error code
// rather than the driver's message, which carries the Redis hostname.
export default async function handler(req, res) {
  const out = {
    connected: !!process.env.STRAVA_REFRESH_TOKEN,
    redisUrlPresent: !!process.env.REDIS_URL,
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
    out.cache = back ? "ok" : "unwritable";
  } catch (e) {
    out.cache = `unreachable (${e.code ?? e.name})`;
  } finally {
    try {
      if (client?.isOpen) await client.quit();
    } catch {
      // nothing useful to do
    }
  }

  res.json(out);
}
