// FundScan - Core Analysis Engine
// All computation runs client-side. No external dependencies.

/**
 * Calculate pairwise overlap between two funds based on common stock holdings.
 * Overlap = sum of min(weightA[stock], weightB[stock]) for each common stock matched by ISIN.
 *
 * @param {Object} fundA - Fund object with holdings array
 * @param {Object} fundB - Fund object with holdings array
 * @returns {number} Overlap percentage (0-100)
 */
export function calculatePairwiseOverlap(fundA, fundB) {
  if (!fundA?.holdings?.length || !fundB?.holdings?.length) {
    return 0;
  }

  const holdingsB = new Map();
  for (const h of fundB.holdings) {
    if (h.isin) {
      holdingsB.set(h.isin, h.weight);
    }
  }

  let overlap = 0;
  for (const h of fundA.holdings) {
    if (h.isin && holdingsB.has(h.isin)) {
      overlap += Math.min(h.weight, holdingsB.get(h.isin));
    }
  }

  return Math.round(overlap * 100) / 100;
}

/**
 * Build a matrix of pairwise overlaps for all fund items in the portfolio.
 *
 * @param {Array} portfolio - Array of portfolio items
 * @returns {{ matrix: number[][], labels: string[], pairs: Array }}
 */
export function calculateOverlapMatrix(portfolio) {
  const funds = portfolio.filter(
    (item) => item.type === 'fund' && item.data?.holdings?.length
  );

  const labels = funds.map(
    (f) => f.data.shortName || f.data.schemeName || 'Unknown Fund'
  );

  const n = funds.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  const pairs = [];

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 100; // a fund has 100% overlap with itself
    for (let j = i + 1; j < n; j++) {
      const overlap = calculatePairwiseOverlap(funds[i].data, funds[j].data);
      matrix[i][j] = overlap;
      matrix[j][i] = overlap;

      // Find common stocks for this pair
      const holdingsB = new Map();
      for (const h of funds[j].data.holdings) {
        if (h.isin) {
          holdingsB.set(h.isin, h);
        }
      }

      const commonStocks = [];
      for (const h of funds[i].data.holdings) {
        if (h.isin && holdingsB.has(h.isin)) {
          const hB = holdingsB.get(h.isin);
          commonStocks.push({
            stock: h.stock,
            isin: h.isin,
            weightA: h.weight,
            weightB: hB.weight,
            minWeight: Math.min(h.weight, hB.weight),
          });
        }
      }

      commonStocks.sort((a, b) => b.minWeight - a.minWeight);

      pairs.push({
        fundA: labels[i],
        fundB: labels[j],
        overlap,
        commonStocks,
      });
    }
  }

  pairs.sort((a, b) => b.overlap - a.overlap);

  return { matrix, labels, pairs };
}

/**
 * Merge all holdings across funds and direct stocks into a single consolidated view.
 *
 * For funds: effective weight = (fund_amount / total_portfolio_value) * stock_weight_in_fund / 100
 * For direct stocks: effective weight = (stock_amount / total_portfolio_value) * 100
 *
 * @param {Array} portfolio - Array of portfolio items
 * @returns {Array} Consolidated holdings sorted by totalWeight descending
 */
