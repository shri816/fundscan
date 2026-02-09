import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';

function formatINR(amount) {
  if (amount >= 10000000) return `\u20B9${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(1)} L`;
  return '\u20B9' + amount.toLocaleString('en-IN');
}

const severityConfig = {
  critical: {
    icon: AlertTriangle,
    border: 'border-l-red-500',
    iconColor: 'text-red-500',
    bg: 'bg-red-50',
    badgeBg: 'bg-red-100',
    badgeText: 'text-red-700',
    label: 'Critical',
    sortOrder: 0,
  },
  warning: {
    icon: AlertCircle,
    border: 'border-l-amber-500',
    iconColor: 'text-amber-500',
    bg: 'bg-amber-50',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
    label: 'Warning',
    sortOrder: 1,
  },
  info: {
    icon: Info,
    border: 'border-l-blue-500',
    iconColor: 'text-blue-500',
    bg: 'bg-blue-50',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    label: 'Suggestion',
    sortOrder: 2,
  },
};

function sortBySeverity(recommendations) {
  return [...recommendations].sort((a, b) => {
    const orderA = severityConfig[a.severity]?.sortOrder ?? 3;
    const orderB = severityConfig[b.severity]?.sortOrder ?? 3;
    return orderA - orderB;
  });
}

function RecCard({ rec }) {
  const config = severityConfig[rec.severity] || severityConfig.info;
  const Icon = config.icon;

  return (
    <div className={`border border-gray-100 ${config.border} border-l-4 rounded-lg p-4 md:p-5`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm font-bold text-gray-900">{rec.title}</h3>
            <span
              className={`${config.badgeBg} ${config.badgeText} text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0`}
            >
              {config.label}
            </span>
          </div>

          {rec.description && (
            <p className="text-sm text-gray-600 mb-3">{rec.description}</p>
          )}

          {rec.funds && rec.funds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {rec.funds.map((fund, fIdx) => (
                <span key={fIdx} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">
                  {fund}
                </span>
              ))}
            </div>
          )}

          {rec.action && (
            <div className={`${config.bg} rounded-lg p-3 mb-2`}>
              <div className="flex items-start gap-2">
                <ArrowRight className={`w-4 h-4 ${config.iconColor} flex-shrink-0 mt-0.5`} />
                <p className="text-sm font-medium text-gray-800">{rec.action}</p>
              </div>
            </div>
          )}

          {rec.impact && (
            <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 inline-block px-2.5 py-1 rounded-full">
              {rec.impact}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * TopIssues: Compact summary shown right after the score card.
 * Shows top 3 issues as one-liners with severity indicators.
 */
export function TopIssues({ recommendations, onViewAll }) {
  if (!recommendations || recommendations.length === 0) return null;

  const sorted = sortBySeverity(recommendations);
  const top3 = sorted.slice(0, 3);
  const remaining = sorted.length - 3;

  const counts = {
    critical: recommendations.filter((r) => r.severity === 'critical').length,
    warning: recommendations.filter((r) => r.severity === 'warning').length,
    info: recommendations.filter((r) => r.severity === 'info').length,
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-gray-900">Top Issues</h2>
        <div className="flex gap-2">
          {counts.critical > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {counts.critical} critical
            </span>
          )}
          {counts.warning > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {counts.warning} warning{counts.warning > 1 ? 's' : ''}
            </span>
          )}
          {counts.info > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {counts.info} tip{counts.info > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {top3.map((rec, idx) => {
          const config = severityConfig[rec.severity] || severityConfig.info;
          const Icon = config.icon;
          return (
            <div key={rec.id || idx} className="flex items-center gap-3 py-1.5">
              <Icon className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
              <span className="text-sm text-gray-800 font-medium truncate">{rec.title}</span>
            </div>
          );
        })}
      </div>

      {remaining > 0 && (
        <button
          onClick={onViewAll}
          className="mt-3 text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors"
        >
          +{remaining} more recommendation{remaining > 1 ? 's' : ''} below
        </button>
      )}
    </div>
  );
}

/**
 * Full Recommendations: Detailed view shown at the bottom of results.
 */
export default function Recommendations({ recommendations }) {
  const [expanded, setExpanded] = useState(false);

  if (!recommendations || recommendations.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">All Recommendations</h2>
        <p className="text-sm text-gray-500">
          No issues found. Your portfolio looks good.
        </p>
      </div>
    );
  }

  const sorted = sortBySeverity(recommendations);
  const INITIAL_COUNT = 3;
  const hasMore = sorted.length > INITIAL_COUNT;
  const visible = expanded ? sorted : sorted.slice(0, INITIAL_COUNT);
  const hiddenCount = sorted.length - INITIAL_COUNT;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">All Recommendations</h2>
        <p className="text-sm text-gray-500">
          {sorted.length} recommendation{sorted.length > 1 ? 's' : ''} for your portfolio
        </p>
      </div>

      <div className="space-y-4">
        {visible.map((rec, idx) => (
          <RecCard key={rec.id || idx} rec={rec} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
        >
          {expanded ? (
            <>
              Show less <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Show {hiddenCount} more recommendation{hiddenCount > 1 ? 's' : ''} <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
