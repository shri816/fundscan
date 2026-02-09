function formatINR(amount) {
  if (amount >= 10000000) return `\u20B9${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(1)} L`;
  return '\u20B9' + amount.toLocaleString('en-IN');
}

function getERColor(er) {
  if (er > 1.5) return { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' };
  if (er > 1.0) return { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' };
  return { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' };
}

function getERBarWidth(er, maxER) {
  if (maxER === 0) return 0;
  return Math.min(100, (er / maxER) * 100);
}

export default function ExpenseView({ expenseData }) {
  if (!expenseData || expenseData.fundCosts.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          Expense Analysis
        </h2>
        <p className="text-sm text-gray-500">
          Add mutual funds to see expense ratio analysis.
        </p>
      </div>
    );
  }

  const { weightedExpenseRatio, totalAnnualCost, fundCosts, potentialSavings } =
    expenseData;

  // Sort by expense ratio descending
  const sortedFunds = [...fundCosts].sort(
    (a, b) => b.expenseRatio - a.expenseRatio
  );

  const maxER = sortedFunds.length > 0 ? sortedFunds[0].expenseRatio : 2;

  // Determine if the expense ratio is high/medium/low
  const erSeverity = getERColor(weightedExpenseRatio);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Header */}
      <h2 className="text-xl font-bold text-gray-900 mb-1">
        Expense Analysis
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        What you pay annually in fund management fees.
      </p>

      {/* Headline Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Annual Cost */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-500 mb-1">Annual Fund Expenses</p>
          <p className="text-3xl font-bold text-gray-900">
            {formatINR(totalAnnualCost)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            per year across all funds
          </p>
        </div>

        {/* Weighted Expense Ratio */}
        <div className={`${erSeverity.bg} border border-gray-200 rounded-lg p-4`}>
          <p className="text-sm text-gray-500 mb-1">
            Weighted Expense Ratio
          </p>
          <p className={`text-3xl font-bold ${erSeverity.text}`}>
            {weightedExpenseRatio.toFixed(2)}%
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Category average is ~1.0%
          </p>
        </div>
      </div>

      {/* Potential Savings */}
      {potentialSavings > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg
                className="w-4 h-4 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-800">
                You could save {formatINR(potentialSavings)}/year
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                by consolidating duplicate fund categories into the lowest-cost
                option in each category.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fund List */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Fund-wise Breakdown
        </h3>

        {/* Desktop table header */}
        <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 text-xs text-gray-400 font-medium uppercase tracking-wide">
          <div className="col-span-5">Fund</div>
          <div className="col-span-3">Expense Ratio</div>
          <div className="col-span-2 text-right">Annual Cost</div>
          <div className="col-span-2 text-right">Invested</div>
        </div>

        <div className="space-y-2">
          {sortedFunds.map((fund, idx) => {
            const color = getERColor(fund.expenseRatio);
            return (
              <div
                key={idx}
                className="bg-gray-50 rounded-lg p-3 sm:p-4"
              >
                {/* Mobile layout */}
                <div className="sm:hidden">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-medium text-gray-800 pr-2">
                      {fund.name}
                    </p>
                    <span
                      className={`${color.text} text-sm font-bold whitespace-nowrap`}
                    >
                      {fund.expenseRatio.toFixed(2)}%
                    </span>
                  </div>
                  {/* Bar */}
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                    <div
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${getERBarWidth(fund.expenseRatio, maxER)}%`,
                        backgroundColor:
                          fund.expenseRatio > 1.5
                            ? '#dc2626'
                            : fund.expenseRatio > 1.0
                            ? '#f59e0b'
                            : '#16a34a',
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{formatINR(fund.annualCost)}/yr</span>
                    <span>Invested: {formatINR(fund.amount)}</span>
                  </div>
                </div>

                {/* Desktop layout */}
                <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {fund.name}
                    </p>
                  </div>
                  <div className="col-span-3 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-bold ${color.text}`}
                        >
                          {fund.expenseRatio.toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                        <div
                          className="h-1 rounded-full"
                          style={{
                            width: `${getERBarWidth(
                              fund.expenseRatio,
                              maxER
                            )}%`,
                            backgroundColor:
                              fund.expenseRatio > 1.5
                                ? '#dc2626'
                                : fund.expenseRatio > 1.0
                                ? '#f59e0b'
                                : '#16a34a',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-sm text-gray-700 font-medium">
                      {formatINR(fund.annualCost)}
                    </span>
                    <span className="text-xs text-gray-400">/yr</span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-sm text-gray-500">
                      {formatINR(fund.amount)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
