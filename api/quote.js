// ═══ ROTATION AUTOMATIQUE DES CLÉS FMP ═══
// Ajoute FMP_KEY, FMP_KEY_2, FMP_KEY_3 dans Vercel → Settings → Environment Variables.
// Si la clé 1 est épuisée (ex: 542/250), la 2 prend le relais automatiquement.
// Chaque clé gratuite FMP = 250 appels/jour → 3 clés = 750/jour.

function getFmpKeys() {
  return [
    process.env.FMP_KEY,
    process.env.FMP_KEY_2,
    process.env.FMP_KEY_3,
    'yrFxAuUHv6XgKGxfXol6sGWVxmEq6tBr', // clé de secours partagée (dernier recours)
  ].filter(k => k && k.length > 10);
}

function isQuotaError(data) {
  if (!data || Array.isArray(data)) return false;
  const msg = (data['Error Message'] || data['message'] || data['error'] || '').toLowerCase();
  return msg.includes('limit') || msg.includes('quota') || msg.includes('upgrade') || msg.includes('reach');
}

// Appelle un endpoint FMP — essaie chaque clé jusqu'à succès
async function fmpFetch(path) {
  for (const [i, key] of getFmpKeys().entries()) {
    try {
      const r = await fetch(`https://financialmodelingprep.com/stable/${path}&apikey=${key}`);
      if (!r.ok) continue;
      const data = await r.json();
      if (isQuotaError(data)) { console.log(`FMP key ${i+1} quota exhausted, trying next...`); continue; }
      return data;
    } catch { continue; }
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── PROFILE ───────────────────────────────────────────────────────────
  if (type === 'profile') {
    try {
      const d = await fmpFetch(`profile?symbol=${encodeURIComponent(symbol)}`);
      const p = Array.isArray(d) ? d[0] : d;
      if (!p?.symbol) return res.status(404).json({ error: `Profile introuvable pour ${symbol}` });
      return res.json({ symbol, sector: p.sector||null, industry: p.industry||null, country: p.country||null, mktCap: p.mktCap||null, isEtf: p.isEtf||false, currency: p.currency||null });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── FUNDAMENTALS ──────────────────────────────────────────────────────
  if (type === 'fundamentals') {
    try {
      const [metricsRaw, ratiosRaw, cfRaw, isRaw] = await Promise.all([
        fmpFetch(`key-metrics-ttm?symbol=${encodeURIComponent(symbol)}`),
        fmpFetch(`ratios-ttm?symbol=${encodeURIComponent(symbol)}`),
        fmpFetch(`cash-flow-statement?symbol=${encodeURIComponent(symbol)}&limit=2`),
        fmpFetch(`income-statement?symbol=${encodeURIComponent(symbol)}&period=annual&limit=2`),
      ]);

      const m = Array.isArray(metricsRaw) ? metricsRaw[0] : metricsRaw;
      const r = Array.isArray(ratiosRaw)  ? ratiosRaw[0]  : ratiosRaw;

      if (!m && !r) return res.status(503).json({
        error: 'Toutes les clés FMP épuisées. Ajoute FMP_KEY_2 dans Vercel.',
        fmpError: true,
      });

      // Forward EPS — non disponible free tier
      const epsForward = null;
      // CA 1A et EPS 1A depuis income-statement annuel (2 dernières années)
      let revenueGrowthYoY = null, epsGrowth1Y = null;
      if (Array.isArray(isRaw) && isRaw.length >= 2) {
        const [curr, prev] = isRaw;
        if (curr?.revenue && prev?.revenue && prev.revenue !== 0)
          revenueGrowthYoY = ((curr.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
        const cEps = curr?.eps ?? curr?.epsBasic ?? curr?.epsDiluted ?? null;
        const pEps = prev?.eps ?? prev?.epsBasic ?? prev?.epsDiluted ?? null;
        if (cEps != null && pEps != null && pEps !== 0)
          epsGrowth1Y = ((cEps - pEps) / Math.abs(pEps)) * 100;
      }

      // Cash flow
      let fcfGrowth = null, fcf0 = null, cfo0 = null;
      if (Array.isArray(cfRaw) && cfRaw.length > 0) {
        fcf0 = cfRaw[0]?.freeCashFlow       || null;
        cfo0 = cfRaw[0]?.operatingCashFlow  || null;
        if (cfRaw.length >= 2) {
          const fcf1 = cfRaw[1]?.freeCashFlow || null;
          if (fcf0 && fcf1 && fcf1 !== 0) fcfGrowth = ((fcf0 - fcf1) / Math.abs(fcf1)) * 100;
        }
      }

      const currentPrice = m?.stockPriceTTM || null;
      const forwardPE    = (epsForward > 0 && currentPrice) ? currentPrice / epsForward : null;

      return res.json({
        symbol,
        trailingPE:         r?.priceToEarningsRatioTTM          || null,
        forwardPE,
        epsForward,
        pegRatio:           r?.priceToEarningsGrowthRatioTTM    || null,
        pfcf:               r?.priceToFreeCashFlowsRatioTTM     || null,
        pocf:               r?.priceToOperatingCashFlowsRatioTTM || m?.pocfRatioTTM ||
                            (mktCap && cfo0 && cfo0 > 0 ? mktCap / cfo0 : null),
        profitMarginPct:    r?.netProfitMarginTTM   ? r.netProfitMarginTTM   * 100 : null,
        grossMarginPct:     r?.grossProfitMarginTTM ? r.grossProfitMarginTTM * 100 : null,
        roic:               m?.roicTTM              ? m.roicTTM              * 100 : null,
        returnOnEquity:     m?.returnOnEquityTTM    ? m.returnOnEquityTTM    * 100 : null,
        netDebtToEBITDA:    m?.netDebtToEBITDATTM  || null,
        freeCashflow:       fcf0,
        operatingCashFlow:  cfo0,
        fcfGrowth,
        mktCap:             m?.marketCapTTM || m?.marketCap || null,
        currentPriceUSD:    currentPrice,
        revenueGrowthYoY,
        epsGrowth1Y,
        timestamp:          Date.now(),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── PRIX (Yahoo Finance) ──────────────────────────────────────────────
  const sym  = encodeURIComponent(symbol);
  const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  const YH   = { headers: { 'User-Agent': 'Mozilla/5.0' } };
  try {
    const [r5d, rhist] = await Promise.all([
      fetch(`${BASE}${sym}?range=5d&interval=1d&includePrePost=false`, YH),
      fetch(`${BASE}${sym}?range=1y&interval=1mo&includePrePost=false`, YH),
    ]);

    const d5    = r5d.ok   ? await r5d.json()   : null;
    const dhist = rhist.ok ? await rhist.json() : null;
    const chart = d5?.chart?.result?.[0];
    if (!chart) return res.status(404).json({ error: `Ticker introuvable: ${symbol}` });

    const meta      = chart.meta;
    const price     = meta.regularMarketPrice || meta.previousClose;
    const prev      = meta.previousClose || meta.chartPreviousClose;
    const currency  = meta.currency || 'USD';
    const changeAbs = price - prev;
    const changePct = prev ? (changeAbs / prev) * 100 : 0;

    const hchart = dhist?.chart?.result?.[0];
    const closes = hchart?.indicators?.quote?.[0]?.close || [];
    const times  = hchart?.timestamp || [];
    const pts    = closes.map((c, i) => c != null ? { c, t: times[i] } : null).filter(Boolean);

    let change1M = null, changeYTD = null, change1Y = null;
    if (pts.length > 0) {
      const now = pts[pts.length - 1].c;
      const jan1 = new Date(); jan1.setMonth(0); jan1.setDate(1);
      const ytdPt = pts.find(e => e.t * 1000 >= jan1.getTime());
      if (ytdPt) changeYTD = ((now - ytdPt.c) / ytdPt.c) * 100;
      if (pts.length >= 2)  change1M = ((now - pts[pts.length - 2].c) / pts[pts.length - 2].c) * 100;
      if (pts.length >= 12) change1Y = ((now - pts[pts.length - 12].c) / pts[pts.length - 12].c) * 100;
    }

    return res.json({ symbol, price, prevClose: prev, changeAbs, changePct, change1M, changeYTD, change1Y, currency, exchange: meta.exchangeName, timestamp: Date.now() });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
