import { useState, useEffect } from 'react';
import { fundsDatabase } from '../data/funds';

// Base URL for fetching the generated fund data JSON
const FUNDS_DATA_URL = `${import.meta.env.BASE_URL}funds-data.json`;

/**
 * Loads funds-data.json (built weekly by GitHub Actions).
 * Falls back to the local hardcoded database if the fetch fails.
 *
 * Returns:
 *   allFunds       – merged array of fund objects ready for search
 *   loading        – true while the fetch is in flight
 *   dataStats      – { lastUpdated, totalSchemes, schemesWithHoldings } | null
 */
export function useFundsData() {
  const [allFunds, setAllFunds] = useState(fundsDatabase);
  const [loading, setLoading] = useState(true);
  const [dataStats, setDataStats] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(FUNDS_DATA_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (cancelled) return;

        // Build a map of local funds keyed by schemeCode for O(1) lookup
        const localByCode = new Map(fundsDatabase.map((f) => [String(f.schemeCode), f]));

        // Merge: prefer local full data; fall back to whatever the JSON has
        const merged = json.schemes.map((remote) => {
          const local = localByCode.get(remote.schemeCode);
          if (local) return local; // local always has full holdings
          return remote;
        });

        // Any local fund not already present (scheme code mismatch) — append it
        const remoteCodes = new Set(json.schemes.map((s) => s.schemeCode));
        for (const local of fundsDatabase) {
          if (!remoteCodes.has(String(local.schemeCode))) {
            merged.push(local);
          }
        }

        const withHoldings = merged.filter((f) => f.holdings?.length > 0).length;
        setAllFunds(merged);
        setDataStats({
          lastUpdated: json.lastUpdated,
          totalSchemes: merged.length,
          schemesWithHoldings: withHoldings,
          fetchError: json.fetchError || null,
        });
      } catch (err) {
        // Network failure or bad JSON — silently fall back to local data
        if (!cancelled) {
          setDataStats(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { allFunds, loading, dataStats };
}
