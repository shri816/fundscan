// ============================================================================
// FundScan Recommendations Engine
// Generates brutally honest, direct portfolio recommendations.
// No hedging. No "you might consider." Doctor's diagnosis, not a suggestion.
// ============================================================================

/**
 * Format a number as Indian currency notation: ₹1,23,456
 * Indian system groups the last 3 digits, then every 2 digits after that.
 */
function formatINR(amount) {
  const num = Math.round(amount);
  const isNegative = num < 0;
  const absStr = Math.abs(num).toString();

  if (absStr.length <= 3) {
    return `${isNegative ? '-' : ''}₹${absStr}`;
  }

  // Last 3 digits stay as-is
  const last3 = absStr.slice(-3);
  let remaining = absStr.slice(0, -3);

  // Group remaining digits in pairs from right to left
  const pairs = [];
  while (remaining.length > 2) {
    pairs.unshift(remaining.slice(-2));
    remaining = remaining.slice(0, -2);
  }
  if (remaining.length > 0) {
    pairs.unshift(remaining);
  }

  const formatted = pairs.join(',') + ',' + last3;
  return `${isNegative ? '-' : ''}₹${formatted}`;
}

/**
 * Severity priority for sorting. Lower number = higher priority.
 */
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/**
 * Build a lookup of fund categories from the portfolio.
 * Returns { category: [{ name, expenseRatio, amount }] }
 */
function buildCategoryMap(portfolio) {
  const map = {};
  for (const item of portfolio) {
    if (item.type !== 'fund') continue;
    const { category, shortName, schemeName, expenseRatio } = item.data;
    if (!category) continue;
    const name = shortName || schemeName;
    if (!map[category]) map[category] = [];
    map[category].push({ name, expenseRatio: expenseRatio || 0, amount: item.amount || 0 });
  }
  return map;
}

/**
 * Build a lookup of fund names to their expense ratios.
 */
function buildExpenseMap(portfolio) {
  const map = {};
  for (const item of portfolio) {
    if (item.type !== 'fund') continue;
    const name = item.data.shortName || item.data.schemeName;
    map[name] = item.data.expenseRatio || 0;
  }
  return map;
}

/**
 * Find the cheaper fund between two, using expense ratios.
 * Returns { cheaper, expensive, cheaperER, expensiveER }.
 */
function compareFundCosts(fundA, fundB, expenseMap) {
  const erA = expenseMap[fundA] || 0;
  const erB = expenseMap[fundB] || 0;
  if (erA <= erB) {
    return { cheaper: fundA, expensive: fundB, cheaperER: erA, expensiveER: erB };
  }
  return { cheaper: fundB, expensive: fundA, cheaperER: erB, expensiveER: erA };
}

/**
 * Get total invested amount across the portfolio.
 */
function getTotalInvested(portfolio) {
  return portfolio.reduce((sum, item) => sum + (item.amount || 0), 0);
}

/**
 * Find the fund amount from the portfolio by name.
 */
function getFundAmount(portfolio, fundName) {
  const item = portfolio.find((p) => {
    if (p.type !== 'fund') return false;
    const name = p.data.shortName || p.data.schemeName;
    return name === fundName;
  });
  return item ? item.amount || 0 : 0;
}

/**
 * Check if a fund name looks like a regular (non-direct) plan.
 * Regular plans don't have "Direct" in the name.
 */
function isRegularPlan(fundName) {
  const lower = (fundName || '').toLowerCase();
  return !lower.includes('direct');
}

// ============================================================================
// OVERLAP RULES
// ============================================================================

/**
 * Rule 1 & 2: Flag fund pairs with high overlap.
 * >70% = critical, >50% = warning.
 */
