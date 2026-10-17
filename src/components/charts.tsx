import { useState } from 'react';

export const SERIES = ['#4b45e6', '#f59e0b'] as const;

interface Series {
  name: string;
  values: number[];
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** Rounded-top path for a bar anchored to the baseline. */
const barPath = (x: number, y: number, w: number, h: number, r = 4) => {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

/** Grouped vertical bar chart (1–2 series) with hover tooltip. */
export function BarChart({ labels, series, format, height = 240 }: { labels: string[]; series: Series[]; format: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 8, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const band = iw / labels.length;
  const gap = 2;
  const groupW = Math.min(band * 0.62, 44);
  const barW = (groupW - gap * (series.length - 1)) / series.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
        <g className="grid">
          {ticks.map((t) => {
            const y = pad.t + ih - (t / max) * ih;
            return (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} />
                <text x={pad.l - 8} y={y + 4} textAnchor="end">
                  {format(t)}
                </text>
              </g>
            );
          })}
        </g>
        {labels.map((lab, i) => {
          const gx = pad.l + band * i + (band - groupW) / 2;
          return (
            <g key={lab + i}>
              {hover === i && <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="#eef3ff" rx={6} />}
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = (v / max) * ih;
                return <path key={s.name} d={barPath(gx + si * (barW + gap), pad.t + ih - h, barW, h)} fill={SERIES[si]} />;
              })}
              <text x={pad.l + band * i + band / 2} y={H - 8} textAnchor="middle">
                {lab}
              </text>
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%`, top: `${(pad.t / H) * 100 + 12}%` }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{labels[hover]}</div>
          {series.map((s, si) => (
            <div key={s.name}>
              <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: SERIES[si], marginRight: 6 }} />
              {s.name}: {format(s.values[hover] ?? 0)}
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend" style={{ marginTop: 8 }}>
          {series.map((s, si) => (
            <span key={s.name}>
              <i style={{ background: SERIES[si] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Single-series area/line chart with crosshair tooltip. */
export function AreaChart({ labels, values, format, height = 220, name }: { labels: string[]; values: number[]; format: (n: number) => string; height?: number; name: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 48, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...values));
  const x = (i: number) => pad.l + (labels.length === 1 ? iw / 2 : (iw * i) / (labels.length - 1));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const area = `${line}L${x(values.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`;
  const ticks = [0, 0.5, 1].map((t) => t * max);
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name}>
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.18" />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
        </g>
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {labels.map((l, i) => (
          <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle">
            {l}
          </text>
        ))}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#94a3b8" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(values[hover] ?? 0)} r={5} fill={SERIES[0]} stroke="#fff" strokeWidth={2} />
          </>
        )}
        {labels.map((l, i) => (
          <rect
            key={'h' + l + i}
            x={x(i) - iw / labels.length / 2}
            y={pad.t}
            width={iw / labels.length}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(values[hover] ?? 0) / H) * 100}%` }}>
          <strong>{labels[hover]}</strong> · {format(values[hover] ?? 0)}
        </div>
      )}
    </div>
  );
}

/** Horizontal meter list — for part-to-whole comparisons (e.g. top items). */
export function MeterList({ rows, format }: { rows: Array<{ label: string; value: number }>; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack" style={{ gap: 14 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="row between small" style={{ marginBottom: 6 }}>
            <span style={{ color: 'var(--ink-700)', fontWeight: 600 }}>{r.label}</span>
            <span className="muted">{format(r.value)}</span>
          </div>
          <div className="progress">
            <span style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
