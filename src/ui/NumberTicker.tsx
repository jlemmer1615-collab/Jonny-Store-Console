import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './primitives';

/**
 * Counts a metric from its previous value to the next one on mount and change.
 *
 * Output is plain text so existing `getByText` assertions keep working. Falls
 * back to the final value immediately when motion is reduced or when
 * requestAnimationFrame is unavailable (jsdom).
 */
export default function NumberTicker({
  value,
  format,
  className = '',
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const begin = shownRef.current;
    const delta = value - begin;
    if (!delta) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const progress = Math.min(1, (now - start) / 620);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = begin + delta * eased;
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
      else {
        shownRef.current = value;
        setShown(value);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  return <span className={`ticker ${className}`.trim()}>{format(shown)}</span>;
}
