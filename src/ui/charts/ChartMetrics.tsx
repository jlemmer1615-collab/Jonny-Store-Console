import type { Traffic } from '../../types';

const count = (n: number) => new Intl.NumberFormat('en-US').format(n);

/**
 * Supporting metrics beneath the traffic chart.
 *
 * Deliberately NOT a second chart of the same views series: repeating one series
 * as an area chart and then as bars is decoration, not information. Impressions,
 * transactions and view-to-sale conversion come from the same daily rows but
 * answer different questions.
 */
export default function ChartMetrics({ rows }: { rows: Traffic[] }) {
  const impressionsSeries = rows.map((row) => row.impressions);
  const transactionSeries = rows.map((row) => row.transactions);
  const viewsTotal = rows.reduce((sum, row) => sum + (row.views ?? 0), 0);
  const impressionsTotal = impressionsSeries.some((v) => v !== null)
    ? impressionsSeries.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    : null;
  const transactionsTotal = transactionSeries.some((v) => v !== null)
    ? transactionSeries.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    : null;
  const conversion =
    transactionsTotal === null || !viewsTotal ? null : (transactionsTotal / viewsTotal) * 100;

  const items = [
    { label: 'Impressions', value: impressionsTotal === null ? '—' : count(impressionsTotal) },
    { label: 'Transactions', value: transactionsTotal === null ? '—' : count(transactionsTotal) },
    {
      label: 'View to sale',
      value: conversion === null ? '—' : `${conversion.toFixed(1)}%`,
    },
  ];

  return (
    <div className="chart-metrics">
      {items.map((item) => (
        <div key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
