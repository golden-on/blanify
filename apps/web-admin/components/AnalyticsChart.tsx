interface DataPoint {
  label: string;
  value: number;
}

interface AnalyticsChartProps {
  data: DataPoint[];
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
}

// Dependency-free inline-SVG bar chart — this app has no charting library, and a
// hand-rolled chart avoids adding one for a single historical-view screen.
export function AnalyticsChart({ data, color = "#0f172a", height = 160, formatValue = (v) => String(v) }: AnalyticsChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>
        No data for this range.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;
  const chartHeight = height - 20;

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.map((d, i) => {
          const barHeight = Math.max((d.value / max) * chartHeight, d.value > 0 ? 1 : 0);
          const x = i * barWidth;
          return (
            <rect
              key={i}
              x={x + barWidth * 0.15}
              y={chartHeight - barHeight}
              width={Math.max(barWidth * 0.7, 0.5)}
              height={barHeight}
              fill={color}
              rx={0.5}
            >
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