export function calculateConsolidatedHoldings(portfolio) {
  const totalValue = portfolio.reduce((sum, item) => sum + (item.amount || 0), 0);

  if (totalValue === 0) {
    return [];
  }

  // Map from ISIN to aggregated holding data
  const consolidated = new Map();

  for (const item of portfolio) {
    if (item.type === 'fund' && item.data?.holdings?.length) {
      const fundAllocationPct = (item.amount / totalValue) * 100;
      const fundName = item.data.shortName || item.data.schemeName || 'Unknown Fund';

      for (const h of item.data.holdings) {
        if (!h.isin) continue;

        const effectiveWeight = (fundAllocationPct * h.weight) / 100;

        if (consolidated.has(h.isin)) {
          const existing = consolidated.get(h.isin);
          existing.totalWeight += effectiveWeight;
          existing.sources.push({
            name: fundName,
            contribution: Math.round(effectiveWeight * 100) / 100,
          });
        } else {
          consolidated.set(h.isin, {
            stock: h.stock,
            isin: h.isin,
            sector: h.sector || 'Unknown',
            totalWeight: effectiveWeight,
            sources: [
              {
                name: fundName,
                contribution: Math.round(effectiveWeight * 100) / 100,
              },
            ],
          });
        }
      }
    } else if (item.type === 'stock' && item.data) {
      const effectiveWeight = (item.amount / totalValue) * 100;
      const isin = item.data.isin;
      const stockName = item.data.name || item.data.ticker || 'Unknown Stock';

      if (!isin) continue;

      if (consolidated.has(isin)) {
        const existing = consolidated.get(isin);
        existing.totalWeight += effectiveWeight;
        existing.sources.push({
          name: `Direct: ${stockName}`,
          contribution: Math.round(effectiveWeight * 100) / 100,
        });
      } else {
        consolidated.set(isin, {
          stock: stockName,
          isin,
          sector: item.data.sector || 'Unknown',
          totalWeight: effectiveWeight,
          sources: [
            {
              name: `Direct: ${stockName}`,
              contribution: Math.round(effectiveWeight * 100) / 100,
            },
          ],
        });
      }
    }
  }

  const result = Array.from(consolidated.values());

  // Round totalWeight for cleaner output
  for (const h of result) {
    h.totalWeight = Math.round(h.totalWeight * 100) / 100;
  }

  result.sort((a, b) => b.totalWeight - a.totalWeight);
  return result;
}

/**
 * Analyze stock-level concentration risk.
 *
 * @param {Array} consolidatedHoldings - Output of calculateConsolidatedHoldings
 * @returns {{ top5: Object, top10: Object, singleStockRisk: Array, details: Array }}
 */
export function calculateStockConcentration(consolidatedHoldings) {
  // Already sorted by totalWeight desc from calculateConsolidatedHoldings
  const sorted = [...consolidatedHoldings];

  const top5Stocks = sorted.slice(0, 5);
  const top10Stocks = sorted.slice(0, 10);

  const top5Weight = top5Stocks.reduce((sum, h) => sum + h.totalWeight, 0);
  const top10Weight = top10Stocks.reduce((sum, h) => sum + h.totalWeight, 0);

  const singleStockRisk = sorted.filter((h) => h.totalWeight > 10);

  return {
    top5: {
      stocks: top5Stocks.map((h) => ({
        stock: h.stock,
        isin: h.isin,
        weight: h.totalWeight,
      })),
      combinedWeight: Math.round(top5Weight * 100) / 100,
    },
    top10: {
      stocks: top10Stocks.map((h) => ({
        stock: h.stock,
        isin: h.isin,
        weight: h.totalWeight,
      })),
      combinedWeight: Math.round(top10Weight * 100) / 100,
    },
    singleStockRisk: singleStockRisk.map((h) => ({
      stock: h.stock,
      isin: h.isin,
      weight: h.totalWeight,
    })),
    details: sorted,
  };
}

/**
 * Group consolidated holdings by sector and sum weights.
 *
 * @param {Array} consolidatedHoldings - Output of calculateConsolidatedHoldings
 * @returns {Array} Sectors sorted by weight descending
 */
export function calculateSectorConcentration(consolidatedHoldings) {
  const sectorMap = new Map();

  for (const h of consolidatedHoldings) {
    const sector = h.sector || 'Unknown';
    if (sectorMap.has(sector)) {
      const existing = sectorMap.get(sector);
      existing.weight += h.totalWeight;
      existing.stocks += 1;
    } else {
      sectorMap.set(sector, {
        sector,
        weight: h.totalWeight,
        stocks: 1,
      });
    }
  }

  const result = Array.from(sectorMap.values());

  for (const s of result) {
    s.weight = Math.round(s.weight * 100) / 100;
  }

  result.sort((a, b) => b.weight - a.weight);
  return result;
}

/**
 * Analyze expense ratios across the portfolio.
 *
 * @param {Array} portfolio - Array of portfolio items
 * @returns {{ weightedExpenseRatio: number, totalAnnualCost: number, fundCosts: Array, potentialSavings: number }}
 */
