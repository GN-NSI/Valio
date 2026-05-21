// ═══ VALIO — quote.js ═══
// Source unique : Yahoo Finance (sans quota, sans clé API)
// Cache : Supabase 24h pour les fondamentaux

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ── Yahoo Finance crumb (caché dans l'instance Vercel) ──────────────────
let _crumb = null;
let _cookies = null;

async function getYFCreds() {
  if (_crumb) return { crumb: _crumb, cookies: _cookies };
  try {
    const visit = await fetch('https://finance.yahoo.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow'
    });
    const raw = visit.headers.get('set-cookie') || '';
    _cookies = raw.split(',').map(c => c.split(';')[0].trim()).filter(c => c.includes('=')).join('; ');
    const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, 'Cookie': _cookies }
    });
    if (cr.ok) _crumb = await cr.text();
  } catch {}
  return { crumb: _crumb, cookies: _cookies };
}

async function yfSummary(symbol, modules) {
  try {
    const { crumb, cookies } = await getYFCreds();
    let url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    if (crumb) url += `&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cookie': cookies || '', 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.quoteSummary?.result?.[0] || null;
  } catch { return null; }
}

// ── Cache Supabase 24h ──────────────────────────────────────────────────
const SUPA_URL = process.env.SUPABASE_URL || 'https://dnmibojfzquicbhtactx.supabase.co';
const SUPA_SVC = process.env.SUPABASE_SERVICE_KEY;
const CACHE_TTL = 24 * 60 * 60 * 1000;

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
    return null;
  } catch { return null; }
}

async function setCache(ticker, data) {
  if (!SUPA_SVC) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/fundamentals_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPA_SVC, Authorization: `Bearer ${SUPA_SVC}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ ticker, data, fetched_at: new Date().toISOString() })
    });
  } catch {}
}

