function getSeverityColor(overlap) {
  if (overlap >= 70) return { bar: '#dc2626', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-100 text-red-700' };
  if (overlap >= 40) return { bar: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' };
  return { bar: '#16a34a', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' };
}

export default function OverlapMatrix({ overlapData }) {
  if (!overlapData || !overlapData.pairs || overlapData.pairs.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Fund Overlap</h2>
        <p className="text-sm text-gray-500">
          Add at least two mutual funds to see overlap analysis.
        </p>
      </div>
    );
  }

  const { pairs } = overlapData;

  // Top 5 worst pairs
  const topPairs = pairs.slice(0, 5);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Fund Overlap</h2>
        <p className="text-sm text-gray-500">
          High overlap means your funds hold the same stocks, reducing
          diversification. Lower is better.
        </p>
      </div>

      {/* Top Overlapping Pairs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Highest Overlap Pairs
        </h3>
        <div className="grid grid-cols-1 gap-3">
          {topPairs.map((pair, idx) => {
            const severity = getSeverityColor(pair.overlap);
            const topCommon = pair.commonStocks.slice(0, 5);

            return (
              <div
                key={idx}
                className={`${severity.bg} ${severity.border} border rounded-lg p-4`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                  <div className="text-sm font-medium text-gray-800 min-w-0">
                    <span className="break-words">{pair.fundA}</span>
                    <span className="mx-2 text-gray-400">&harr;</span>
                    <span className="break-words">{pair.fundB}</span>
                  </div>
                  <span
                    className={`${severity.badge} text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap self-start sm:self-auto`}
                  >
                    {pair.overlap}% overlap
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-white/60 rounded-full h-2 mb-3">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(pair.overlap, 100)}%`,
                      backgroundColor: severity.bar,
                    }}
                  />
                </div>

                {/* Common stocks */}
                {topCommon.length > 0 && (
                  <p className="text-xs text-gray-600">
                    <span className="font-medium">
                      {pair.commonStocks.length} common{' '}
                      {pair.commonStocks.length === 1 ? 'stock' : 'stocks'}:
                    </span>{' '}
                    {topCommon.map((s) => s.stock).join(', ')}
                    {pair.commonStocks.length > 5 && (
                      <span className="text-gray-400">
                        {' '}
                        +{pair.commonStocks.length - 5} more
                      </span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
