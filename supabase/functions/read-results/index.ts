// Reads a race results screenshot or photo with Google Gemini and returns the rows for the results page to review.
// Deploy: Supabase dashboard > Edge Functions > read-results (or `supabase functions deploy read-results`).
// Secret needed: GEMINI_API_KEY (Edge Functions > Secrets). Optional: GEMINI_MODEL (default gemini-3.8-flash).
// Only signed-in admins of the league can use it. The key never reaches the browser.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_IMAGE_CHARS = 8_000_000; // about 6 MB of image
const MIMES = ["image/jpeg", "image/png", "image/webp"];

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          driver: { type: "STRING" },
          status: { type: "STRING", enum: ["finished", "dnf", "dns", "dsq"] },
          best_lap: { type: "STRING" },
          race_time: { type: "STRING" },
          penalty_seconds: { type: "NUMBER" },
          total_time: { type: "STRING" },
        },
        required: ["driver", "status"],
      },
    },
    unreadable: { type: "STRING" },
  },
  required: ["rows"],
};

function promptFor(names: string[]) {
  return [
    "This image is a racing game results screen (Forza), possibly photographed from a TV or monitor.",
    "Return one row per driver, in the order shown on screen from first place down.",
    "driver: the name exactly as written on screen, including any clan tag or odd characters.",
    "status: finished unless the screen says DNF, DNS or DSQ for that driver.",
    "best_lap, race_time, total_time: copy times exactly as shown, as minutes:seconds.thousandths (for example 1:25.876 or 22:14.742). Leave an empty string when the screen does not show that value.",
    "penalty_seconds: time penalty in seconds when shown, otherwise 0.",
    "Never invent rows or values. If part of the image is cut off or unreadable, leave those values empty and describe the problem in the unreadable field.",
    names.length ? "Names already used in this league, only as spelling hints (still copy what is on screen): " + names.slice(0, 120).join(", ") : "",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => null);
    if (!body || typeof body.image !== "string" || typeof body.league_id !== "string") return reply({ error: "Send league_id and image." }, 400);
    if (!MIMES.includes(body.mime)) return reply({ error: "The image must be a JPEG, PNG or WebP." }, 400);
    if (body.image.length > MAX_IMAGE_CHARS) return reply({ error: "That image is too large. Try a smaller photo." }, 413);

    // Is the caller an admin of this league? One small request to the database as the signed-in user.
    const adm = await fetch(Deno.env.get("SUPABASE_URL")! + "/rest/v1/rpc/can_admin_league", {
      method: "POST",
      headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ lid: body.league_id }),
    });
    if (!adm.ok || (await adm.json()) !== true) return reply({ error: "Only league admins can read results from an image." }, 403);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return reply({ error: "GEMINI_API_KEY has not been set for this function." }, 500);
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
    const names = Array.isArray(body.drivers) ? body.drivers.filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 60)) : [];

    // Ask the model to think briefly (much faster for reading a screen); if it does not accept that setting, ask again without it.
    // Gemini also answers 429 or 503 when busy, so try again a few times before giving up.
    const contents = [{ role: "user", parts: [{ text: promptFor(names) }, { inlineData: { mimeType: body.mime, data: body.image } }] }];
    const payloadFor = (fast: boolean) => JSON.stringify({
      contents,
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0, ...(fast ? { thinkingConfig: { thinkingLevel: "low" } } : {}) },
    });
    let fast = true;
    const trail: string[] = [];
    let res: Response | null = null;
    const started = Date.now();
    for (let attempt = 0; attempt < 4; attempt++) {
      const left = 120_000 - (Date.now() - started); // stay under the platform's time limit
      if (left < 15_000) break;
      const t1 = Date.now();
      try {
        res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: payloadFor(fast),
          signal: AbortSignal.timeout(Math.min(left, 110_000)),
        });
      } catch {
        return reply({ error: "The AI service took too long to answer. Try again, or use a clearer image." }, 504);
      }
      trail.push(res.status + (fast ? " low" : "") + " " + Math.round((Date.now() - t1) / 1000) + "s");
      if (res.ok) break;
      if (res.status === 400 && fast) { fast = false; continue; }
      if (![429, 500, 503].includes(res.status)) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!res) return reply({ error: "No answer from the AI service." }, 502);
    if (!res.ok) {
      const t = await res.text();
      return reply({ error: (res.status === 503 || res.status === 429 ? "The AI service is busy right now. Wait a minute and try again. " : "The AI service returned an error. ") + "(" + res.status + ") " + t.slice(0, 160) }, 502);
    }
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
    let parsed: { rows?: unknown[]; unreadable?: string };
    try { parsed = JSON.parse(text); } catch { return reply({ error: "The AI service did not return readable results. Try a clearer image." }, 502); }
    const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).slice(0, 60).map((r) => {
      const o = r as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");
      const st = typeof o.status === "string" && ["finished", "dnf", "dns", "dsq"].includes(o.status) ? o.status : "finished";
      const pen = typeof o.penalty_seconds === "number" && isFinite(o.penalty_seconds) && o.penalty_seconds > 0 ? o.penalty_seconds : 0;
      return { driver: s(o.driver), status: st, best_lap: s(o.best_lap), race_time: s(o.race_time), penalty_seconds: pen, total_time: s(o.total_time) };
    }).filter((r) => r.driver);
    return reply({ rows, unreadable: typeof parsed.unreadable === "string" ? parsed.unreadable.slice(0, 300) : "", ms: Date.now() - started, trail, model });
  } catch (e) {
    return reply({ error: "Something went wrong: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