// ───────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });
  const sym = encodeURIComponent(symbol); // Disponible pour tous les endpoints

  // ── PROFILE (secteur / pays pour les camemberts) ──────────────────────
  if (type === 'profile') {
    try {
      const yf = await yfSummary(symbol, 'assetProfile,summaryDetail');
      const p = yf?.assetProfile || {};
      const s = yf?.summaryDetail || {};
      if (!yf) return res.status(404).json({ error: 'Introuvable' });
      return res.json({
        symbol,
        sector:   p.sector   || null,
        industry: p.industry || null,
        country:  p.country  || null,
        mktCap:   s.marketCap?.raw || null,
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── FONDAMENTAUX (100% Yahoo Finance, cache Supabase 24h) ─────────────
  if (type === 'fundamentals') {
    try {
      // Cache Supabase → réponse instantanée si données < 24h
      const cached = await getCache(symbol);
      const cacheValid = cached
        && cached.grossMarginPct !== undefined
        && cached.epsGrowthFwd1Y !== undefined; // invalider si champ prévisionnel absent
      if (cacheValid) return res.json({ ...cached, _fromCache: true });

      // Sinon : Yahoo Finance quoteSummary
      const yf = await yfSummary(symbol, 'defaultKeyStatistics,financialData,summaryDetail,earningsTrend');
      if (!yf) return res.status(404).json({ error: `Pas de données pour ${symbol}` });

      const sd = yf.summaryDetail        || {};
      const fd = yf.financialData        || {};
      const ks = yf.defaultKeyStatistics || {};
      const et = yf.earningsTrend        || {};

      const raw = v => (v?.raw ?? null);
      const pct = v => (v?.raw != null ? v.raw * 100 : null);

      const mktCap    = raw(ks.marketCap) || raw(sd.marketCap);
      const fcf       = raw(fd.freeCashflow);
      const ocf       = raw(fd.operatingCashflow);
      const totalDebt = raw(fd.totalDebt);
      const totalCash = raw(fd.totalCash);
      const ebitda    = raw(ks.ebitda);

      const pfcf = (mktCap && fcf && fcf > 0) ? mktCap / fcf : null;
      const pocf = (mktCap && ocf && ocf > 0) ? mktCap / ocf : null;
      const netDebt = (totalDebt != null && totalCash != null) ? totalDebt - totalCash : null;
      const netDebtToEBITDA = (netDebt != null && ebitda && ebitda > 0) ? netDebt / ebitda : null;

      // Croissance EPS prévisionnelle via earningsTrend
      const trends = et.trend || [];
      const trend1y = trends.find(t => t.period === '+1y');
      const trend5y = trends.find(t => t.period === '5y');
      const epsGrowthFwd1Y = trend1y?.earningsEstimate?.growth?.raw != null
        ? trend1y.earningsEstimate.growth.raw * 100 : null;
      const epsGrowthFwd5Y = trend5y?.earningsEstimate?.growth?.raw != null
        ? trend5y.earningsEstimate.growth.raw * 100 : null;

      const result = {
        symbol,
        trailingPE:      raw(sd.trailingPE),
        forwardPE:       raw(sd.forwardPE),
        pegRatio:        raw(ks.pegRatio),
        pfcf, pocf,
        profitMarginPct:    pct(fd.profitMargins),
        grossMarginPct:     pct(fd.grossMargins),
        operatingMarginPct: pct(fd.operatingMargins),
        returnOnEquity:     pct(fd.returnOnEquity),
        currentRatio:       raw(fd.currentRatio),
        netDebtToEBITDA,
        revenueGrowthYoY:   pct(fd.revenueGrowth),
        epsGrowth1Y:        pct(fd.earningsGrowth),
        epsGrowthFwd1Y,
        epsGrowthFwd5Y,
        freeCashflow: fcf, operatingCashFlow: ocf,
        mktCap, fcfGrowth: null, roic: null,
        timestamp: Date.now(),
      };

      await setCache(symbol, result); // Stocker 24h
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CHART (données brutes pour fiche société, range paramétrable) ────────
  if (type === 'chart') {
    try {
      const rangeParam = req.query.range || '5y';
      const intervalMap = { '1mo':'1d','6mo':'1d','1y':'1d','3y':'1wk','5y':'1wk','10y':'1mo','max':'1mo' };
      const interval = intervalMap[rangeParam] || '1wk';
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${rangeParam}&interval=${interval}&includePrePost=false`, { headers: { 'User-Agent': UA } });
      const d = r.ok ? await r.json() : null;
      const chart = d?.chart?.result?.[0];
      if (!chart) return res.status(404).json({ error: 'No chart data' });
      const closes = chart.indicators?.quote?.[0]?.close || [];
      const times  = chart.timestamp || [];
      const pts = closes.map((c,i) => c != null ? { c: Math.round(c * 100) / 100, t: times[i] } : null).filter(Boolean);
      return res.json({ symbol, chartData: pts });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── PRIX (Yahoo Finance chart v8) ─────────────────────────────────────
  const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  const H    = { headers: { 'User-Agent': UA } };
  try {
    const [r5d, rh] = await Promise.all([
      fetch(`${BASE}${sym}?range=5d&interval=1d&includePrePost=false`, H),
      fetch(`${BASE}${sym}?range=1y&interval=1mo&includePrePost=false`, H),
    ]);
    const d5 = r5d.ok ? await r5d.json() : null;
    const dh = rh.ok  ? await rh.json()  : null;
    const chart = d5?.chart?.result?.[0];
    if (!chart) return res.status(404).json({ error: `Ticker introuvable: ${symbol}` });

    const meta = chart.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    const prev  = meta.previousClose || meta.chartPreviousClose;
    const changeAbs = price - prev;
    const changePct = prev ? (changeAbs / prev) * 100 : 0;

    const hchart = dh?.chart?.result?.[0];
    const closes = hchart?.indicators?.quote?.[0]?.close || [];
    const times  = hchart?.timestamp || [];
    const pts = closes.map((c,i) => c != null ? {c, t:times[i]} : null).filter(Boolean);
    let change1M=null, changeYTD=null, change1Y=null;
    if (pts.length > 0) {
      const now = pts[pts.length-1].c;
      const jan1 = new Date(); jan1.setMonth(0); jan1.setDate(1);
      const ytd = pts.find(e => e.t*1000 >= jan1.getTime());
      if (ytd) changeYTD = ((now - ytd.c) / ytd.c) * 100;
      if (pts.length >= 2)  change1M = ((now - pts[pts.length-2].c) / pts[pts.length-2].c) * 100;
      if (pts.length >= 12) change1Y = ((now - pts[pts.length-12].c) / pts[pts.length-12].c) * 100;
    }
    // Données brutes pour le graphique (12 derniers mois mensuels)
    const chartPts = pts.slice(-13).map(p => ({ c: Math.round(p.c * 100) / 100, t: p.t }));
    return res.json({ symbol, price, prevClose: prev, changeAbs, changePct, change1M, changeYTD, change1Y, currency: meta.currency||'USD', exchange: meta.exchangeName, chartData: chartPts, timestamp: Date.now() });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
