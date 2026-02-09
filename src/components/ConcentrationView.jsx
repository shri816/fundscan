import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';

function formatINR(amount) {
  if (amount >= 10000000) return `\u20B9${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(1)} L`;
  return '\u20B9' + amount.toLocaleString('en-IN');
}

const SECTOR_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
  '#eab308', '#ef4444', '#06b6d4', '#84cc16', '#f43f5e',
  '#6366f1', '#a855f7', '#22c55e', '#f59e0b', '#64748b',
];

function getConcentrationSeverity(weight) {
  if (weight >= 50) return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'High Risk' };
  if (weight >= 35) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'Moderate' };
  return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: 'Healthy' };
}

function getBarColor(weight) {
  if (weight >= 10) return '#dc2626';
  if (weight >= 5) return '#f59e0b';
  return '#3b82f6';
}

function formatSource(sources) {
  if (!sources || sources.length === 0) return '';
  const fundCount = sources.filter((s) => !s.name.startsWith('Direct:')).length;
  const hasDirect = sources.some((s) => s.name.startsWith('Direct:'));

  const parts = [];
  if (fundCount > 0) parts.push(`${fundCount} ${fundCount === 1 ? 'fund' : 'funds'}`);
  if (hasDirect) parts.push('direct');
  return `via ${parts.join(' + ')}`;
}

function truncateStockName(name, maxLen = 18) {
  if (!name) return 'Unknown';
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '\u2026';
}

