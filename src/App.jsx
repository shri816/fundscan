import { useState, useRef, useEffect, useCallback } from 'react';
import LandingHero from './components/LandingHero';
import PortfolioInput from './components/PortfolioInput';
import ScoreCard from './components/ScoreCard';
import OverlapMatrix from './components/OverlapMatrix';
import ConcentrationView from './components/ConcentrationView';
import ExpenseView from './components/ExpenseView';
import Recommendations, { TopIssues } from './components/Recommendations';
import { generateFullAnalysis } from './utils/analysis';
import { generateRecommendations } from './utils/recommendations';

function App() {
  const [portfolio, setPortfolio] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [view, setView] = useState('landing'); // 'landing' | 'input' | 'results'
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const resultsRef = useRef(null);
  const recsRef = useRef(null);
  const inputRef = useRef(null);

  // Sync browser history with view state
  useEffect(() => {
    const onPopState = (e) => {
      const target = e.state?.view || 'landing';
      setView(target);
      if (target === 'landing') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('popstate', onPopState);
    // Replace current entry with landing state on mount
    window.history.replaceState({ view: 'landing' }, '');
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleGetStarted = () => {
    setView('input');
    window.history.pushState({ view: 'input' }, '');
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleAnalyze = () => {
    setIsAnalyzing(true);

    // Small delay for UX - makes it feel like computation is happening
    setTimeout(() => {
      const result = generateFullAnalysis(portfolio);
      const recs = generateRecommendations(result, portfolio);
      setAnalysis(result);
      setRecommendations(recs);
      setView('results');
      window.history.pushState({ view: 'results' }, '');
      setIsAnalyzing(false);

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }, 800);
  };

  const handleReset = () => {
    setPortfolio([]);
    setAnalysis(null);
    setRecommendations([]);
    setView('landing');
    // Replace history instead of pushing, so back doesn't cycle through resets
    window.history.pushState({ view: 'landing' }, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className={`min-h-screen ${view === 'landing' ? 'bg-white' : 'bg-surface'}`}>
      {/* Header */}
      <header className={`sticky top-0 z-50 ${view === 'landing' ? 'bg-transparent' : 'bg-white/80 backdrop-blur-md border-b border-gray-100'}`}>
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <button onClick={handleReset} className="flex items-center gap-1.5 hover:opacity-70 transition-opacity">
            <span className="text-lg tracking-tight text-slate-900">fund</span>
            <span className="text-lg tracking-tight text-slate-400">scan</span>
          </button>

        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-16">
        {/* Landing */}
        {view === 'landing' && (
          <LandingHero onGetStarted={handleGetStarted} />
        )}

        {/* Portfolio Input */}
        {(view === 'input' || view === 'results') && (
          <div ref={inputRef} className="pt-6">
            <PortfolioInput
              portfolio={portfolio}
              setPortfolio={setPortfolio}
              onAnalyze={handleAnalyze}
              isAnalyzing={isAnalyzing}
              hasResults={view === 'results'}
            />
          </div>
        )}

        {/* Loading State */}
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-[3px] border-slate-900 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 font-medium">Scanning your portfolio...</p>
            <p className="text-gray-400 text-sm mt-1">Analyzing overlaps, concentration, and expenses</p>
          </div>
        )}

        {/* Results */}
        {view === 'results' && analysis && !isAnalyzing && (
          <div ref={resultsRef} className="space-y-6 mt-8">
            {(() => {
              const noHoldings = portfolio.filter(p => p.type === 'fund' && (!p.data.holdings || p.data.holdings.length === 0));
              if (noHoldings.length === 0) return null;
              const fundNames = noHoldings.map(p => p.data.shortName || p.data.schemeName);
              return (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-700 mb-1">
                    Can't analyze {noHoldings.length === 1 ? 'this fund' : `these ${noHoldings.length} funds`} for overlap
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {fundNames.map((name, i) => (
                      <span key={i} className="bg-white border border-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded">
                        {name}
                      </span>
                    ))}
                  </div>
                  <p className="text-slate-500">
                    {noHoldings.length === 1 ? 'This fund is' : 'These funds are'} outside our database of 50 funds, so we don't have holdings data.
                    {' '}Expense ratios and invested amounts are still included in the analysis.
                  </p>
                </div>
              );
            })()}
            <ScoreCard
              score={analysis.portfolioScore.score}
              color={analysis.portfolioScore.color}
              label={analysis.portfolioScore.label}
              summary={analysis.summary}
            />

            {recommendations.length > 0 && (
              <TopIssues
                recommendations={recommendations}
                onViewAll={() => recsRef.current?.scrollIntoView({ behavior: 'smooth' })}
              />
            )}

            <OverlapMatrix overlapData={analysis.overlapMatrix} />

            <ConcentrationView
              stockConcentration={analysis.stockConcentration}
              sectorConcentration={analysis.sectorConcentration}
              assetAllocation={analysis.assetAllocation}
            />

            <ExpenseView expenseData={analysis.expenseAnalysis} />

            {recommendations.length > 0 && (
              <div ref={recsRef}>
                <Recommendations recommendations={recommendations} />
              </div>
            )}

            {/* Share Section */}
            <div className="bg-white rounded-xl border border-slate-100 p-6 text-center">
              <p className="text-sm text-slate-500 mb-4">
                Help your friends discover their portfolio blind spots
              </p>
              <button
                onClick={() => {
                  const text = `My mutual fund portfolio scored ${analysis.portfolioScore.score}/100 on FundScan. ${analysis.portfolioScore.score < 50 ? 'Turns out I need to clean up.' : 'Not bad!'} Check yours:`;
                  if (navigator.share) {
                    navigator.share({ title: 'FundScan Results', text, url: window.location.href });
                  } else {
                    navigator.clipboard.writeText(text + ' ' + window.location.href);
                    alert('Link copied to clipboard!');
                  }
                }}
                className="bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                Share Results
              </button>
            </div>

            {/* Footer */}
            <div className="text-center py-8 text-slate-400 text-xs">
              <p>FundScan does not provide investment advice. Always consult a SEBI-registered advisor.</p>
              <p className="mt-2">Built by <a href="https://github.com/shri816" className="text-slate-500 hover:text-slate-700 transition-colors" target="_blank" rel="noopener noreferrer">Shrikant Kadu</a></p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
