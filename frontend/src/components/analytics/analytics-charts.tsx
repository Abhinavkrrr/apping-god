"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

export interface AnalyticsData {
  totals: {
    sent: number;
    replied: number;
    bounced: number;
    awaiting_reply: number;       // sent - replied - bounced (still in-flight)
    failed: number;
    pending: number;
    approved: number;
  };
  rates: {
    reply_rate: number;            // replied / sent
    bounce_rate: number;           // bounced / sent
    positive_rate: number;         // positive / sent
  };
  // Last-30-days daily buckets — for the time-series chart
  timeline: Array<{
    date: string;                  // "Apr 28"
    sent: number;
    replied: number;
    bounced: number;
  }>;
  // Classification of replies — for the bar chart
  replyClassification: Array<{ category: string; count: number; color: string }>;
  // Bounce types — for the bar chart
  bounceTypes: Array<{ type: string; count: number; color: string }>;
  // Reply-outcome donut — what happened to every sent email
  outcomeDonut: Array<{ name: string; value: number; color: string }>;
  // Per-campaign
  perCampaign: Array<{
    name: string; status: string;
    sent: number; replied: number; bounced: number;
    reply_rate: number; bounce_rate: number;
  }>;
}

export function AnalyticsCharts({ data }: { data: AnalyticsData }) {
  const hasSent = data.totals.sent > 0;

  return (
    <div className="space-y-6">
      {/* ── Row 1: Sends timeline ─────────────────────────────── */}
      <Card title="Sends over time (last 30 days)" desc="Daily volume — sent vs bounced.">
        {!hasSent ? <EmptyChart label="No sends in the last 30 days." /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.timeline} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "none", borderRadius: 6, fontSize: 12, color: "#fff" }}
                labelStyle={{ color: "#cbd5e1" }} cursor={{ fill: "#f1f5f9" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="sent" stackId="a" fill="#10b981" name="Sent" radius={[0,0,0,0]} />
              <Bar dataKey="bounced" stackId="a" fill="#ef4444" name="Bounced" radius={[2,2,0,0]} />
              <Bar dataKey="replied" fill="#3b82f6" name="Replied" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Row 2: Outcome donut + Reply classification ───────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="What happened to every sent email"
          desc="Of all delivered emails, here's the outcome split."
        >
          {!hasSent ? <EmptyChart label="No sends yet." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.outcomeDonut}
                  dataKey="value" nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={90}
                  paddingAngle={2}
                  label={({ name, value }) => value > 0 ? `${name}: ${value}` : ""}
                  labelLine={false}
                >
                  {data.outcomeDonut.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "none", borderRadius: 6, fontSize: 12, color: "#fff" }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <DonutLegend items={data.outcomeDonut} />
        </Card>

        <Card title="Reply classification" desc="When someone DID reply, what did they say?">
          {data.replyClassification.every(c => c.count === 0) ? (
            <EmptyChart label="No replies classified yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={data.replyClassification}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 11, fill: "#64748b" }} width={92} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "none", borderRadius: 6, fontSize: 12, color: "#fff" }}
                  cursor={{ fill: "#f1f5f9" }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.replyClassification.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ── Row 3: Bounce types + Per-campaign performance ────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Bounce types" desc="Hard = dead address. Soft = temporary problem.">
          {data.bounceTypes.every(b => b.count === 0) ? (
            <EmptyChart label="Zero bounces — sender reputation is healthy." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.bounceTypes} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="type" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "none", borderRadius: 6, fontSize: 12, color: "#fff" }}
                  cursor={{ fill: "#f1f5f9" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data.bounceTypes.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Per-campaign performance" desc="Reply rate and bounce rate side by side.">
          {data.perCampaign.length === 0 ? <EmptyChart label="No campaigns yet." /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.perCampaign} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }}
                  label={{ value: "%", angle: 0, position: "insideTopLeft", fontSize: 10, fill: "#64748b" }} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "none", borderRadius: 6, fontSize: 12, color: "#fff" }}
                  formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : String(v ?? "")}
                  cursor={{ fill: "#f1f5f9" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="reply_rate" fill="#3b82f6" name="Reply %" radius={[2,2,0,0]} />
                <Bar dataKey="bounce_rate" fill="#ef4444" name="Bounce %" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Small presentational helpers ──────────────────────────────

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">
      {label}
    </div>
  );
}

function DonutLegend({ items }: { items: Array<{ name: string; value: number; color: string }> }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {items.map(i => (
        <div key={i.name} className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: i.color }} />
            <span className="text-slate-700">{i.name}</span>
          </span>
          <span className="text-slate-500 tabular-nums">
            {i.value} <span className="text-slate-400">({((i.value/total)*100).toFixed(1)}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}
