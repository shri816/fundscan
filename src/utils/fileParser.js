import * as XLSX from 'xlsx';
import { fundsDatabase, stocksDatabase } from '../data/funds';

/**
 * Parse an uploaded file (XLSX, XLS, or CSV) and extract portfolio items.
 * Tries to match fund/stock names against our database using fuzzy matching.
 *
 * Expected file format: rows with at least a fund/scheme name column and an amount column.
 * The parser is flexible - it tries to detect the right columns automatically.
 */
export async function parsePortfolioFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw new Error(`Unsupported file type: .${ext}. Upload .xlsx, .xls, or .csv files.`);
  }

  const data = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(data, { type: 'array' });

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    throw new Error('The file appears to be empty. No data rows found.');
  }

  // Detect columns
  const columns = Object.keys(rows[0]);
  const nameCol = detectNameColumn(columns);
  const amountCol = detectAmountColumn(columns, rows, nameCol);

  if (!nameCol) {
    throw new Error(
      `Could not find a fund/scheme name column. Found columns: ${columns.join(', ')}. ` +
      `Expected a column like "Scheme Name", "Fund Name", "Fund", "Name", etc.`
    );
  }

  console.log('[FundScan] All columns:', columns);
  console.log('[FundScan] Name column:', nameCol);
  console.log('[FundScan] Amount column:', amountCol);
  // Log first 3 rows raw data for debugging
  console.log('[FundScan] Sample rows:', rows.slice(0, 3).map(r => {
    const obj = {};
    for (const col of columns) obj[col] = r[col];
    return obj;
  }));
  if (!amountCol) {
    console.warn('[FundScan] No amount column detected. All amounts will default to 0. Columns found:', columns);
  }

  // Parse rows into portfolio items
  const results = [];
  const unmatched = [];

  for (const row of rows) {
    const rawName = String(row[nameCol] || '').trim();
    if (!rawName) continue;

    const rawAmount = amountCol ? parseAmount(row[amountCol]) : 0;
    if (amountCol) {
      console.log(`[FundScan] Row "${rawName}" → raw="${row[amountCol]}" → parsed=${rawAmount}`);
    }

    // Try to match against our fund database
    const fundMatch = findBestFundMatch(rawName);
    if (fundMatch) {
      // Check if already added
      const alreadyAdded = results.some(
        (r) => r.type === 'fund' && r.data.schemeCode === fundMatch.schemeCode
      );
      if (!alreadyAdded) {
        results.push({
          type: 'fund',
          data: fundMatch,
          amount: rawAmount,
          originalName: rawName,
        });
      } else {
        // Add amount to existing entry
        const existing = results.find(
          (r) => r.type === 'fund' && r.data.schemeCode === fundMatch.schemeCode
        );
        if (existing) existing.amount += rawAmount;
      }
      continue;
    }

    // Try to match against stock database
    const stockMatch = findBestStockMatch(rawName);
    if (stockMatch) {
      const alreadyAdded = results.some(
        (r) => r.type === 'stock' && r.data.isin === stockMatch.isin
      );
      if (!alreadyAdded) {
        results.push({
          type: 'stock',
          data: stockMatch,
          amount: rawAmount,
          originalName: rawName,
        });
      } else {
        const existing = results.find(
          (r) => r.type === 'stock' && r.data.isin === stockMatch.isin
        );
        if (existing) existing.amount += rawAmount;
      }
      continue;
    }

    // No match found
    unmatched.push(rawName);
  }

  return { results, unmatched, totalRows: rows.length, detectedColumns: { name: nameCol, amount: amountCol, all: columns } };
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Detect which column contains fund/scheme names.
 */
function detectNameColumn(columns) {
  const namePatterns = [
    /scheme\s*name/i,
    /fund\s*name/i,
    /mutual\s*fund/i,
    /scheme/i,
    /fund/i,
    /name/i,
    /stock/i,
    /security/i,
    /instrument/i,
    /scrip/i,
    /holding/i,
  ];

  for (const pattern of namePatterns) {
    const match = columns.find((col) => pattern.test(col));
    if (match) return match;
  }

  // Fallback: first column
  return columns[0];
}

/**
 * Detect which column contains amounts.
 * Simple approach: find the first column to the right of the name column that has numeric data.
 * Falls back to pattern matching if positional detection fails.
 */
