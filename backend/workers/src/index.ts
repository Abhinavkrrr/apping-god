// Cloudflare Worker — tracking endpoints + Gmail webhook.
//
// Routes:
//   GET /t/open/:sendId.gif       → log open event, return 1x1 GIF
//   GET /t/click/:sendId?u=URL    → log click event, 302 redirect to URL
//   GET /t/unsub/:sendId          → log unsubscribe, return confirmation HTML
//   POST /api/gmail-webhook       → Gmail push notification (Phase 4)

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TRACKING_BASE_URL: string;
}

// 1×1 transparent GIF (43 bytes)
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function logEvent(
  env: Env,
  sendId: string,
  type: "open" | "click" | "unsubscribe",
  metadata: Record<string, unknown>
) {
  if (!isUuid(sendId)) return;
  await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ send_id: sendId, type, metadata }),
  }).catch(() => {});
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- Open pixel ---
    const openMatch = path.match(/^\/t\/open\/([a-f0-9-]+)\.gif$/i);
    if (openMatch) {
      const sendId = openMatch[1];
      ctx.waitUntil(
        logEvent(env, sendId, "open", {
          ua: req.headers.get("user-agent") ?? "",
          ip: req.headers.get("cf-connecting-ip") ?? "",
        })
      );
      return new Response(PIXEL, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // --- Click redirect ---
    const clickMatch = path.match(/^\/t\/click\/([a-f0-9-]+)$/i);
    if (clickMatch) {
      const sendId = clickMatch[1];
      const target = url.searchParams.get("u");
      if (!target) return new Response("missing u param", { status: 400 });
      ctx.waitUntil(logEvent(env, sendId, "click", { url: target }));
      return Response.redirect(target, 302);
    }

    // --- Unsubscribe ---
    const unsubMatch = path.match(/^\/t\/unsub\/([a-f0-9-]+)$/i);
    if (unsubMatch) {
      const sendId = unsubMatch[1];
      ctx.waitUntil(logEvent(env, sendId, "unsubscribe", {}));
      return new Response(
        `<!doctype html><html><body style="font-family:sans-serif;padding:40px;max-width:480px;margin:auto;text-align:center"><h2>You have been unsubscribed.</h2><p>You will not receive further emails. Apologies for any inconvenience.</p></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // --- Gmail webhook (Phase 4 placeholder) ---
    if (path === "/api/gmail-webhook" && req.method === "POST") {
      return new Response(JSON.stringify({ ok: true, phase: "Phase 4 stub" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- Health ---
    if (path === "/" || path === "/health") {
      return new Response(
        JSON.stringify({
          service: "apping-tracking-worker",
          status: "ok",
          time: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  },
};
