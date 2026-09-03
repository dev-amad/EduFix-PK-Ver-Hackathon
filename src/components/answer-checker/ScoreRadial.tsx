"use client";

interface ScoreRadialProps {
  assigned: number;
  total: number;
  /** Rendered diameter in px. */
  size?: number;
}

/**
 * Task 6.4 — Assigned Score Radial.
 *
 * A dependency-free SVG ring that fills to the awarded proportion and shifts
 * colour by band (emerald >= 75%, amber >= 50%, rose below). Used at the top of
 * the evaluation dashboard next to the CAIE level badge.
 */
export function ScoreRadial({ assigned, total, size = 136 }: ScoreRadialProps) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const safeAssigned = Number.isFinite(assigned) ? Math.max(0, assigned) : 0;
  const pct = safeTotal > 0 ? Math.min(1, safeAssigned / safeTotal) : 0;

  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  const toneClass =
    pct >= 0.75
      ? "stroke-emerald-500"
      : pct >= 0.5
        ? "stroke-amber-500"
        : "stroke-rose-500";

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`Scored ${safeAssigned} out of ${safeTotal} marks (${Math.round(
          pct * 100
        )} percent)`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={toneClass}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums leading-none">
          {safeAssigned}
          <span className="text-base font-medium text-muted-foreground">
            /{safeTotal}
          </span>
        </span>
        <span className="mt-1 text-xs font-medium text-muted-foreground">
          {safeTotal > 0 ? `${Math.round(pct * 100)}%` : "ungraded"}
        </span>
      </div>
    </div>
  );
}
