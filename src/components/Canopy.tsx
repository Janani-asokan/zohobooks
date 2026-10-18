import { useEffect, useRef, type CSSProperties } from 'react';

/*
 * Layered jungle canopy drawn in SVG: fronds and broad leaves at three depths that sway
 * gently, gold fireflies that drift, and a soft mouse parallax. Purely decorative.
 */

type Pt = [number, number];
const bez = (p0: Pt, p1: Pt, p2: Pt, t: number): Pt => [
  (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
  (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
];
const leafPath = (len: number, w: number) =>
  `M0 0C${len * 0.28} ${-w} ${len * 0.72} ${-w * 0.75} ${len} 0C${len * 0.72} ${w * 0.75} ${len * 0.28} ${w} 0 0Z`;

/** A palm/fern frond: leaflets along a curved stem, shrinking toward the tip. */
function Frond({ len = 420, droop = 120, leaflets = 16, size = 1, color, vein }: { len?: number; droop?: number; leaflets?: number; size?: number; color: string; vein: string }) {
  const p0: Pt = [0, 0];
  const p1: Pt = [len * 0.5, -droop * 0.4];
  const p2: Pt = [len, droop];
  const parts = [];
  for (let i = 1; i <= leaflets; i++) {
    const t = i / (leaflets + 1);
    const [x, y] = bez(p0, p1, p2, t);
    const [nx, ny] = bez(p0, p1, p2, Math.min(1, t + 0.01));
    const ang = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
    const l = (1 - t * 0.75) * 120 * size;
    const w = l * 0.16;
    for (const side of [-1, 1]) {
      parts.push(<path key={`${i}${side}`} d={leafPath(l, w)} fill={color} transform={`translate(${x} ${y}) rotate(${ang + side * 52})`} />);
    }
  }
  return (
    <g>
      <path d={`M0 0Q${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]}`} fill="none" stroke={vein} strokeWidth={3 * size} strokeLinecap="round" />
      {parts}
    </g>
  );
}

/** A broad tropical leaf with a midrib. */
function Leaf({ len = 260, w = 80, color, vein }: { len?: number; w?: number; color: string; vein: string }) {
  return (
    <g>
      <path d={leafPath(len, w)} fill={color} />
      <path d={`M4 0Q${len * 0.5} ${-w * 0.08} ${len * 0.96} 0`} fill="none" stroke={vein} strokeWidth="2" opacity=".55" />
      {[0.25, 0.42, 0.58, 0.74].map((t) => (
        <g key={t} opacity=".35" stroke={vein} strokeWidth="1.2" fill="none">
          <path d={`M${len * t} 0q${len * 0.08} ${-w * 0.35} ${len * 0.16} ${-w * 0.55}`} />
          <path d={`M${len * t} 0q${len * 0.08} ${w * 0.35} ${len * 0.16} ${w * 0.55}`} />
        </g>
      ))}
    </g>
  );
}

type Placed = { x: number; y: number; r: number; s?: number; flip?: boolean; d?: number; el: JSX.Element };
const P = ({ x, y, r, s = 1, flip, d = 0, el }: Placed) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${flip ? -s : s} ${s})`}>
    <g className="sway" style={{ animationDelay: `${d}s`, animationDuration: `${7 + (d % 3)}s` } as CSSProperties}>{el}</g>
  </g>
);

const BACK = { c: '#14361f', v: '#0d2414' };
const MID = { c: '#1f5230', v: '#123520' };
const FRONT = { c: '#2c6e3f', v: '#1a4a2a' };
const LIT = { c: '#3d8a50', v: '#24593a' };

export function Canopy({ className, fireflies = 22, interactive = true, light = false }: { className?: string; fireflies?: number; interactive?: boolean; light?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', String((e.clientX - r.left) / r.width - 0.5));
        el.style.setProperty('--my', String((e.clientY - r.top) / r.height - 0.5));
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, [interactive]);

  // Deterministic firefly positions so the server-free build is stable.
  const flies = Array.from({ length: fireflies }, (_, i) => ({
    left: `${(i * 37) % 100}%`, top: `${18 + ((i * 53) % 70)}%`, delay: `${(i * 0.7) % 6}s`, dur: `${6 + (i % 5)}s`, size: 3 + (i % 3),
  }));

  return (
    <div ref={ref} className={`canopy ${className ?? ''}`} aria-hidden>
      <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="cn-glow" cx="50%" cy="38%" r="55%">
            <stop offset="0%" stopColor="#f5c400" stopOpacity=".16" />
            <stop offset="100%" stopColor="#f5c400" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cn-floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="55%" stopColor="#12381f" stopOpacity="0" />
            <stop offset="100%" stopColor="#12381f" stopOpacity=".9" />
          </linearGradient>
        </defs>
        <rect width="1440" height="800" fill="url(#cn-glow)" />

        <g className="layer l-back">
          <P x={-40} y={60} r={8} s={1.1} d={0.4} el={<Frond len={520} droop={160} color={BACK.c} vein={BACK.v} />} />
          <P x={1480} y={40} r={-8} s={1.15} flip d={1.2} el={<Frond len={540} droop={170} color={BACK.c} vein={BACK.v} />} />
          <P x={260} y={-30} r={30} s={0.8} d={2.1} el={<Frond len={420} droop={140} color={BACK.c} vein={BACK.v} />} />
          <P x={1180} y={-40} r={-30} s={0.8} flip d={0.9} el={<Frond len={420} droop={140} color={BACK.c} vein={BACK.v} />} />
          <P x={120} y={820} r={-70} d={1.6} el={<Leaf len={360} w={90} color={BACK.c} vein={BACK.v} />} />
          <P x={1330} y={830} r={-110} d={2.6} el={<Leaf len={360} w={90} color={BACK.c} vein={BACK.v} />} />
        </g>

        <g className="layer l-mid">
          <P x={-60} y={-20} r={22} s={1.2} d={1.1} el={<Frond len={500} droop={210} color={MID.c} vein={MID.v} />} />
          <P x={1500} y={-30} r={-22} s={1.2} flip d={0.2} el={<Frond len={500} droop={210} color={MID.c} vein={MID.v} />} />
          <P x={-30} y={760} r={-38} d={0.7} el={<Leaf len={330} w={95} color={MID.c} vein={MID.v} />} />
          <P x={60} y={830} r={-62} d={2.2} el={<Leaf len={300} w={80} color={MID.c} vein={MID.v} />} />
          <P x={1470} y={770} r={-142} d={1.8} el={<Leaf len={330} w={95} color={MID.c} vein={MID.v} />} />
          <P x={1380} y={840} r={-118} d={0.3} el={<Leaf len={300} w={80} color={MID.c} vein={MID.v} />} />
        </g>

        <g className="layer l-front">
          <P x={-90} y={150} r={-6} s={1.25} d={0.5} el={<Frond len={430} droop={230} color={FRONT.c} vein={FRONT.v} />} />
          <P x={1530} y={130} r={6} s={1.25} flip d={1.5} el={<Frond len={430} droop={230} color={FRONT.c} vein={FRONT.v} />} />
          <P x={-70} y={700} r={-18} d={2.4} el={<Leaf len={300} w={88} color={LIT.c} vein={LIT.v} />} />
          <P x={1510} y={690} r={-162} d={1.0} el={<Leaf len={300} w={88} color={LIT.c} vein={LIT.v} />} />
          <P x={200} y={880} r={-84} s={0.9} d={1.3} el={<Frond len={300} droop={60} color={FRONT.c} vein={FRONT.v} />} />
          <P x={1240} y={880} r={-96} s={0.9} flip d={0.6} el={<Frond len={300} droop={60} color={FRONT.c} vein={FRONT.v} />} />
        </g>
        {!light && <rect width="1440" height="800" fill="url(#cn-floor)" />}
      </svg>
      {flies.map((f, i) => (
        <span key={i} className="firefly" style={{ left: f.left, top: f.top, width: f.size, height: f.size, animationDelay: f.delay, animationDuration: f.dur }} />
      ))}
    </div>
  );
}
