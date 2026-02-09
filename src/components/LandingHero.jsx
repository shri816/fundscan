import { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';

const QUOTES = [
  {
    text: "Compound interest is the eighth wonder of the world.",
    author: "Albert Einstein",
  },
  {
    text: "The first rule of compounding: never interrupt it unnecessarily.",
    author: "Charlie Munger",
  },
  {
    text: "Our favorite holding period is forever.",
    author: "Warren Buffett",
  },
  {
    text: "Wide diversification is only required when investors do not understand what they are doing.",
    author: "Warren Buffett",
  },
  {
    text: "Know what you own, and know why you own it.",
    author: "Peter Lynch",
  },
  {
    text: "In investing, what is comfortable is rarely profitable.",
    author: "Robert Arnott",
  },
];

const STATS = [
  { number: '8-12', label: 'funds held by the average Indian investor' },
  { number: '60%', label: 'of money often sitting in the same 15 stocks' },
  { number: '3-5', label: 'funds is all most portfolios actually need' },
];

export default function LandingHero({ onGetStarted }) {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    setQuoteIndex(Math.floor(Math.random() * QUOTES.length));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setQuoteIndex((prev) => (prev + 1) % QUOTES.length);
        setFade(true);
      }, 300);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const quote = QUOTES[quoteIndex];

  return (
    <section className="relative -mt-16 pt-16">
      <div className="mx-auto max-w-5xl px-4">
        {/* Hero - two column on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center min-h-[calc(100vh-80px)] py-12 lg:py-0">

          {/* Left: Copy */}
          <div>
            <p className="text-xs font-medium tracking-widest uppercase text-slate-400 mb-4">
              Portfolio clarity
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-slate-900 leading-[1.15]">
              Simplify your
              <br />
              mutual fund
              <br />
              investments.
            </h1>
            <p className="mt-5 text-base text-slate-500 leading-relaxed max-w-md">
              Find hidden overlaps between your funds, spot concentration risks, and stop paying for diversification you don't actually have.
            </p>

            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={onGetStarted}
                className="group inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800 active:scale-[0.98]"
              >
                Analyze Portfolio
                <ArrowRight
                  size={14}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </button>
              <span className="text-xs text-slate-400">
                No sign-up. Free.
              </span>
            </div>

            {/* Three stats */}
            <div className="mt-12 grid grid-cols-3 gap-6 border-t border-slate-100 pt-8">
              {STATS.map(({ number, label }) => (
                <div key={number}>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{number}</p>
                  <p className="mt-1 text-[11px] leading-tight text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Quote card + visual */}
          <div className="flex flex-col items-center lg:items-end gap-6">
            {/* Quote card */}
            <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
              {/* Subtle corner accent */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-slate-800 rounded-bl-[80px]" />

              <div className="relative">
                <div className="text-3xl text-slate-600 leading-none mb-3">"</div>
                <div className="min-h-[80px] flex items-center">
                  <div className={`transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}>
                    <p className="text-[15px] leading-relaxed text-slate-300">
                      {quote.text}
                    </p>
                  </div>
                </div>
                <div className={`transition-opacity duration-300 mt-4 ${fade ? 'opacity-100' : 'opacity-0'}`}>
                  <p className="text-xs font-medium text-slate-500">{quote.author}</p>
                </div>

                {/* Quote progress dots */}
                <div className="flex gap-1.5 mt-6">
                  {QUOTES.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 rounded-full transition-all duration-300 ${
                        i === quoteIndex ? 'w-4 bg-slate-400' : 'w-1 bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* What it does - compact */}
            <div className="w-full max-w-sm grid grid-cols-2 gap-3">
              {[
                { title: 'Overlap', desc: 'Fund vs fund comparison' },
                { title: 'Concentration', desc: 'Stock & sector exposure' },
                { title: 'Expenses', desc: 'What you actually pay' },
                { title: 'Diagnosis', desc: 'Clear, honest verdict' },
              ].map(({ title, desc }) => (
                <div
                  key={title}
                  className="bg-white border border-slate-100 rounded-xl px-4 py-3"
                >
                  <p className="text-sm font-medium text-slate-800">{title}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
