import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

/**
 * True when the user asked for reduced motion, or when we cannot tell.
 *
 * Defaults to `true` so the very first render is always the calm one: jsdom has
 * no `matchMedia`, and starting settled avoids an animation flash before the
 * media query is read.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Safari < 14 fallback.
    if (typeof query.addListener === 'function') {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return;
  }, []);
  return reduced;
}

/**
 * Reports whether an element has entered the viewport.
 *
 * Never used to hide content: the returned flag only ADDS an animation class to
 * an already-visible element, so a missing IntersectionObserver (jsdom) or a
 * user who never scrolls still sees everything.
 */
export function useInView<T extends HTMLElement>(rootMargin = '0px 0px -8% 0px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);
  return { ref, inView };
}

/**
 * Cursor-tracking spotlight for every `.surface` inside one container.
 *
 * One delegated listener for the whole screen instead of one per card, and the
 * write is coalesced into a single animation frame. Positions land on CSS custom
 * properties (`--mx` / `--my`) that the surface pseudo elements read.
 */
export function useSpotlight<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof root.addEventListener !== 'function') return;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? (callback: () => void) => requestAnimationFrame(callback)
        : (callback: () => void) => {
            callback();
            return 0;
          };
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = schedule(() => {
        frame = 0;
        const target = (event.target as Element | null)?.closest?.('.surface');
        if (!(target instanceof HTMLElement) || !root.contains(target)) return;
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        target.style.setProperty('--my', `${event.clientY - rect.top}px`);
      });
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/** Bubble-in wrapper. Stagger with `index`; base state is always visible. */
export function Reveal({
  children,
  index = 0,
  className = '',
  soft = false,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  soft?: boolean;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const animation = inView ? (soft ? 'reveal-soft' : 'reveal') : '';
  return (
    <div
      ref={ref}
      className={`${animation} ${className}`.trim()}
      style={{ '--i': index } as CSSProperties}
    >
      {children}
    </div>
  );
}