function checkOverlapPairs(analysis, portfolio) {
  const recs = [];
  const expenseMap = buildExpenseMap(portfolio);
  const pairs = analysis.overlapMatrix?.pairs || [];

  for (const pair of pairs) {
    const overlap = pair.overlap;
    if (overlap <= 50) continue;

    const { cheaper, expensive, cheaperER, expensiveER } = compareFundCosts(
      pair.fundA,
      pair.fundB,
      expenseMap
    );

    const overlapPct = Math.round(overlap);

    if (overlap > 70) {
      // CRITICAL: >70% overlap
      const expensiveFundAmount = getFundAmount(portfolio, expensive);
      const annualSavings = expensiveFundAmount * ((expensiveER - cheaperER) / 100);

      recs.push({
        id: `overlap-critical-${pair.fundA}-${pair.fundB}`,
        type: 'overlap',
        severity: 'critical',
        title: `Drop ${expensive}`,
        description: `It's ${overlapPct}% redundant with ${cheaper}, which has a lower expense ratio (${cheaperER}% vs ${expensiveER}%). You're paying more for the same stocks.`,
        action: `Remove ${expensive} and redirect SIP to ${cheaper}.`,
        impact: annualSavings > 0 ? `Save ${formatINR(annualSavings)}/year in expense ratio` : null,
        funds: [expensive, cheaper],
      });
    } else {
      // WARNING: 50-70% overlap
      recs.push({
        id: `overlap-warning-${pair.fundA}-${pair.fundB}`,
        type: 'overlap',
        severity: 'warning',
        title: `High overlap between ${pair.fundA} and ${pair.fundB}`,
        description: `These two funds share ${overlapPct}% of the same stocks. You're getting less diversification than you think.`,
        action: `Review if you need both. Consider keeping only one.`,
        impact: null,
        funds: [pair.fundA, pair.fundB],
      });
    }
  }

  return recs;
}

/**
 * Rule 3: Flag 3+ funds in the same category.
 */
function checkCategoryDuplication(analysis, portfolio) {
  const recs = [];
  const categoryMap = buildCategoryMap(portfolio);

  for (const [category, funds] of Object.entries(categoryMap)) {
    if (funds.length < 3) continue;

    // Find the cheapest fund in this category
    const sorted = [...funds].sort((a, b) => a.expenseRatio - b.expenseRatio);
    const cheapest = sorted[0];
    const others = sorted.slice(1).map((f) => f.name);

    recs.push({
      id: `category-dup-${category}`,
      type: 'overlap',
      severity: 'critical',
      title: `${funds.length} ${category} funds is absurd`,
      description: `You have ${funds.length} ${category} funds. You need 1. Keep ${cheapest.name} (${cheapest.expenseRatio}% ER). The rest are dead weight.`,
      action: `Keep ${cheapest.name}. Exit ${others.join(', ')}.`,
      impact: null,
      funds: funds.map((f) => f.name),
    });
  }

  return recs;
}

/**
 * Rule 4: Multiple index funds tracking the same index.
 * Detect by looking for common index keywords in fund names.
 */
function checkDuplicateIndexFunds(analysis, portfolio) {
  const recs = [];
  const indexPatterns = [
    { pattern: /nifty\s*50(?!\d)/i, label: 'Nifty 50' },
    { pattern: /sensex/i, label: 'Sensex' },
    { pattern: /nifty\s*next\s*50/i, label: 'Nifty Next 50' },
    { pattern: /nifty\s*100/i, label: 'Nifty 100' },
    { pattern: /nifty\s*midcap\s*150/i, label: 'Nifty Midcap 150' },
    { pattern: /nifty\s*smallcap\s*250/i, label: 'Nifty Smallcap 250' },
    { pattern: /s&?p\s*500/i, label: 'S&P 500' },
    { pattern: /nasdaq/i, label: 'NASDAQ' },
  ];

  const funds = portfolio.filter((p) => p.type === 'fund');
  const trackedIndexes = {};

  for (const idx of indexPatterns) {
    trackedIndexes[idx.label] = [];
  }

  for (const fund of funds) {
    const name = fund.data.schemeName || fund.data.shortName || '';
    // Only check funds that look like index funds or ETFs
    const isIndex = /index|etf|passive|tracker/i.test(name);
    if (!isIndex) continue;

    for (const idx of indexPatterns) {
      if (idx.pattern.test(name)) {
        trackedIndexes[idx.label].push({
          name: fund.data.shortName || fund.data.schemeName,
          expenseRatio: fund.data.expenseRatio || 0,
          amount: fund.amount || 0,
        });
      }
    }
  }

  for (const [index, funds] of Object.entries(trackedIndexes)) {
    if (funds.length < 2) continue;

    const sorted = [...funds].sort((a, b) => a.expenseRatio - b.expenseRatio);
    const cheapest = sorted[0];
    const others = sorted.slice(1).map((f) => f.name);

    recs.push({
      id: `dup-index-${index}`,
      type: 'overlap',
      severity: 'critical',
      title: `${funds.length} ${index} index funds. Why?`,
      description: `You own ${funds.length} ${index} index funds. They hold identical stocks. Keep the one with lowest expense ratio: ${cheapest.name} (${cheapest.expenseRatio}%).`,
      action: `Keep ${cheapest.name}. Redeem ${others.join(', ')}.`,
      impact: null,
      funds: funds.map((f) => f.name),
    });
  }

  return recs;
}