// Custom label for the pie chart
function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function ConcentrationView({
  stockConcentration,
  sectorConcentration,
  assetAllocation,
}) {
  const hasStockData =
    stockConcentration &&
    stockConcentration.details &&
    stockConcentration.details.length > 0;

  const hasSectorData = sectorConcentration && sectorConcentration.length > 0;

  if (!hasStockData && !hasSectorData) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          Concentration Analysis
        </h2>
        <p className="text-sm text-gray-500">
          Add holdings to see concentration analysis.
        </p>
      </div>
    );
  }

  const top5Severity = hasStockData
    ? getConcentrationSeverity(stockConcentration.top5.combinedWeight)
    : null;

  // Prepare top 10 stock data for bar chart
  const top10Data = hasStockData
    ? stockConcentration.top10.stocks.map((s) => ({
        name: truncateStockName(s.stock),
        fullName: s.stock,
        weight: s.weight,
      }))
    : [];

  // Look up source info from details
  const detailsMap = new Map();
  if (hasStockData) {
    for (const d of stockConcentration.details) {
      detailsMap.set(d.isin, d);
    }
  }

  // Sector data for pie chart
  const sectorPieData = hasSectorData
    ? sectorConcentration.map((s, i) => ({
        name: s.sector,
        value: s.weight,
        fill: SECTOR_COLORS[i % SECTOR_COLORS.length],
        stocks: s.stocks,
      }))
    : [];

  // Flag sectors over 40%
  const flaggedSectors = hasSectorData
    ? sectorConcentration.filter((s) => s.weight > 40)
    : [];

  return (
    <div className="space-y-6">
      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Stock Concentration */}
        {hasStockData && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              Stock Concentration
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              How concentrated your portfolio is in individual stocks.
            </p>

            {/* Top 5 Highlight */}
            {top5Severity && (
              <div
                className={`${top5Severity.bg} ${top5Severity.border} border rounded-lg p-4 mb-5`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Top 5 stocks
                  </span>
                  <span className={`text-2xl font-bold ${top5Severity.text}`}>
                    {stockConcentration.top5.combinedWeight.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  of your entire portfolio
                </p>

                {/* Single stock risk callout */}
                {stockConcentration.singleStockRisk.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-current/10">
                    <p className="text-xs font-medium text-red-600">
                      {stockConcentration.singleStockRisk.length}{' '}
                      {stockConcentration.singleStockRisk.length === 1
                        ? 'stock exceeds'
                        : 'stocks exceed'}{' '}
                      10% individual weight:{' '}
                      {stockConcentration.singleStockRisk
                        .map((s) => `${s.stock} (${s.weight.toFixed(1)}%)`)
                        .join(', ')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Top 10 Bar Chart */}
            {top10Data.length > 0 && (
              <div
                style={{
                  height: Math.max(200, top10Data.length * 40),
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top10Data}
                    layout="vertical"
                    margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
                  >
                    <XAxis
                      type="number"
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fontSize: 11, fill: '#374151' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value) => [`${value}%`, 'Weight']}
                      labelFormatter={(label, payload) => {
                        if (payload && payload[0]) {
                          const item = payload[0].payload;
                          const isinMatch = stockConcentration.top10.stocks.find(
                            (s) => s.stock === item.fullName
                          );
                          const detail = isinMatch
                            ? detailsMap.get(isinMatch.isin)
                            : null;
                          const sourceLabel =
                            detail && detail.sources.length > 1
                              ? ` (${formatSource(detail.sources)})`
                              : '';
                          return item.fullName + sourceLabel;
                        }
                        return label;
                      }}
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="weight"
                      radius={[0, 4, 4, 0]}
                      barSize={22}
                    >
                      {top10Data.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={getBarColor(entry.weight)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Source labels below chart */}
            {top10Data.length > 0 && (
              <div className="mt-3 space-y-1">
                {stockConcentration.top10.stocks.map((s) => {
                  const detail = detailsMap.get(s.isin);
                  if (!detail || detail.sources.length <= 1) return null;
                  return (
                    <p key={s.isin} className="text-xs text-gray-400">
                      {s.stock}{' '}
                      <span className="text-gray-500">
                        ({formatSource(detail.sources)})
                      </span>
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* RIGHT: Sector Breakdown */}
        {hasSectorData && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              Sector Breakdown
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Distribution of your holdings across industry sectors.
            </p>

            {/* Flagged sectors */}
            {flaggedSectors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
                <p className="text-xs font-medium text-amber-700">
                  {flaggedSectors.map((s) => s.sector).join(', ')}{' '}
                  {flaggedSectors.length === 1 ? 'accounts' : 'account'} for
                  over 40% of your portfolio. Consider diversifying.
                </p>
              </div>
            )}

            {/* Donut Chart */}
            <div className="flex justify-center mb-4" style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sectorPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={renderCustomLabel}
                    labelLine={false}
                  >
                    {sectorPieData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      `${value.toFixed(1)}%`,
                      name,
                    ]}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {sectorPieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <span className="text-xs text-gray-700 truncate">
                    {entry.name}
                  </span>
                  <span className="text-xs font-semibold text-gray-900 ml-auto flex-shrink-0">
                    {entry.value.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Asset Type Bar */}
      {assetAllocation && assetAllocation.total > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Asset Type Split
          </h3>
          <div className="flex items-center gap-4">
            {/* Stacked bar */}
            <div className="flex-1 flex h-5 rounded-full overflow-hidden bg-gray-100">
              {assetAllocation.funds > 0 && (
                <div
                  className="bg-blue-500 transition-all duration-500"
                  style={{ width: `${assetAllocation.funds}%` }}
                  title={`Mutual Funds: ${assetAllocation.funds}%`}
                />
              )}
              {assetAllocation.stocks > 0 && (
                <div
                  className="bg-violet-500 transition-all duration-500"
                  style={{ width: `${assetAllocation.stocks}%` }}
                  title={`Stocks: ${assetAllocation.stocks}%`}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-6 mt-3 text-sm">
            {assetAllocation.funds > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-blue-500" />
                <span className="text-gray-600">
                  Mutual Funds{' '}
                  <span className="font-semibold text-gray-900">
                    {assetAllocation.funds}%
                  </span>
                </span>
              </div>
            )}
            {assetAllocation.stocks > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-violet-500" />
                <span className="text-gray-600">
                  Direct Stocks{' '}
                  <span className="font-semibold text-gray-900">
                    {assetAllocation.stocks}%
                  </span>
                </span>
              </div>
            )}
            <span className="text-gray-400 ml-auto text-xs">
              Total: {formatINR(assetAllocation.total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
