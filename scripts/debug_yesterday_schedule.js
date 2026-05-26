// Diagnoses what happened to yesterday's scheduled batch.
// Bins sends by (status, scheduled_at, sent_at) so we can see the exact
// timeline of why some sent and others didn't.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

(async () => {
  const c = new Client(POOLER);
  await c.connect();

  // 1) Yesterday's batch (anything scheduled in last 48h)
  const sched = await c.query(`
    SELECT status, count(*) AS n,
           min(scheduled_at) AS earliest_scheduled,
           max(scheduled_at) AS latest_scheduled,
           min(sent_at) AS earliest_sent,
           max(sent_at) AS latest_sent
    FROM sends
    WHERE scheduled_at > now() - interval '48 hours'
    GROUP BY status
    ORDER BY n DESC
  `);
  console.log("\n── Sends scheduled in last 48h, by status ──");
  console.table(sched.rows);

  // 2) Hour-by-hour breakdown of when sent_at actually happened
  const hourly = await c.query(`
    SELECT date_trunc('hour', sent_at AT TIME ZONE 'Asia/Kolkata') AS hour_ist,
           count(*) AS sent_count
    FROM sends
    WHERE sent_at > now() - interval '48 hours'
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("\n── Sends actually sent, by hour (IST) ──");
  console.table(hourly.rows.map(r => ({
    hour_ist: r.hour_ist?.toISOString?.()?.replace("T", " ").slice(0, 16),
    sent_count: r.sent_count,
  })));

  // 3) Still-approved (scheduled but not yet sent)
  const stuck = await c.query(`
    SELECT count(*) AS still_approved_and_due_now
    FROM sends
    WHERE status = 'approved'
      AND scheduled_at <= now()
      AND sent_at IS NULL
  `);
  console.log("\n── Currently 'approved' AND past their scheduled time (stuck in queue) ──");
  console.table(stuck.rows);

  // 4) Failures with reasons
  const failed = await c.query(`
    SELECT failure_reason, count(*) AS n
    FROM sends
    WHERE status = 'failed' AND sent_at IS NULL
      AND scheduled_at > now() - interval '48 hours'
    GROUP BY failure_reason
    ORDER BY n DESC
    LIMIT 10
  `);
  console.log("\n── Recent failures ──");
  console.table(failed.rows);

  await c.end();
})();
