import { useId } from 'react';

/**
 * Tiny area sparkline for KPI cards. Decorative only (`aria-hidden`): the real
 * number and its label are already exposed as text beside it.
 */
export default function Sparkline({
  values,
  height = 26,
}: {
  values: (number | null)[];
  height?: number;
}) {
  const gradientId = `spark-${useId().replace(/[:«»]/g, '')}`;
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;

  const max = Math.max(1, ...known);
  const step = 100 / Math.max(1, values.length - 1);
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push([index * step, height - 2 - (value / max) * (height - 4)]);
  });
  if (run.length) runs.push(run);

  return (
    <svg className="sparkline" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--green)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {runs.map((points, index) => {
        const line = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
        const first = points[0];
        const last = points[points.length - 1];
        const fill = `${line} L${last[0].toFixed(2)},${height} L${first[0].toFixed(2)},${height} Z`;
        return (
          <g key={index}>
            <path className="spark-fill" d={fill} fill={`url(#${gradientId})`} />
            <path d={line} />
          </g>
        );
      })}
    </svg>
  );
}
