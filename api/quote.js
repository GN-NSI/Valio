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


// ═══ CACHE SUPABASE (TTL 24h — cross-browser, cross-device) ═══
const SUPA_URL = process.env.SUPABASE_URL || 'https://dnmibojfzquicbhtactx.supabase.co';
const SUPA_SVC = process.env.SUPABASE_SERVICE_KEY; // Service role key (Supabase → Settings → API)
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h en ms

async function getCache(ticker) {
  if (!SUPA_SVC) return null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/fundamentals_cache?ticker=eq.${encodeURIComponent(ticker)}&select=data,fetched_at&limit=1`,
      { headers: { apikey: SUPA_SVC, Authorization: `Bearer ${SUPA_SVC}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const row = rows[0];
    if (!row) return null;
    if (Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL) return row.data;
    return null; // Périmé (> 24h)
  } catch { return null; }
}

async function setCache(ticker, data) {
  if (!SUPA_SVC) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/fundamentals_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPA_SVC,
        Authorization: `Bearer ${SUPA_SVC}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ ticker, data, fetched_at: new Date().toISOString() })
    });
  } catch {}
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

  // ── FUNDAMENTALS (cache Supabase 24h → FMP séquentiel si cache manquant) ──
  if (type === 'fundamentals') {
    try {
      // 1. Vérifier le cache Supabase (< 24h → réponse instantanée)
      const cached = await getCache(symbol);
      if (cached) return res.json({ ...cached, _fromCache: true });

      // 2. Cache manquant ou périmé → FMP séquentiel (pas de rate limit)
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const sym = encodeURIComponent(symbol);

      const metricsRaw = await fmpFetch(`key-metrics-ttm?symbol=${sym}`);
      await sleep(250);
      const ratiosRaw = await fmpFetch(`ratios-ttm?symbol=${sym}`);
      await sleep(250);
      const cfRaw = await fmpFetch(`cash-flow-statement?symbol=${sym}&limit=2`);
      await sleep(250);
      const isRaw = await fmpFetch(`income-statement?symbol=${sym}&period=annual&limit=2`);

      const m = Array.isArray(metricsRaw) ? metricsRaw[0] : metricsRaw;
      const r = Array.isArray(ratiosRaw)  ? ratiosRaw[0]  : ratiosRaw;

      if (!m && !r) return res.status(503).json({
        error: 'Données FMP indisponibles.', fmpError: true
      });

      let fcfGrowth = null, fcf0 = null, cfo0 = null;
      if (Array.isArray(cfRaw) && cfRaw.length > 0) {
        fcf0 = cfRaw[0]?.freeCashFlow || null;
        cfo0 = cfRaw[0]?.operatingCashFlow || null;
        if (cfRaw.length >= 2) {
          const fcf1 = cfRaw[1]?.freeCashFlow || null;
          if (fcf0 && fcf1 && fcf1 !== 0) fcfGrowth = ((fcf0 - fcf1) / Math.abs(fcf1)) * 100;
        }
      }

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

      const mktCap = m?.marketCapTTM || m?.marketCap || null;
      const pfcf   = r?.priceToFreeCashFlowsRatioTTM || null;
      const pocf   = r?.priceToOperatingCashFlowsRatioTTM || m?.pocfRatioTTM ||
                     (mktCap && cfo0 && cfo0 > 0 ? mktCap / cfo0 : null);

      const result = {
        symbol,
        trailingPE:      r?.priceToEarningsRatioTTM          || null,
        forwardPE:       null, // FMP free tier: non disponible
        pegRatio:        r?.priceToEarningsGrowthRatioTTM    || null,
        pfcf, pocf,
        profitMarginPct: r?.netProfitMarginTTM   ? r.netProfitMarginTTM   * 100 : null,
        grossMarginPct:  r?.grossProfitMarginTTM ? r.grossProfitMarginTTM * 100 : null,
        returnOnEquity:  m?.returnOnEquityTTM    ? m.returnOnEquityTTM    * 100 : null,
        roic:            m?.roicTTM              ? m.roicTTM              * 100 : null,
        netDebtToEBITDA: m?.netDebtToEBITDATTM  || null,
        currentRatio:    m?.currentRatioTTM      || null,
        freeCashflow: fcf0, operatingCashFlow: cfo0, fcfGrowth,
        revenueGrowthYoY, epsGrowth1Y,
        mktCap,
        timestamp: Date.now(),
      };

      // 3. Stocker en cache Supabase pour les prochaines 24h
      await setCache(symbol, result);

      return res.json(result);
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
