import { useId, useMemo, useState, type PointerEvent } from 'react';

export type ChartPoint = { day: string; value: number | null };

const W = 760;
const PAD = { left: 46, right: 16, top: 14, bottom: 26 };

/**
 * Catmull-Rom to cubic bezier. `tension` stays low so a spiky traffic series
 * never dips below zero or invents peaks between real data points.
 */
function smoothPath(pts: [number, number][], tension = 0.18) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

/** Splits the series into runs of consecutive non-null values (API gaps stay gaps). */
function segments(points: ChartPoint[]) {
  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ index, value: point.value });
  });
  if (run.length) runs.push(run);
  return runs;
}

const shortDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function AreaChart({
  points,
  height = 175,
  ariaLabel,
  format = (n) => String(n),
  compact = format,
}: {
  points: ChartPoint[];
  height?: number;
  ariaLabel: string;
  format?: (n: number) => string;
  compact?: (n: number) => string;
}) {
  const rawId = useId();
  const gradientId = `area-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [active, setActive] = useState<number | null>(null);

  const known = useMemo(
    () => points.filter((p): p is { day: string; value: number } => p.value !== null),
    [points],
  );
  const max = Math.max(1, ...known.map((p) => p.value)) * 1.12;
  const average = known.length ? known.reduce((sum, p) => sum + p.value, 0) / known.length : 0;

  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;
  const x = (index: number) => PAD.left + index * (plotW / Math.max(1, points.length - 1));
  const y = (value: number) => PAD.top + plotH * (1 - value / max);

  const runs = useMemo(() => segments(points), [points]);

  // Tick positions come from real index maths, so labels sit under their data.
  const ticks = useMemo(() => {
    if (points.length < 2) return points.length ? [0] : [];
    const count = Math.min(5, points.length);
    const picked = Array.from({ length: count }, (_, i) =>
      Math.round((i * (points.length - 1)) / (count - 1)),
    );
    return [...new Set(picked)];
  }, [points.length]);

  const activePoint = active === null ? null : points[active];
  const showActive = active !== null && activePoint?.value !== null && activePoint != null;
  const lastKnown = useMemo(() => {
    for (let i = points.length - 1; i >= 0; i--) {
      const value = points[i].value;
      if (value !== null) return { index: i, value };
    }
    return null;
  }, [points]);

  function move(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setActive(Math.round(ratio * Math.max(0, points.length - 1)));
  }

  const tipLeft = active === null ? 0 : Math.min(94, Math.max(6, ((x(active) - PAD.left) / plotW) * 100));

  return (
    <div className="chart">
      <div className="chart-plot" style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} style={{ height }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--green)" stopOpacity="0.42" />
              <stop offset="55%" stopColor="var(--green)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--green)" stopOpacity="0.015" />
            </linearGradient>
          </defs>

          {[0, 1 / 3, 2 / 3, 1].map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={PAD.top + plotH * t}
                y2={PAD.top + plotH * t}
                className={t === 1 ? 'chart-baseline' : 'grid-line'}
              />
              <text x={PAD.left - 10} y={PAD.top + plotH * t + 3.5} className="axis-label" textAnchor="end">
                {compact(Math.round(max * (1 - t)))}
              </text>
            </g>
          ))}

          {average > 0 && (
            <g className="avg-line">
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(average)}
                y2={y(average)}
                strokeDasharray="4 5"
              />
              <text x={PAD.left + 4} y={y(average) - 5} textAnchor="start">
                avg {compact(Math.round(average))}
              </text>
            </g>
          )}

          {runs.map((run, runIndex) => {
            const coords = run.map((p) => [x(p.index), y(p.value)] as [number, number]);
            const line = smoothPath(coords);
            if (!line) return null;
            const first = coords[0];
            const last = coords[coords.length - 1];
            const fill = `${line} L${last[0].toFixed(2)},${baseY} L${first[0].toFixed(2)},${baseY} Z`;
            return (
              <g key={runIndex}>
                <path d={fill} fill={`url(#${gradientId})`} className="spark-fill" />
                <path d={line} pathLength={1} className="chart-line" />
              </g>
            );
          })}

          {/* Point markers make it read as a measured series, not decoration. */}
          {known.length <= 90 &&
            runs.map((run, runIndex) =>
              run.map((point) => (
                <circle
                  key={`${runIndex}-${point.index}`}
                  cx={x(point.index)}
                  cy={y(point.value)}
                  r={2.2}
                  className="point-marker"
                />
              )),
            )}

          {showActive && active !== null && activePoint?.value != null && (
            <>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={baseY} className="crosshair" />
              <circle cx={x(active)} cy={y(activePoint.value)} r={4.5} className="hover-point" />
            </>
          )}
          {active === null && lastKnown && (
            <circle cx={x(lastKnown.index)} cy={y(lastKnown.value)} r={4} className="chart-point" />
          )}

          {ticks.map((index, order) => (
            <text
              key={index}
              x={x(index)}
              y={height - 7}
              className="axis-label axis-date"
              textAnchor={order === 0 ? 'start' : order === ticks.length - 1 ? 'end' : 'middle'}
            >
              {shortDay(points[index].day)}
            </text>
          ))}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onPointerMove={move}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {showActive && active !== null && activePoint?.value != null && (
          <div
            className="chart-tip"
            style={{
              left: `${tipLeft}%`,
              top: `${(y(activePoint.value) / height) * 100}%`,
            }}
          >
            <strong>{format(activePoint.value)}</strong>
            <span>{shortDay(activePoint.day)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