function detectAmountColumn(columns, rows, nameCol) {
  if (!rows || rows.length === 0) return null;

  const nameIdx = columns.indexOf(nameCol);
  const sampleSize = Math.min(rows.length, 10);

  // Strategy 1: Starting from the column right after the name column, find the first
  // column where most rows have a positive number. This is the simplest, most reliable approach.
  if (nameIdx >= 0) {
    for (let i = nameIdx + 1; i < columns.length; i++) {
      const col = columns[i];
      let numericCount = 0;
      for (let r = 0; r < sampleSize; r++) {
        const val = rows[r][col];
        const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[₹$,Rs.INR\s,]/gi, ''));
        if (!isNaN(num) && num > 0) numericCount++;
      }
      if (numericCount >= sampleSize * 0.4) return col;
    }
  }

  // Strategy 2: Check ALL columns (not just after name) for numeric data, skip the name column
  for (const col of columns) {
    if (col === nameCol) continue;
    let numericCount = 0;
    for (let r = 0; r < sampleSize; r++) {
      const val = rows[r][col];
      const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[₹$,Rs.INR\s,]/gi, ''));
      if (!isNaN(num) && num > 0) numericCount++;
    }
    if (numericCount >= sampleSize * 0.4) return col;
  }

  return null;
}

/**
 * Parse a raw value into a number (handles commas, currency symbols, Rs., parentheses, etc.)
 */
function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Math.max(0, Math.round(raw));
  let str = String(raw).trim();
  // Remove currency symbols, "Rs.", "INR", commas, spaces
  str = str.replace(/₹|Rs\.?|INR|USD|\$|,|\s/gi, '').trim();
  // Handle parenthesized negatives like (1234) → treat as 0
  if (str.startsWith('(') && str.endsWith(')')) return 0;
  // Handle trailing minus
  if (str.endsWith('-')) str = '-' + str.slice(0, -1);
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.max(0, Math.round(num));
}

/**
 * Fuzzy match a raw name against our funds database.
 * Uses multiple strategies: exact substring, keyword matching, acronym matching.
 */
function findBestFundMatch(rawName) {
  const input = rawName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!input || input.length < 3) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const fund of fundsDatabase) {
    const targets = [
      fund.schemeName.toLowerCase(),
      fund.shortName.toLowerCase(),
      fund.fundHouse.toLowerCase(),
    ];

    let score = 0;

    for (const target of targets) {
      const normalizedTarget = target.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

      // Exact match
      if (normalizedTarget === input) {
        score = Math.max(score, 100);
        continue;
      }

      // Input contains the short name
      if (input.includes(fund.shortName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim())) {
        score = Math.max(score, 90);
        continue;
      }

      // Short name contains the input
      if (fund.shortName.toLowerCase().includes(input)) {
        score = Math.max(score, 85);
        continue;
      }

      // Scheme name contains the input
      if (normalizedTarget.includes(input)) {
        score = Math.max(score, 80);
        continue;
      }

      // Input contains the scheme name
      if (input.includes(normalizedTarget)) {
        score = Math.max(score, 80);
        continue;
      }

      // Keyword overlap scoring
      const inputWords = input.split(' ').filter((w) => w.length > 2);
      const targetWords = normalizedTarget.split(' ').filter((w) => w.length > 2);

      if (inputWords.length > 0 && targetWords.length > 0) {
        const commonWords = inputWords.filter((w) => targetWords.some((tw) => tw.includes(w) || w.includes(tw)));
        const keywordScore = (commonWords.length / Math.max(inputWords.length, targetWords.length)) * 70;
        score = Math.max(score, keywordScore);
      }
    }

    if (score > bestScore && score >= 40) {
      bestScore = score;
      bestMatch = fund;
    }
  }

  return bestMatch;
}

/**
 * Fuzzy match a raw name against our stocks database.
 */
function findBestStockMatch(rawName) {
  const input = rawName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!input || input.length < 2) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const stock of stocksDatabase) {
    let score = 0;
    const ticker = stock.ticker.toLowerCase();
    const name = stock.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // Exact ticker match
    if (input === ticker) {
      score = 100;
    }
    // Input contains the ticker as a word
    else if (input.split(' ').includes(ticker)) {
      score = 90;
    }
    // Name match
    else if (name.includes(input) || input.includes(name)) {
      score = 80;
    }
    // Keyword overlap
    else {
      const inputWords = input.split(' ').filter((w) => w.length > 2);
      const nameWords = name.split(' ').filter((w) => w.length > 2);
      if (inputWords.length > 0 && nameWords.length > 0) {
        const commonWords = inputWords.filter((w) => nameWords.some((nw) => nw.includes(w) || w.includes(nw)));
        score = (commonWords.length / Math.max(inputWords.length, nameWords.length)) * 60;
      }
    }

    if (score > bestScore && score >= 40) {
      bestScore = score;
      bestMatch = stock;
    }
  }

  return bestMatch;
}