// ============================================================================
// CONCENTRATION RULES
// ============================================================================

/**
 * Rule 5: Single stock > 10% of portfolio.
 */
function checkSingleStockConcentration(analysis) {
  const recs = [];
  const details = analysis.stockConcentration?.details || [];

  for (const stock of details) {
    if (stock.totalWeight > 10) {
      recs.push({
        id: `stock-conc-${stock.stock || stock.name}`,
        type: 'concentration',
        severity: 'warning',
        title: `${stock.stock || stock.name} is ${Math.round(stock.totalWeight * 10) / 10}% of your portfolio`,
        description: `Your ${stock.stock || stock.name} exposure is ${Math.round(stock.totalWeight * 10) / 10}%. That's a concentrated bet. If this stock tanks, your entire portfolio bleeds.`,
        action: `Reduce exposure to ${stock.stock || stock.name} or increase allocation to other holdings.`,
        impact: null,
        funds: stock.sources ? stock.sources.map((s) => s.name) : [],
      });
    }
  }

  return recs;
}

/**
 * Rule 6: Top 5 stocks > 45% of portfolio.
 */
function checkTop5Concentration(analysis) {
  const recs = [];
  const top5Weight = analysis.stockConcentration?.top5?.combinedWeight;

  if (top5Weight && top5Weight > 45) {
    const top5Stocks = (analysis.stockConcentration?.details || [])
      .slice(0, 5)
      .map((s) => s.stock || s.name);

    recs.push({
      id: 'top5-concentration',
      type: 'concentration',
      severity: 'critical',
      title: `${Math.round(top5Weight)}% of your portfolio is in 5 stocks`,
      description: `${Math.round(top5Weight)}% of your portfolio is in just 5 stocks: ${top5Stocks.join(', ')}. That's not diversification, that's a stock portfolio wearing a mutual fund costume.`,
      action: `Spread your investments across more uncorrelated holdings.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

/**
 * Rule 7: Direct stock also held through funds.
 */
function checkDirectAndFundOverlap(analysis, portfolio) {
  const recs = [];

  // Get direct stock holdings
  const directStocks = portfolio
    .filter((p) => p.type === 'stock')
    .map((p) => ({
      name: p.data.name || p.data.ticker,
      ticker: p.data.ticker,
    }));

  if (directStocks.length === 0) return recs;

  const consolidated = analysis.consolidatedHoldings || [];

  for (const directStock of directStocks) {
    // Find this stock in consolidated holdings
    const match = consolidated.find(
      (h) =>
        h.stock === directStock.name ||
        h.stock === directStock.ticker ||
        (h.isin && directStock.ticker && h.isin === directStock.ticker)
    );

    if (!match || !match.sources || match.sources.length <= 1) continue;

    // It appears in funds too
    const fundSources = match.sources.filter(
      (s) => s.name !== directStock.name && s.name !== directStock.ticker
    );

    if (fundSources.length === 0) continue;

    recs.push({
      id: `direct-fund-overlap-${directStock.name || directStock.ticker}`,
      type: 'concentration',
      severity: 'warning',
      title: `${directStock.name || directStock.ticker}: double exposure`,
      description: `You hold ${directStock.name || directStock.ticker} directly AND through ${fundSources.length} fund${fundSources.length > 1 ? 's' : ''} (${fundSources.map((s) => s.name).join(', ')}). Total exposure is ${Math.round(match.totalWeight * 10) / 10}%.`,
      action: `Decide: either hold the stock directly or through funds. Not both.`,
      impact: null,
      funds: [directStock.name || directStock.ticker, ...fundSources.map((s) => s.name)],
    });
  }

  return recs;
}

/**
 * Rule 8 & 9: Sector concentration.
 * >40% = warning, >55% = critical.
 */
function checkSectorConcentration(analysis) {
  const recs = [];
  const sectors = analysis.sectorConcentration || [];

  for (const sector of sectors) {
    const weight = Math.round(sector.weight * 10) / 10;

    if (sector.weight > 55) {
      recs.push({
        id: `sector-critical-${sector.sector}`,
        type: 'concentration',
        severity: 'critical',
        title: `${weight}% in ${sector.sector}. That's a sector bet.`,
        description: `${weight}% of your money is in ${sector.sector}. If this sector corrects, your portfolio gets hammered. This isn't diversification.`,
        action: `Reduce ${sector.sector} exposure by switching to funds with different sector tilts.`,
        impact: null,
        funds: [],
      });
    } else if (sector.weight > 40) {
      recs.push({
        id: `sector-warning-${sector.sector}`,
        type: 'concentration',
        severity: 'warning',
        title: `${weight}% in ${sector.sector}`,
        description: `${weight}% of your money is in ${sector.sector}. That's getting heavy. One bad quarter for this sector and you'll feel it.`,
        action: `Consider rebalancing toward sectors with lower allocation.`,
        impact: null,
        funds: [],
      });
    }
  }

  return recs;
}

