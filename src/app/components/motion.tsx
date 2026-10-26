/** Small motion helpers for the landing page: reveal on scroll and counting numbers. Both honour reduced motion. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const prefersReducedMotion = () => query?.matches ?? false;

/** True from the first time the element scrolls into view. */
export function useInView<T extends Element>(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen] as const;
}

/** Fades and lifts its content into place the first time it scrolls into view. */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/** Counts up to `value` once `run` turns true (eased, about a second and a half). */
export function CountUp({ value, run }: { value: number; run: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (prefersReducedMotion()) return setN(value);
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1500);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, value]);
  return <>{n.toLocaleString('en-GB')}</>;
}
