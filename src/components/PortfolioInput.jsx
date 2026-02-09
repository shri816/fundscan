import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Plus, FileSpreadsheet, AlertCircle, CheckCircle, ArrowRight, Info } from 'lucide-react';
import { searchFunds, searchStocks } from '../data/funds';
import { parsePortfolioFile } from '../utils/fileParser';

const QUICK_FUNDS = [
  'Axis Bluechip',
  'Parag Parikh Flexi Cap',
  'Mirae Asset Large Cap',
  'Nifty 50 Index',
  'HDFC Mid-Cap Opportunities',
  'SBI Small Cap',
];

function formatIndianNumber(num) {
  if (num === null || num === undefined || num === '') return '';
  const n = Number(num);
  if (isNaN(n)) return '';
  if (n < 1000) return n.toString();
  const str = Math.floor(n).toString();
  const lastThree = str.slice(-3);
  const rest = str.slice(0, -3);
  if (!rest) return lastThree;
  const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${formatted},${lastThree}`;
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function PortfolioInput({ portfolio, setPortfolio, onAnalyze }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadDetails, setUploadDetails] = useState(null);
  const searchRef = useRef(null);
  const fileInputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('loading');
    setUploadMessage('Parsing...');
    setUploadDetails(null);
    try {
      const { results: parsed, unmatched, totalRows, detectedColumns } = await parsePortfolioFile(file);
      if (parsed.length === 0) {
        setUploadStatus('error');
        setUploadMessage(
          unmatched.length > 0
            ? `Couldn't match any of the ${totalRows} rows. Unmatched: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '...' : ''}`
            : 'No fund or stock entries found.'
        );
        return;
      }
      const newItems = parsed.map((item) => ({
        id: generateId(), type: item.type, data: item.data, amount: item.amount,
      }));
      setPortfolio((prev) => {
        const existingCodes = new Set(prev.filter(p => p.type === 'fund').map(p => p.data.schemeCode));
        const existingIsins = new Set(prev.filter(p => p.type === 'stock').map(p => p.data.isin));
        const fresh = newItems.filter((item) => {
          if (item.type === 'fund') return !existingCodes.has(item.data.schemeCode);
          return !existingIsins.has(item.data.isin);
        });
        return [...prev, ...fresh];
      });
      const hasAmounts = parsed.some((p) => p.amount > 0);
      setUploadStatus('success');
      setUploadDetails({ matched: parsed.length, unmatched, detectedColumns });
      setUploadMessage(
        `${parsed.length} holding${parsed.length !== 1 ? 's' : ''} imported` +
        (unmatched.length > 0 ? `, ${unmatched.length} skipped` : '') +
        (!hasAmounts && !detectedColumns?.amount ? '. Enter amounts manually.' : '.')
      );
    } catch (err) {
      setUploadStatus('error');
      setUploadMessage(err.message || 'Failed to parse file.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [setPortfolio]);

  const handleSearch = useCallback((value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setResults([]); setShowDropdown(false); return; }
    debounceRef.current = setTimeout(() => {
      const fundResults = searchFunds(value).map((f) => ({ ...f, _type: 'fund' }));
      const stockResults = searchStocks(value).map((s) => ({ ...s, _type: 'stock' }));
      const combined = [...fundResults, ...stockResults].slice(0, 8);
      setResults(combined);
      setShowDropdown(combined.length > 0);
    }, 250);
  }, []);

  const addToPortfolio = useCallback((item) => {
    const type = item._type;
    const identifier = type === 'fund' ? item.schemeCode || item.schemeName : item.isin || item.ticker;
    const alreadyExists = portfolio.some((p) => {
      if (p.type === 'fund') return p.data.schemeCode === identifier || p.data.schemeName === identifier;
      return p.data.isin === identifier || p.data.ticker === identifier;
    });
    if (alreadyExists) return;
    const { _type, ...data } = item;
    setPortfolio((prev) => [...prev, { id: generateId(), type, data, amount: 0 }]);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  }, [portfolio, setPortfolio]);

  const addPopularFund = useCallback((fundName) => {
    const matches = searchFunds(fundName);
    if (matches.length > 0) {
      const fund = matches[0];
      const alreadyExists = portfolio.some(
        (p) => p.type === 'fund' && (p.data.schemeCode === fund.schemeCode || p.data.schemeName === fund.schemeName)
      );
      if (alreadyExists) return;
      setPortfolio((prev) => [...prev, { id: generateId(), type: 'fund', data: fund, amount: 0 }]);
    }
  }, [portfolio, setPortfolio]);

  const removeItem = useCallback((id) => {
    setPortfolio((prev) => prev.filter((item) => item.id !== id));
  }, [setPortfolio]);

  const updateAmount = useCallback((id, value) => {
    const numValue = value === '' ? 0 : Math.max(0, Number(value));
    setPortfolio((prev) => prev.map((item) => item.id === id ? { ...item, amount: numValue } : item));
  }, [setPortfolio]);

  const totalAmount = portfolio.reduce((sum, item) => sum + (item.amount || 0), 0);
  const canAnalyze = portfolio.length >= 2 && portfolio.every((p) => p.amount > 0);
  const hasItems = portfolio.length > 0;
  const needsAmounts = hasItems && !portfolio.every((p) => p.amount > 0);

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Search */}
      <div ref={searchRef} className="relative">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
            placeholder="Search funds or stocks..."
            autoFocus
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-lg text-sm
                       placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10
                       focus:border-slate-300 transition-all"
          />
        </div>

        {showDropdown && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {results.map((item, idx) => (
              <button
                key={`${item._type}-${item.schemeCode || item.ticker || idx}`}
                onClick={() => addToPortfolio(item)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors
                           border-b border-slate-50 last:border-b-0"
              >
                {item._type === 'fund' ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-800">{item.shortName || item.schemeName}</span>
                    <span className="text-[11px] text-slate-400 ml-2 shrink-0">{item.category}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-800">{item.ticker} <span className="text-slate-400">{item.name}</span></span>
                    <span className="text-[11px] text-slate-400 ml-2 shrink-0">{item.sector}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick add + Upload row */}
      {!hasItems && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_FUNDS.map((name) => (
              <button
                key={name}
                onClick={() => addPopularFund(name)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-500
                           hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {name}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-[11px] text-slate-400">or</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          {/* Upload */}
          <div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadStatus === 'loading'}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-slate-200
                         rounded-lg text-xs text-slate-400 hover:border-slate-300 hover:text-slate-500
                         transition-all cursor-pointer"
            >
              {uploadStatus === 'loading' ? (
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              {uploadStatus === 'loading' ? 'Parsing...' : 'Upload spreadsheet (.xlsx, .csv)'}
            </button>
          </div>

          {/* Upload Result */}
          {uploadMessage && uploadStatus !== 'loading' && (
            <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
              uploadStatus === 'success' ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'
            }`}>
              {uploadStatus === 'success' ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={uploadStatus === 'success' ? 'text-emerald-800' : 'text-red-800'}>{uploadMessage}</p>
                {uploadDetails?.detectedColumns && (
                  <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
                    <p>Name: "{uploadDetails.detectedColumns.name}" {uploadDetails.detectedColumns.amount ? `· Amount: "${uploadDetails.detectedColumns.amount}"` : '· No amount column detected'}</p>
                    {uploadDetails.detectedColumns.all && (
                      <p className="text-slate-400">All columns: {uploadDetails.detectedColumns.all.map(c => `"${c}"`).join(', ')}</p>
                    )}
                  </div>
                )}
              </div>
              <button onClick={() => { setUploadMessage(''); setUploadStatus(null); setUploadDetails(null); }}
                className="text-slate-400 hover:text-slate-600 shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Portfolio List */}
      {hasItems && (
        <div className="mt-5 space-y-2">
          {portfolio.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 bg-white border border-slate-100 rounded-lg px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 truncate">
                  {item.type === 'fund'
                    ? (item.data.shortName || item.data.schemeName)
                    : `${item.data.ticker} · ${item.data.name}`
                  }
                </p>
                <p className="text-[11px] text-slate-400">
                  {item.type === 'fund' ? item.data.category : item.data.sector}
                  {item.type === 'fund' && item.data.expenseRatio != null && ` · ${item.data.expenseRatio}% ER`}
                  {item.type === 'fund' && (!item.data.holdings || item.data.holdings.length === 0) && (
                    <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-500">
                      <Info className="w-3 h-3 inline" />
                      <span>No holdings data</span>
                    </span>
                  )}
                </p>
              </div>

              <div className="relative shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">&#8377;</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={item.amount || ''}
                  onChange={(e) => updateAmount(item.id, e.target.value)}
                  placeholder="Amount"
                  className="w-28 pl-6 pr-2 py-1.5 text-sm text-right border border-slate-200 rounded-md
                             focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-300
                             transition-all [appearance:textfield]
                             [&::-webkit-inner-spin-button]:appearance-none
                             [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>

              <button
                onClick={() => removeItem(item.id)}
                className="p-1 rounded text-slate-300 hover:text-red-400 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {/* Total + Analyze */}
          <div className="pt-3 space-y-3">
            {totalAmount > 0 && (
              <div className="flex items-center justify-between text-sm px-1">
                <span className="text-slate-400">{portfolio.length} holdings</span>
                <span className="font-medium text-slate-700">&#8377;{formatIndianNumber(totalAmount)}</span>
              </div>
            )}

            {canAnalyze && (
              <button
                onClick={onAnalyze}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg
                           bg-slate-900 text-white text-sm font-medium
                           hover:bg-slate-800 active:scale-[0.99] transition-all"
              >
                Scan Portfolio
                <ArrowRight size={14} />
              </button>
            )}

            {needsAmounts && (
              <p className="text-xs text-center text-slate-400">
                {portfolio.length < 2
                  ? 'Add one more to compare'
                  : 'Enter amounts to continue'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
