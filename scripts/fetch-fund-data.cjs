/**
 * FundScan - Fund Data Pipeline
 *
 * Runs weekly via GitHub Actions. Does two things:
 *   1. Scrapes monthly portfolio disclosures from top Indian AMCs to get holdings data
 *   2. Fetches the full scheme list from mfapi.in for comprehensive search
 *
 * Outputs:
 *   - src/data/holdings-snapshot.json  (persistent store, grows over time)
 *   - public/funds-data.json           (final merged output served to the app)
 *
 * Usage:
 *   node scripts/fetch-fund-data.cjs
 */

'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const HOLDINGS_SNAPSHOT = path.join(__dirname, '../src/data/holdings-snapshot.json');
const OUTPUT_FILE = path.join(__dirname, '../public/funds-data.json');
const MFAPI_LIST_URL = 'https://api.mfapi.in/mf';
const REQUEST_DELAY_MS = 300; // polite delay between requests

// ---------------------------------------------------------------------------
// HTTP utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a URL as text, following up to 5 redirects.
 */
function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects: ${url}`));

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'FundScan-DataPipeline/1.0 (github.com/shri816/fundscan)',
        'Accept': '*/*',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect with no location header'));
        const next = location.startsWith('http') ? location : new URL(location, url).href;
        res.resume();
        return resolve(fetchText(next, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/**
 * Fetch a URL as a binary Buffer (for Excel files).
 */
function fetchBinary(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects: ${url}`));

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'FundScan-DataPipeline/1.0 (github.com/shri816/fundscan)',
        'Accept': 'application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect with no location header'));
        const next = location.startsWith('http') ? location : new URL(location, url).href;
        res.resume();
        return resolve(fetchBinary(next, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ---------------------------------------------------------------------------
// Excel parser — flexible SEBI-format portfolio parser
// ---------------------------------------------------------------------------

/**
 * Column name patterns we accept for each field.
 * Match order matters — first hit wins.
 */
const COL_PATTERNS = {
  name: ['name of the instrument', 'issuer', 'security name', 'company', 'name'],
  isin: ['isin'],
  weight: ['% to nav', '% of nav', '% to net asset', '% nav', 'percentage to nav', 'nav%'],
  sector: ['industry', 'sector', 'rating'],
};

function detectColumns(headerRow) {
  const cols = {};
  headerRow.forEach((cell, idx) => {
    const c = String(cell).toLowerCase().trim();
    for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
      if (!cols[field] && patterns.some((p) => c.includes(p))) {
        cols[field] = idx;
      }
    }
  });
  return cols;
}

/**
 * Parse holdings from a single worksheet.
 * Returns [] if the sheet doesn't look like a portfolio table.
 */
function parseSheetHoldings(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 5) return [];

  // Find the header row (look in first 25 rows)
  let headerIdx = -1;
  let cols = {};
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i].map((c) => String(c).toLowerCase().trim());
    if (row.some((c) => c.includes('isin')) && row.some((c) => c.includes('nav') || c.includes('name'))) {
      cols = detectColumns(rows[i]);
      if (cols.isin !== undefined && cols.weight !== undefined) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1 || cols.name === undefined) return [];

  const holdings = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawName = String(row[cols.name] || '').trim();
    const rawIsin = String(row[cols.isin] || '').trim().toUpperCase();
    const rawWeight = parseFloat(String(row[cols.weight] || '').replace('%', '').trim());
    const rawSector = cols.sector !== undefined ? String(row[cols.sector] || '').trim() : '';

    if (!rawName) continue;
    // Stop at total/sub-total rows
    if (rawName.toLowerCase().startsWith('total') || rawName.toLowerCase().startsWith('sub total')) break;
    if (!rawIsin || isNaN(rawWeight) || rawWeight <= 0 || rawWeight > 100) continue;
    // Validate ISIN: must be 12 chars starting with 2 letters
    if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(rawIsin)) continue;

    holdings.push({
      stock: rawName,
      isin: rawIsin,
      weight: Math.round(rawWeight * 100) / 100,
      sector: rawSector || 'Unknown',
    });
  }

  return holdings;
}