export function calculateExpenseAnalysis(portfolio) {
  const totalValue = portfolio.reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalFundValue = portfolio
    .filter((item) => item.type === 'fund')
    .reduce((sum, item) => sum + (item.amount || 0), 0);

  if (totalValue === 0) {
    return {
      weightedExpenseRatio: 0,
      totalAnnualCost: 0,
      fundCosts: [],
      potentialSavings: 0,
    };
  }

  const fundCosts = [];
  let weightedERSum = 0;

  // Group funds by category to find cheapest alternatives
  const categoryFunds = new Map();

  for (const item of portfolio) {
    if (item.type !== 'fund') continue;

    const er = item.data?.expenseRatio || 0;
    const name = item.data?.shortName || item.data?.schemeName || 'Unknown Fund';
    const category = item.data?.category || 'Unknown';
    const amount = item.amount || 0;
    const annualCost = Math.round((amount * er) / 100);

    // Weight by proportion of total portfolio (including stocks) for overall metric
    weightedERSum += (amount / totalValue) * er;

    fundCosts.push({
      name,
      expenseRatio: er,
      annualCost,
      amount,
      category,
    });

    if (!categoryFunds.has(category)) {
      categoryFunds.set(category, []);
    }
    categoryFunds.get(category).push({ name, expenseRatio: er, amount });
  }

  // Calculate potential savings: for each category, compute savings if all funds
  // were replaced by the cheapest fund in that category
  let potentialSavings = 0;
  for (const [, funds] of categoryFunds) {
    if (funds.length < 2) continue;

    const cheapestER = Math.min(...funds.map((f) => f.expenseRatio));

    for (const fund of funds) {
      if (fund.expenseRatio > cheapestER) {
        const saving = (fund.amount * (fund.expenseRatio - cheapestER)) / 100;
        potentialSavings += saving;
      }
    }
  }

  const weightedExpenseRatio = Math.round(weightedERSum * 100) / 100;
  const totalAnnualCost = Math.round((totalFundValue * weightedERSum) / 100);

  return {
    weightedExpenseRatio,
    totalAnnualCost: Math.round(
      fundCosts.reduce((sum, f) => sum + f.annualCost, 0)
    ),
    fundCosts,
    potentialSavings: Math.round(potentialSavings),
  };
}

/**
 * Calculate an overall portfolio health score (0-100) with traffic light rating.
 *
 * Penalty system:
 * - Overlap: avg pairwise overlap > 50% = heavy penalty, scaled linearly
 * - Concentration: top 5 stocks > 40% = penalty
 * - Sector: any sector > 50% = penalty
 * - Expense: weighted ER > 1.5% = penalty
 *
 * @param {Object} overlapData - Output of calculateOverlapMatrix
 * @param {Object} concentrationData - Output of calculateStockConcentration
 * @param {Array} sectorData - Output of calculateSectorConcentration
 * @param {Object} expenseData - Output of calculateExpenseAnalysis
 * @returns {{ score: number, color: string, label: string }}
 */
