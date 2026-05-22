// Shows all events (sent, open, click, reply, etc.) for the most recent send,
// or for a specific send_id if given.
//
// Usage:
//   node scripts/check_events.js                              → most recent send
//   node scripts/check_events.js <send_id>                    → specific send
//   node scripts/check_events.js --watch                      → live-tail (refresh every 3s)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const explicitId = args.find(a => !a.startsWith("--"));

async function dump() {
  const sb = getSupabase();

  let sendId = explicitId;
  if (!sendId) {
    const { data } = await sb
      .from("sends").select("id, sent_at, status, contact_id, message_id")
      .order("created_at", { ascending: false }).limit(1).single();
    if (!data) { console.log("No sends in DB yet."); return; }
    sendId = data.id;
    console.log(`Most recent send: ${sendId}`);
    console.log(`  status: ${data.status}, sent_at: ${data.sent_at}, message_id: ${data.message_id}\n`);
  } else {
    console.log(`Send: ${sendId}\n`);
  }

  const { data: events } = await sb
    .from("events").select("*")
    .eq("send_id", sendId).order("timestamp", { ascending: true });

  if (!events || events.length === 0) {
    console.log("No events yet for this send.");
    return;
  }

  const symbols = { sent: "✉ ", open: "👁 ", click: "🔗", bounce: "⚠ ", reply: "↩ ", unsubscribe: "✖ " };
  console.log(`${events.length} event(s):`);
  for (const e of events) {
    const t = new Date(e.timestamp).toLocaleString();
    const sym = symbols[e.type] || "•";
    const meta = e.metadata ? " " + JSON.stringify(e.metadata).slice(0, 100) : "";
    console.log(`  ${sym} ${e.type.padEnd(11)} ${t}${meta}`);
  }
}

(async () => {
  if (watch) {
    console.log("Watching for events (Ctrl+C to stop)...\n");
    while (true) {
      console.clear();
      await dump();
      await new Promise(r => setTimeout(r, 3000));
    }
  } else {
    await dump();
  }
})();