/**
 * Parse a workbook buffer and extract { sheetName → holdings[] }.
 * Skips sheets with fewer than 5 valid holdings (likely non-portfolio sheets).
 */
function parseWorkbook(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new Error(`XLSX parse error: ${e.message}`);
  }

  const result = {};
  for (const name of wb.SheetNames) {
    const holdings = parseSheetHoldings(wb.Sheets[name]);
    if (holdings.length >= 5) {
      result[name] = holdings;
    }
  }
  return result;
}

/**
 * Scan the first 10 rows of a sheet to find a "Scheme Name:" or "Fund Name:" label.
 */
function extractFundNameFromSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const cell = String(rows[i][j]).toLowerCase().trim();
      if (cell.includes('scheme name') || cell.includes('fund name') || cell === 'name') {
        // Value is usually in the next cell
        const val = String(rows[i][j + 1] || '').trim();
        if (val.length > 5) return val;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fund name matcher — maps AMC-reported names to mfapi.in scheme codes
// ---------------------------------------------------------------------------

const NOISE_TOKENS = new Set([
  'fund', 'scheme', 'direct', 'regular', 'growth', 'plan', 'option',
  'india', 'mutual', 'the', 'a', 'an', 'of', 'and', 'for', '-', '–',
  'idcw', 'dividend', 'reinvestment', 'payout', 'formerly', 'known', 'as',
]);

function tokenize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

function jaccardSimilarity(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const intersection = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Given a fund name string, find the best matching scheme from mfapi.in.
 * Prefers Direct Growth plans.
 */
function matchFundToSchemes(fundName, allSchemes, minScore = 0.45) {
  const queryTokens = tokenize(fundName);
  if (queryTokens.length === 0) return [];

  const scored = allSchemes.map((s) => ({
    scheme: s,
    score: jaccardSimilarity(queryTokens, tokenize(s.schemeName)),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter((x) => x.score >= minScore)
    .slice(0, 5)
    .map((x) => x.scheme);
}

// ---------------------------------------------------------------------------
// Last-month-end date helper
// ---------------------------------------------------------------------------

function lastMonthEnd() {
  const now = new Date();
  // Go back to the 28th of last month (safe: all months have at least 28 days)
  const d = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
  return d;
}

function formatDate(d, fmt) {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const mon3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const yy = String(yyyy).slice(-2);

  switch (fmt) {
    case 'DD-Mon-YY': return `${dd}-${mon3[d.getMonth()]}-${yy}`;
    case 'Month_DD_YYYY': return `${months[d.getMonth()]}_${dd}_${yyyy}`;
    case 'YYYY-MM': return `${yyyy}-${mm}`;
    case 'DD Month YYYY': return `${dd} ${months[d.getMonth()]} ${yyyy}`;
    default: return d.toISOString().split('T')[0];
  }
}

// ---------------------------------------------------------------------------
// AMC Scrapers
// ---------------------------------------------------------------------------

/**
 * Parag Parikh (PPFAS)
 * Listing page: https://amc.ppfas.com/downloads/portfolio-disclosure/
 * File pattern: /downloads/portfolio-disclosure/YYYY/FUNDCODE_PPFAS_Monthly_Portfolio_Report_Month_DD_YYYY.xls
 */
async function scrapePPFAS(allSchemes) {
  console.log('  Scraping PPFAS...');
  const results = [];
  try {
    const html = await fetchText('https://amc.ppfas.com/downloads/portfolio-disclosure/');
    // Extract the most recent file links (one per fund code)
    const linkRe = /href="(\/downloads\/portfolio-disclosure\/\d{4}\/[^"]+\.(xls|xlsx)[^"]*)"/gi;
    const seen = new Set();
    const links = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1].split('?')[0]; // strip cache-busting query param
      if (!seen.has(href)) { seen.add(href); links.push(href); }
    }
    // Keep only the latest entry per fund code (links are newest-first on PPFAS)
    const latestByCode = new Map();
    for (const href of links) {
      const match = href.match(/\/([A-Z]+)_PPFAS_Monthly/);
      if (match && !latestByCode.has(match[1])) {
        latestByCode.set(match[1], `https://amc.ppfas.com${href}`);
      }
    }
    console.log(`    Found ${latestByCode.size} PPFAS fund files`);

    for (const [code, url] of latestByCode) {
      await sleep(REQUEST_DELAY_MS);
      try {
        const buf = await fetchBinary(url);
        const sheets = parseWorkbook(buf);
        for (const [sheetName, holdings] of Object.entries(sheets)) {
          // PPFAS file: sheet name is usually the fund name or "Portfolio"
          const fundNameGuess = sheetName.includes('Portfolio') ? code : sheetName;
          const matches = matchFundToSchemes(`Parag Parikh ${fundNameGuess}`, allSchemes);
          if (matches.length > 0) {
            results.push({ scheme: matches[0], holdings, holdingsDate: new Date().toISOString().split('T')[0] });
          }
        }
      } catch (e) {
        console.log(`    PPFAS ${code}: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  PPFAS scrape failed: ${e.message}`);
  }
  return results;
}

/**
 * Nippon India MF
 * URL: https://mf.nipponindiaim.com/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-DD-Mon-YY.xls
 * One large file with multiple sheets (one per fund).
 */
async function scrapeNippon(allSchemes) {
  console.log('  Scraping Nippon India...');
  const results = [];
  try {
    const d = lastMonthEnd();
    const dateStr = formatDate(d, 'DD-Mon-YY');
    const url = `https://mf.nipponindiaim.com/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-${dateStr}.xls`;
    console.log(`    Fetching: ${url}`);
    const buf = await fetchBinary(url);
    const sheets = parseWorkbook(buf);
    console.log(`    Parsed ${Object.keys(sheets).length} sheets`);

    for (const [sheetName, holdings] of Object.entries(sheets)) {
      const matches = matchFundToSchemes(`Nippon India ${sheetName}`, allSchemes);
      if (matches.length > 0) {
        results.push({ scheme: matches[0], holdings, holdingsDate: formatDate(d, 'YYYY-MM-DD') });
      }
    }
  } catch (e) {
    console.log(`  Nippon India scrape failed: ${e.message}`);
  }
  return results;
}

/**
 * HDFC Mutual Fund
 * Listing page: https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio
 * Files: https://files.hdfcfund.com/s3fs-public/YYYY-MM/Monthly%20[Fund_Name]%20-%20[DD Month YYYY].xlsx
 */
async function scrapeHDFC(allSchemes) {
  console.log('  Scraping HDFC...');
  const results = [];
  try {
    const html = await fetchText('https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio');
    const linkRe = /https:\/\/files\.hdfcfund\.com\/[^"'\s]+\.xlsx/gi;
    const seen = new Set();
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      seen.add(m[0]);
    }
    const links = [...seen];
    console.log(`    Found ${links.length} HDFC fund files`);

    for (const url of links) {
      await sleep(REQUEST_DELAY_MS);
      try {
        // Extract fund name from URL: "Monthly%20HDFC%20Flexi%20Cap%20Fund%20-%20..."
        const decoded = decodeURIComponent(url.split('/').pop());
        const fundNameMatch = decoded.match(/^Monthly\s+(.+?)\s+-\s+\d/);
        const fundName = fundNameMatch ? fundNameMatch[1] : decoded;

        const buf = await fetchBinary(url);
        const sheets = parseWorkbook(buf);
        const holdings = Object.values(sheets)[0] || [];
        if (holdings.length < 5) continue;

        const matches = matchFundToSchemes(fundName, allSchemes);
        if (matches.length > 0) {
          results.push({ scheme: matches[0], holdings, holdingsDate: new Date().toISOString().split('T')[0] });
        }
      } catch (e) {
        console.log(`    HDFC file error: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  HDFC scrape failed: ${e.message}`);
  }
  return results;
}

/**
 * Generic HTML-discovery scraper for AMCs where we scrape the listing page
 * and find Excel download links.
 */
async function scrapeGeneric(amcName, listingUrl, baseUrl, allSchemes) {
  console.log(`  Scraping ${amcName}...`);
  const results = [];
  try {
    const html = await fetchText(listingUrl);
    // Find all .xls/.xlsx links
    const linkRe = /href="([^"]+\.(xlsx|xls))"/gi;
    const seen = new Set();
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1].startsWith('http') ? m[1] : `${baseUrl}${m[1].startsWith('/') ? '' : '/'}${m[1]}`;
      seen.add(href);
    }
    const links = [...seen].slice(0, 30); // limit to avoid excessive downloads
    console.log(`    Found ${links.length} files for ${amcName}`);

    for (const url of links) {
      await sleep(REQUEST_DELAY_MS);
      try {
        const buf = await fetchBinary(url);
        const sheets = parseWorkbook(buf);

        for (const [sheetName, holdings] of Object.entries(sheets)) {
          const wb = XLSX.read(buf, { type: 'buffer' });
          const ws = wb.Sheets[sheetName];
          const fundNameFromSheet = extractFundNameFromSheet(ws);
          const searchName = fundNameFromSheet || `${amcName} ${sheetName}`;
          const matches = matchFundToSchemes(searchName, allSchemes);
          if (matches.length > 0) {
            results.push({ scheme: matches[0], holdings, holdingsDate: new Date().toISOString().split('T')[0] });
          }
        }
      } catch (e) {
        console.log(`    ${amcName} file error: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  ${amcName} scrape failed: ${e.message}`);
  }
  return results;
}

// AMC scraper registry
const AMC_SCRAPERS = [
  { name: 'PPFAS', fn: (s) => scrapePPFAS(s) },
  { name: 'Nippon India', fn: (s) => scrapeNippon(s) },
  { name: 'HDFC', fn: (s) => scrapeHDFC(s) },
  {
    name: 'Mirae Asset',
    fn: (s) => scrapeGeneric('Mirae Asset', 'https://www.miraeassetmf.co.in/downloads/portfolio', 'https://www.miraeassetmf.co.in', s),
  },
  {
    name: 'Axis',
    fn: (s) => scrapeGeneric('Axis', 'https://www.axismf.com/statutory-disclosures', 'https://www.axismf.com', s),
  },
  {
    name: 'Kotak',
    fn: (s) => scrapeGeneric('Kotak', 'https://www.kotakmf.com/Information/portfolios', 'https://www.kotakmf.com', s),
  },
  {
    name: 'DSP',
    fn: (s) => scrapeGeneric('DSP', 'https://www.dspim.com/mandatory-disclosures/portfolio-disclosures', 'https://www.dspim.com', s),
  },
  {
    name: 'SBI',
    fn: (s) => scrapeGeneric('SBI', 'https://www.sbimf.com/portfolios', 'https://www.sbimf.com', s),
  },
  {
    name: 'ICICI Prudential',
    fn: (s) => scrapeGeneric('ICICI Prudential', 'https://www.icicipruamc.com/downloads/others/monthly-portfolio-disclosures', 'https://www.icicipruamc.com', s),
  },
  {
    name: 'UTI',
    fn: (s) => scrapeGeneric('UTI', 'https://www.utimf.com/downloads/consolidate-all-portfolio-disclosure', 'https://www.utimf.com', s),
  },
];

// ---------------------------------------------------------------------------
// Holdings snapshot helpers
// ---------------------------------------------------------------------------

function loadSnapshot() {
  if (!fs.existsSync(HOLDINGS_SNAPSHOT)) return [];
  return JSON.parse(fs.readFileSync(HOLDINGS_SNAPSHOT, 'utf8'));
}

function mergeIntoSnapshot(snapshot, scrapedResults) {
  const byCode = new Map(snapshot.map((f) => [f.schemeCode, f]));

  for (const { scheme, holdings, holdingsDate } of scrapedResults) {
    const code = String(scheme.schemeCode);
    const existing = byCode.get(code);

    // Only update if we got more holdings than before
    if (!existing || holdings.length > (existing.holdings?.length || 0)) {
      byCode.set(code, {
        schemeCode: code,
        schemeName: scheme.schemeName,
        shortName: existing?.shortName || generateShortName(scheme.schemeName),
        category: existing?.category || mapCategory(scheme.schemeName),
        fundHouse: existing?.fundHouse || extractFundHouse(scheme.schemeName),
        expenseRatio: existing?.expenseRatio || null,
        aum: existing?.aum || null,
        holdings,
        holdingsDate,
      });
    }
  }

  return Array.from(byCode.values());
}

// ---------------------------------------------------------------------------
// Fund metadata helpers (for newly scraped funds without local metadata)
// ---------------------------------------------------------------------------

function generateShortName(schemeName) {
  // Remove common suffixes to create a shorter display name
  return schemeName
    .replace(/\s*-\s*(Direct|Regular)\s*(Plan)?\s*-?\s*(Growth|IDCW|Dividend)\s*/gi, '')
    .replace(/\s*(Formerly Known as.*)/gi, '')
    .replace(/\s*\(.*\)\s*/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function mapCategory(schemeName) {
  const n = schemeName.toLowerCase();
  if (n.includes('large cap') || n.includes('bluechip')) return 'Large Cap';
  if (n.includes('mid cap')) return 'Mid Cap';
  if (n.includes('small cap')) return 'Small Cap';
  if (n.includes('flexi cap') || n.includes('flexicap')) return 'Flexi Cap';
  if (n.includes('multi cap') || n.includes('multicap')) return 'Multi Cap';
  if (n.includes('large & mid') || n.includes('large and mid')) return 'Large & Mid Cap';
  if (n.includes('elss') || n.includes('tax sav') || n.includes('tax saving')) return 'ELSS';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex')) return 'Index';
  if (n.includes('international') || n.includes('global') || n.includes('overseas')) return 'International';
  if (n.includes('focused')) return 'Focused';
  if (n.includes('value') || n.includes('contra')) return 'Value/Contra';
  if (n.includes('hybrid') || n.includes('balanced') || n.includes('equity savings')) return 'Hybrid';
  if (n.includes('sectoral') || n.includes('thematic') || n.includes('infrastructure') ||
      n.includes('banking') || n.includes('pharma') || n.includes('technology') ||
      n.includes('consumption') || n.includes('business cycle')) return 'Sectoral/Thematic';
  return 'Equity';
}

function extractFundHouse(schemeName) {
  const houses = [
    ['HDFC', 'HDFC Mutual Fund'],
    ['SBI', 'SBI Mutual Fund'],
    ['ICICI Prudential', 'ICICI Prudential Mutual Fund'],
    ['Nippon India', 'Nippon India Mutual Fund'],
    ['Axis', 'Axis Mutual Fund'],
    ['Kotak', 'Kotak Mutual Fund'],
    ['Mirae Asset', 'Mirae Asset Mutual Fund'],
    ['DSP', 'DSP Mutual Fund'],
    ['UTI', 'UTI Mutual Fund'],
    ['Parag Parikh', 'Parag Parikh Mutual Fund'],
    ['Motilal Oswal', 'Motilal Oswal Mutual Fund'],
    ['Tata', 'Tata Mutual Fund'],
    ['Franklin', 'Franklin Templeton Mutual Fund'],
    ['Aditya Birla', 'Aditya Birla Sun Life Mutual Fund'],
    ['ABSL', 'Aditya Birla Sun Life Mutual Fund'],
    ['Bandhan', 'Bandhan Mutual Fund'],
    ['Canara Robeco', 'Canara Robeco Mutual Fund'],
    ['Invesco', 'Invesco Mutual Fund'],
    ['Quant', 'Quant Mutual Fund'],
  ];
  const n = schemeName.toLowerCase();
  for (const [pattern, house] of houses) {
    if (n.includes(pattern.toLowerCase())) return house;
  }
  return 'Unknown AMC';
}

// ---------------------------------------------------------------------------
// Schema filter (keep only relevant schemes for search)
// ---------------------------------------------------------------------------

function isRelevantScheme(schemeName) {
  const name = schemeName.toLowerCase();
  const skipCategories = [
    'liquid', 'overnight', 'money market', 'ultra short', 'low duration',
    'short duration', 'medium duration', 'long duration', 'dynamic bond',
    'corporate bond', 'credit risk', 'banking and psu', 'gilt',
    'fixed maturity', 'fmp', 'interval fund', 'arbitrage',
  ];
  if (skipCategories.some((c) => name.includes(c))) return false;
  const skipVariants = ['idcw', 'dividend', 'monthly payout', 'quarterly payout', 'annual payout', 'weekly payout'];
  if (skipVariants.some((v) => name.includes(v))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  console.log('=== FundScan Data Pipeline ===\n');

  // 1. Load existing snapshot
  const snapshot = loadSnapshot();
  console.log(`Loaded ${snapshot.length} funds from holdings snapshot\n`);

  // 2. Fetch scheme list from mfapi.in
  console.log('Fetching scheme list from mfapi.in...');
  let allSchemesRaw = [];
  try {
    const json = await fetchText(MFAPI_LIST_URL);
    allSchemesRaw = JSON.parse(json);
    console.log(`Fetched ${allSchemesRaw.length} total schemes\n`);
  } catch (e) {
    console.error(`Failed to fetch mfapi.in: ${e.message}`);
    // Continue with scraping even if mfapi fetch fails
  }

  // 3. Scrape holdings from each AMC
  console.log('Scraping AMC portfolio disclosures...');
  const allScraped = [];
  const stats = {};

  for (const { name, fn } of AMC_SCRAPERS) {
    try {
      const results = await fn(allSchemesRaw);
      allScraped.push(...results);
      stats[name] = { success: true, count: results.length };
      console.log(`  ✓ ${name}: ${results.length} funds scraped`);
    } catch (e) {
      stats[name] = { success: false, error: e.message };
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }
  console.log(`\nTotal scraped: ${allScraped.length} fund holdings\n`);

  // 4. Merge scraped data into snapshot
  const updatedSnapshot = mergeIntoSnapshot(snapshot, allScraped);
  const newFunds = updatedSnapshot.length - snapshot.length;
  const updatedFunds = allScraped.length - newFunds;
  console.log(`Snapshot updated: ${updatedSnapshot.length} total funds (${newFunds} new, ~${updatedFunds} updated)`);
  fs.writeFileSync(HOLDINGS_SNAPSHOT, JSON.stringify(updatedSnapshot, null, 2));
  console.log(`Saved holdings snapshot\n`);

  // 5. Build public/funds-data.json
  const holdingsMap = new Map(updatedSnapshot.map((f) => [String(f.schemeCode), f]));
  const filteredSchemes = allSchemesRaw.filter((s) => isRelevantScheme(s.schemeName));

  const schemes = filteredSchemes.map((scheme) => {
    const code = String(scheme.schemeCode);
    const local = holdingsMap.get(code);
    if (local) {
      return {
        schemeCode: code,
        schemeName: scheme.schemeName,
        shortName: local.shortName,
        category: local.category,
        fundHouse: local.fundHouse,
        expenseRatio: local.expenseRatio,
        aum: local.aum,
        holdings: local.holdings,
        holdingsDate: local.holdingsDate || null,
        dataQuality: 'full',
      };
    }
    return { schemeCode: code, schemeName: scheme.schemeName, dataQuality: 'search-only' };
  });

  // Append any snapshot funds not in mfapi.in list (shouldn't happen much)
  const remoteCodes = new Set(filteredSchemes.map((s) => String(s.schemeCode)));
  for (const f of updatedSnapshot) {
    if (!remoteCodes.has(String(f.schemeCode))) {
      schemes.push({ ...f, dataQuality: 'full' });
    }
  }

  const schemesWithHoldings = schemes.filter((s) => s.dataQuality === 'full').length;
  const output = {
    lastUpdated: new Date().toISOString(),
    version: '1.0',
    totalSchemes: schemes.length,
    schemesWithHoldings,
    scrapeStats: stats,
    schemes,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));
  const fileSizeKB = Math.round(fs.statSync(OUTPUT_FILE).size / 1024);
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n=== Done in ${elapsed}s ===`);
  console.log(`  Total schemes:      ${schemes.length}`);
  console.log(`  With full holdings: ${schemesWithHoldings}`);
  console.log(`  File size:          ${fileSizeKB} KB`);
}

main().catch((err) => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
