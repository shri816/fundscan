import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';

function formatINR(amount) {
  if (amount >= 10000000) return `\u20B9${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(1)} L`;
  return '\u20B9' + amount.toLocaleString('en-IN');
}

const colorMap = {
  red: {
    ring: 'stroke-red-500',
    text: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: AlertTriangle,
    iconColor: 'text-red-500',
    trackRing: 'stroke-red-100',
  },
  yellow: {
    ring: 'stroke-amber-500',
    text: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: Shield,
    iconColor: 'text-amber-500',
    trackRing: 'stroke-amber-100',
  },
  green: {
    ring: 'stroke-emerald-500',
    text: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: CheckCircle,
    iconColor: 'text-emerald-500',
    trackRing: 'stroke-emerald-100',
  },
};

function getContextText(score) {
  if (score < 40) {
    return 'Your portfolio needs serious restructuring.';
  }
  if (score <= 70) {
    return "Room for improvement. Here's what to fix.";
  }
  return 'Your portfolio is in good shape.';
}

export default function ScoreCard({ score, color, label, summary }) {
  const theme = colorMap[color] || colorMap.yellow;
  const Icon = theme.icon;

  // SVG ring params
  const radius = 70;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(score, 0), 100);
  const dashOffset = circumference - (progress / 100) * circumference;

  return (
    <div
      className={`${theme.bg} ${theme.border} border rounded-2xl p-6 md:p-8`}
    >
      <div className="flex flex-col items-center md:flex-row md:items-center md:gap-10">
        {/* Score Ring */}
        <div className="relative flex-shrink-0 mb-6 md:mb-0">
          <svg
            width="180"
            height="180"
            viewBox="0 0 180 180"
            className="-rotate-90"
          >
            {/* Track */}
            <circle
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              className={theme.trackRing}
            />
            {/* Progress */}
            <circle
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={theme.ring}
              style={{
                transition: 'stroke-dashoffset 0.8s ease-out',
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-6xl font-bold tabular-nums ${theme.text}`}>
              {score}
            </span>
            <span className="text-sm text-gray-500 font-medium mt-1">
              / 100
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
            <Icon className={`w-5 h-5 ${theme.iconColor}`} />
            <span className={`text-lg font-semibold ${theme.text}`}>
              {label}
            </span>
          </div>
          <p className="text-gray-700 text-base mb-5">
            {getContextText(score)}
          </p>

          {/* Summary Stats */}
          {summary && (
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-5 gap-y-2 text-sm text-gray-600">
              {summary.totalFunds > 0 && (
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-gray-800">
                    {summary.totalFunds}
                  </span>{' '}
                  {summary.totalFunds === 1 ? 'fund' : 'funds'}
                </span>
              )}
              {summary.totalStocks > 0 && (
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-gray-800">
                    {summary.totalStocks}
                  </span>{' '}
                  {summary.totalStocks === 1 ? 'stock' : 'stocks'}
                </span>
              )}
              {summary.totalInvested > 0 && (
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-gray-800">
                    {formatINR(summary.totalInvested)}
                  </span>{' '}
                  invested
                </span>
              )}
              {summary.avgOverlap > 0 && (
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-gray-800">
                    {summary.avgOverlap}%
                  </span>{' '}
                  avg overlap
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
