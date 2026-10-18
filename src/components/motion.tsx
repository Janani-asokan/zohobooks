import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has scrolled into view (stays true). */
export function useInView<T extends Element>(threshold = 0.18) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (reduced() || !('IntersectionObserver' in window)) return setSeen(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setSeen(true), io.disconnect()), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

/** Fades and lifts its children in when scrolled into view. `delay` in ms staggers siblings. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }: { children: ReactNode; delay?: number; as?: ElementType; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <Tag ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Animates a number from 0 to `value` once `start` is true. */
export function useCountUp(value: number, start = true, ms = 1100) {
  const [n, setN] = useState(() => (reduced() ? value : 0));
  useEffect(() => {
    if (!start || reduced()) return setN(value);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, start, ms]);
  return n;
}

/** A number that counts up when it first appears; `format` renders it. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-IN') }: { value: number; format?: (v: number) => string }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.3);
  const n = useCountUp(value, seen);
  return <span ref={ref}>{format(n)}</span>;
}