export function calculatePortfolioScore(
  overlapData,
  concentrationData,
  sectorData,
  expenseData
) {
  let penalty = 0;

  // --- Overlap penalty (max 30 points) ---
  if (overlapData.pairs.length > 0) {
    const avgOverlap =
      overlapData.pairs.reduce((sum, p) => sum + p.overlap, 0) /
      overlapData.pairs.length;

    if (avgOverlap > 50) {
      // Heavy penalty: scale from 15 to 30 as overlap goes from 50 to 100
      penalty += 15 + ((avgOverlap - 50) / 50) * 15;
    } else if (avgOverlap > 30) {
      // Moderate penalty: scale from 0 to 15 as overlap goes from 30 to 50
      penalty += ((avgOverlap - 30) / 20) * 15;
    }
  }

  // --- Concentration penalty (max 25 points) ---
  const top5Weight = concentrationData.top5.combinedWeight;
  if (top5Weight > 40) {
    // Scale from 0 to 25 as top5 weight goes from 40 to 80
    penalty += Math.min(25, ((top5Weight - 40) / 40) * 25);
  }

  // Additional penalty for single stock risk
  if (concentrationData.singleStockRisk.length > 0) {
    penalty += Math.min(10, concentrationData.singleStockRisk.length * 3);
  }

  // --- Sector penalty (max 20 points) ---
  if (sectorData.length > 0) {
    const maxSectorWeight = sectorData[0].weight;
    if (maxSectorWeight > 50) {
      // Scale from 0 to 20 as max sector weight goes from 50 to 80
      penalty += Math.min(20, ((maxSectorWeight - 50) / 30) * 20);
    }
  }

  // --- Expense penalty (max 15 points) ---
  const er = expenseData.weightedExpenseRatio;
  if (er > 1.5) {
    // Scale from 0 to 15 as ER goes from 1.5 to 3.0
    penalty += Math.min(15, ((er - 1.5) / 1.5) * 15);
  } else if (er > 1.0) {
    // Mild penalty
    penalty += ((er - 1.0) / 0.5) * 5;
  }

  const score = Math.round(Math.max(0, Math.min(100, 100 - penalty)));

  let color;
  let label;
  if (score >= 70) {
    color = 'green';
    label = 'Healthy';
  } else if (score >= 40) {
    color = 'yellow';
    label = 'Needs Work';
  } else {
    color = 'red';
    label = 'Critical';
  }

  return { score, color, label };
}

/**
 * Run the full analysis pipeline and return all results.
 *
 * @param {Array} portfolio - Array of portfolio items
 * @returns {Object} Complete analysis results
 */
export function generateFullAnalysis(portfolio) {
  if (!portfolio || portfolio.length === 0) {
    return {
      consolidatedHoldings: [],
      overlapMatrix: { matrix: [], labels: [], pairs: [] },
      stockConcentration: {
        top5: { stocks: [], combinedWeight: 0 },
        top10: { stocks: [], combinedWeight: 0 },
        singleStockRisk: [],
        details: [],
      },
      sectorConcentration: [],
      expenseAnalysis: {
        weightedExpenseRatio: 0,
        totalAnnualCost: 0,
        fundCosts: [],
        potentialSavings: 0,
      },
      portfolioScore: { score: 100, color: 'green', label: 'Healthy' },
      assetAllocation: { funds: 0, stocks: 0, total: 0 },
      summary: {
        totalFunds: 0,
        totalStocks: 0,
        totalInvested: 0,
        avgOverlap: 0,
      },
    };
  }

  const totalValue = portfolio.reduce((sum, item) => sum + (item.amount || 0), 0);

  const fundItems = portfolio.filter((item) => item.type === 'fund');
  const stockItems = portfolio.filter((item) => item.type === 'stock');

  const fundTotal = fundItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const stockTotal = stockItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  // Core calculations
  const consolidatedHoldings = calculateConsolidatedHoldings(portfolio);
  const overlapMatrix = calculateOverlapMatrix(portfolio);
  const stockConcentration = calculateStockConcentration(consolidatedHoldings);
  const sectorConcentration = calculateSectorConcentration(consolidatedHoldings);
  const expenseAnalysis = calculateExpenseAnalysis(portfolio);

  // Derived score
  const portfolioScore = calculatePortfolioScore(
    overlapMatrix,
    stockConcentration,
    sectorConcentration,
    expenseAnalysis
  );

  // Average overlap across all pairs
  const avgOverlap =
    overlapMatrix.pairs.length > 0
      ? Math.round(
          (overlapMatrix.pairs.reduce((sum, p) => sum + p.overlap, 0) /
            overlapMatrix.pairs.length) *
            100
        ) / 100
      : 0;

  return {
    consolidatedHoldings,
    overlapMatrix,
    stockConcentration,
    sectorConcentration,
    expenseAnalysis,
    portfolioScore,
    assetAllocation: {
      funds: totalValue > 0 ? Math.round((fundTotal / totalValue) * 10000) / 100 : 0,
      stocks:
        totalValue > 0 ? Math.round((stockTotal / totalValue) * 10000) / 100 : 0,
      total: totalValue,
    },
    summary: {
      totalFunds: fundItems.length,
      totalStocks: stockItems.length,
      totalInvested: totalValue,
      avgOverlap,
    },
  };
}
