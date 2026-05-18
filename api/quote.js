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

  // ── FUNDAMENTALS (Yahoo Finance primary + FMP supplement) ─────────────
  // Yahoo Finance quoteSummary = gratuit, sans quota, couvre tous les tickers
  // FMP key-metrics = 1 seul appel pour D/EBITDA et ROIC
  if (type === 'fundamentals') {
    try {
      const sym = encodeURIComponent(symbol);
      const YH = { headers: { 'User-Agent': 'Mozilla/5.0' } };

      const [yfResp, fmpM_raw] = await Promise.all([
        fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=defaultKeyStatistics,financialData,summaryDetail`, YH),
        fmpFetch(`key-metrics-ttm?symbol=${encodeURIComponent(symbol)}`), // ROIC + D/EBITDA
      ]);

      const yfData = yfResp.ok ? await yfResp.json() : null;
      const yf    = yfData?.quoteSummary?.result?.[0];
      const sd    = yf?.summaryDetail        || {};
      const fd    = yf?.financialData        || {};
      const ks    = yf?.defaultKeyStatistics || {};
      const fmpM  = Array.isArray(fmpM_raw) ? fmpM_raw[0] : fmpM_raw;

      if (!yf && !fmpM) return res.status(404).json({ error: `No fundamental data for ${symbol}` });

      const raw = v => (v?.raw ?? null);
      const pct = v => (v?.raw != null ? v.raw * 100 : null);

      const mktCap = raw(ks.marketCap);
      const fcf    = raw(fd.freeCashflow);
      const ocf    = raw(fd.operatingCashflow);
      const pfcf   = (mktCap && fcf && fcf > 0) ? mktCap / fcf : null;
      const pocf   = (mktCap && ocf && ocf > 0) ? mktCap / ocf : null;

      return res.json({
        symbol,
        // Valorisation
        trailingPE:      raw(sd.trailingPE),
        forwardPE:       raw(sd.forwardPE),      // ← Yahoo Finance direct !
        epsForward:      raw(ks.forwardEps),
        pegRatio:        raw(ks.pegRatio),
        pfcf,
        pocf,
        // Marges
        profitMarginPct:    pct(fd.profitMargins),
        grossMarginPct:     pct(fd.grossMargins),
        operatingMarginPct: pct(fd.operatingMargins),
        // Rentabilité
        returnOnEquity:  pct(fd.returnOnEquity),
        returnOnAssets:  pct(fd.returnOnAssets),
        roic:            fmpM?.roicTTM ? fmpM.roicTTM * 100 : null,
        // Santé
        netDebtToEBITDA: fmpM?.netDebtToEBITDATTM || null,
        currentRatio:    raw(fd.currentRatio),
        // Croissance
        revenueGrowthYoY: pct(fd.revenueGrowth),
        epsGrowth1Y:      pct(fd.earningsGrowth),
        // Cash flow
        freeCashflow:     fcf,
        operatingCashFlow: ocf,
        fcfGrowth:        null,
        // Market
        mktCap,
        currentPriceUSD:  raw(fd.currentPrice),
        timestamp:        Date.now(),
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