// ============================================================================
// EXPENSE RULES
// ============================================================================

/**
 * Rule 10 & 11: High weighted expense ratio.
 * >1.5% = warning, >2% = critical.
 */
function checkExpenseRatio(analysis) {
  const recs = [];
  const expense = analysis.expenseAnalysis;
  if (!expense) return recs;

  const wer = expense.weightedExpenseRatio;
  const annualCost = expense.totalAnnualCost;

  if (wer > 2) {
    recs.push({
      id: 'expense-critical',
      type: 'expense',
      severity: 'critical',
      title: `Your expense ratio is ${wer.toFixed(2)}%. That's robbery.`,
      description: `You're bleeding ${formatINR(annualCost)}/year in fund expenses alone. A ${wer.toFixed(2)}% expense ratio is eating your compounding returns alive.`,
      action: `Switch to direct plans and low-cost index funds immediately.`,
      impact: `Reduce expenses to save ${formatINR(annualCost * 0.5)}/year or more`,
      funds: [],
    });
  } else if (wer > 1.5) {
    recs.push({
      id: 'expense-warning',
      type: 'expense',
      severity: 'warning',
      title: `Expense ratio at ${wer.toFixed(2)}%. Room to cut.`,
      description: `You're paying ${formatINR(annualCost)}/year in fund expenses. That's on the higher side. Every 0.5% saved compounds over decades.`,
      action: `Look for cheaper alternatives -- index funds or direct plan equivalents.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

/**
 * Rule 12: Regular plan funds that could be switched to direct.
 */
function checkRegularVsDirect(analysis, portfolio) {
  const recs = [];
  const funds = portfolio.filter((p) => p.type === 'fund');

  for (const fund of funds) {
    const name = fund.data.shortName || fund.data.schemeName || '';
    if (!isRegularPlan(name)) continue;

    // Estimate direct plan savings: regular plans typically cost 0.5-1% more
    const estimatedSaving = 0.5; // conservative estimate
    const amount = fund.amount || 0;
    const annualSavings = amount * (estimatedSaving / 100);

    if (annualSavings < 100) continue; // not worth flagging for tiny amounts

    recs.push({
      id: `regular-to-direct-${name}`,
      type: 'expense',
      severity: 'info',
      title: `Switch ${name} to Direct plan`,
      description: `${name} appears to be a Regular plan. Direct plans have lower expense ratios (no distributor commission). Over 10 years, this difference compounds significantly.`,
      action: `Switch ${name} to its Direct plan equivalent.`,
      impact: `Save approximately ${formatINR(annualSavings)}/year`,
      funds: [name],
    });
  }

  return recs;
}

/**
 * Rule 13: Potential savings from consolidation.
 */
function checkConsolidationSavings(analysis) {
  const recs = [];
  const savings = analysis.expenseAnalysis?.potentialSavings;

  if (savings && savings > 0) {
    recs.push({
      id: 'consolidation-savings',
      type: 'expense',
      severity: 'info',
      title: `${formatINR(savings)}/year in potential savings`,
      description: `By consolidating overlapping funds and switching to cheaper alternatives, you could save ${formatINR(savings)}/year. That's free money you're leaving on the table.`,
      action: `Consolidate redundant funds and pick the cheapest option in each category.`,
      impact: `Save ${formatINR(savings)}/year`,
      funds: [],
    });
  }

  return recs;
}

// ============================================================================
// DIVERSIFICATION RULES
// ============================================================================

/**
 * Rule 14: No international exposure.
 */
function checkInternationalExposure(analysis, portfolio) {
  const recs = [];

  // Check if any fund has "international", "global", "US", "S&P 500", "NASDAQ" in name
  const hasIntl = portfolio.some((p) => {
    if (p.type !== 'fund') return false;
    const name = (p.data.schemeName || p.data.shortName || '').toLowerCase();
    const category = (p.data.category || '').toLowerCase();
    return (
      /international|global|us\s|s&?p\s*500|nasdaq|world|overseas|foreign/i.test(name) ||
      /international|global/i.test(category)
    );
  });

  if (!hasIntl) {
    recs.push({
      id: 'no-international',
      type: 'diversification',
      severity: 'info',
      title: 'Zero international exposure',
      description: `Your portfolio has zero international exposure. India is ~3% of global market cap. You're betting everything on one country's economy.`,
      action: `Add an S&P 500 or NASDAQ index fund for geographic diversification.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

/**
 * Rule 15: No mid/small cap exposure.
 */
function checkMarketCapDiversity(analysis, portfolio) {
  const recs = [];

  const categories = portfolio
    .filter((p) => p.type === 'fund')
    .map((p) => (p.data.category || '').toLowerCase());

  const hasLargeCap = categories.some(
    (c) => c.includes('large') || c.includes('bluechip') || c.includes('index')
  );
  const hasMidCap = categories.some((c) => c.includes('mid'));
  const hasSmallCap = categories.some((c) => c.includes('small'));

  if (hasLargeCap && !hasMidCap && !hasSmallCap) {
    recs.push({
      id: 'no-midsmall',
      type: 'diversification',
      severity: 'info',
      title: '100% large cap. No growth kicker.',
      description: `Your portfolio is 100% large cap. Large caps are stable but slow growers. Mid and small caps historically outperform over long periods.`,
      action: `Consider adding a mid-cap or flexi-cap fund for growth potential.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

/**
 * Rule 16: No debt/hybrid allocation for large portfolios (>10L).
 */
function checkDebtAllocation(analysis, portfolio) {
  const recs = [];
  const totalInvested = getTotalInvested(portfolio);

  // Only flag if portfolio is > 10 lakh
  if (totalInvested <= 1000000) return recs;

  const categories = portfolio
    .filter((p) => p.type === 'fund')
    .map((p) => (p.data.category || '').toLowerCase());

  const hasDebt = categories.some(
    (c) =>
      c.includes('debt') ||
      c.includes('bond') ||
      c.includes('liquid') ||
      c.includes('gilt') ||
      c.includes('money market') ||
      c.includes('overnight') ||
      c.includes('hybrid') ||
      c.includes('balanced') ||
      c.includes('conservative')
  );

  if (!hasDebt) {
    recs.push({
      id: 'no-debt',
      type: 'diversification',
      severity: 'info',
      title: `${formatINR(totalInvested)} with zero debt allocation`,
      description: `You have ${formatINR(totalInvested)} invested with no debt or hybrid funds. At this portfolio size, a 100% equity allocation means wild swings during corrections.`,
      action: `Add debt funds for stability. Even 10-20% in debt smooths out the ride.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

/**
 * Rule 17: Too few holdings.
 */
function checkMinimumDiversification(analysis, portfolio) {
  const recs = [];
  const totalItems = portfolio.length;

  if (totalItems < 3) {
    recs.push({
      id: 'too-few-holdings',
      type: 'diversification',
      severity: 'info',
      title: `Only ${totalItems} holding${totalItems === 1 ? '' : 's'}. That's thin.`,
      description: `Your portfolio is concentrated in just ${totalItems} holding${totalItems === 1 ? '' : 's'}. One bad pick and there's nowhere to hide.`,
      action: `Add more holdings to spread risk. Aim for at least 3-5 well-chosen funds.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

// ============================================================================
// STRUCTURE RULES
// ============================================================================

/**
 * Rule 18 & 19: Too many funds.
 * >8 = warning, >12 = critical.
 */
function checkFundCount(analysis, portfolio) {
  const recs = [];
  const fundCount = portfolio.filter((p) => p.type === 'fund').length;

  if (fundCount > 12) {
    recs.push({
      id: 'too-many-funds-critical',
      type: 'structure',
      severity: 'critical',
      title: `${fundCount} funds. That's a mutual fund collection, not a portfolio.`,
      description: `You have ${fundCount} funds. That's too many to track, too many overlaps, and guaranteed dilution of returns. Most investors need 3-5 funds.`,
      action: `Ruthlessly cut to 4-6 funds. Keep the cheapest in each category, dump the rest.`,
      impact: null,
      funds: [],
    });
  } else if (fundCount > 8) {
    recs.push({
      id: 'too-many-funds-warning',
      type: 'structure',
      severity: 'warning',
      title: `${fundCount} funds. That's more than you need.`,
      description: `You have ${fundCount} funds. Beyond 5-6, you're just adding complexity without meaningful diversification. More funds = more overlap = diluted returns.`,
      action: `Trim to 4-6 well-chosen funds. Quality over quantity.`,
      impact: null,
      funds: [],
    });
  }

  return recs;
}

// ============================================================================
// MAIN ENGINE
// ============================================================================

/**
 * Generate all recommendations for a portfolio.
 *
 * @param {Object} analysis - The full analysis result from generateFullAnalysis()
 * @param {Array} portfolio - The raw portfolio array
 * @returns {Array} Sorted array of recommendation objects
 */
export function generateRecommendations(analysis, portfolio) {
  if (!analysis || !portfolio || portfolio.length === 0) {
    return [];
  }

  const allRecs = [
    // Overlap rules (1-4)
    ...checkOverlapPairs(analysis, portfolio),
    ...checkCategoryDuplication(analysis, portfolio),
    ...checkDuplicateIndexFunds(analysis, portfolio),

    // Concentration rules (5-9)
    ...checkSingleStockConcentration(analysis),
    ...checkTop5Concentration(analysis),
    ...checkDirectAndFundOverlap(analysis, portfolio),
    ...checkSectorConcentration(analysis),

    // Expense rules (10-13)
    ...checkExpenseRatio(analysis),
    ...checkRegularVsDirect(analysis, portfolio),
    ...checkConsolidationSavings(analysis),

    // Diversification rules (14-17)
    ...checkInternationalExposure(analysis, portfolio),
    ...checkMarketCapDiversity(analysis, portfolio),
    ...checkDebtAllocation(analysis, portfolio),
    ...checkMinimumDiversification(analysis, portfolio),

    // Structure rules (18-19)
    ...checkFundCount(analysis, portfolio),
  ];

  // Sort: critical first, then warning, then info
  allRecs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return allRecs;
}

// Export helper for use in UI components
export { formatINR };
