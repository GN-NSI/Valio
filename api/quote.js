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
      const CACHE_V = 10; // v10 = VALIO_SCORING_V2 : alias fy0/fy1, epsFY0/FY1, growth FY1
      const cached = await getCache(symbol);
      const cacheValid = cached
        && cached._v === CACHE_V
        && cached.grossMarginPct !== undefined
        && cached.epsFY0 !== undefined;
      if (cacheValid) return res.json({ ...cached, _fromCache: true });

      // Sinon : Yahoo Finance quoteSummary
      const yf = await yfSummary(symbol, 'defaultKeyStatistics,financialData,summaryDetail,earningsTrend,calendarEvents,assetProfile');
      if (!yf) return res.status(404).json({ error: `Pas de données pour ${symbol}` });

      const sd = yf.summaryDetail        || {};
      const fd = yf.financialData        || {};
      const ks = yf.defaultKeyStatistics || {};
      const et = yf.earningsTrend        || {};
      const cal = yf.calendarEvents      || {};

      // Date des prochains résultats (prochaine publication à venir)
      const earnDates = (cal.earnings && cal.earnings.earningsDate) || [];
      const nowTs = Math.floor(Date.now() / 1000);
      let nextEarningsTs = null;
      for (const d of earnDates) { if (d && d.raw && d.raw >= nowTs) { nextEarningsTs = d.raw; break; } }
      if (nextEarningsTs == null && earnDates.length && earnDates[0] && earnDates[0].raw) nextEarningsTs = earnDates[0].raw;

      const raw = v => (v?.raw ?? null);
      const pct = v => (v?.raw != null ? v.raw * 100 : null);

      const mktCap    = raw(ks.marketCap) || raw(sd.marketCap);
      const sharesOutstanding = raw(ks.sharesOutstanding) || raw(sd.sharesOutstanding);
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
      const revenueGrowthFwd1Y = trend1y?.revenueEstimate?.growth?.raw != null
        ? trend1y.revenueEstimate.growth.raw * 100 : null;

      // ── ESTIMATIONS ANALYSTES PAR PÉRIODE ─────────────────────────────
      const trend0y  = trends.find(t => t.period === '0y');   // exercice fiscal EN COURS (ex: FY2026)
      const trend0q  = trends.find(t => t.period === '0q');  // trimestre en cours
      const trendP1q = trends.find(t => t.period === '+1q'); // trimestre suivant
      const analystEstimates = {
        // Exercice fiscal EN COURS (0y) — ex: FY2026 pour GOOGL
        // C'est le signal le plus pertinent pour la matrice : croissance non-GAAP cohérente
        // (estimation FY en cours vs réel FY précédent). Ex: +31.5% pour GOOGL ($14.22/$10.81)
        thisYear: trend0y ? {
          period:    '0y',
          epsAvg:    trend0y.earningsEstimate?.avg?.raw ?? null,
          epsLow:    trend0y.earningsEstimate?.low?.raw ?? null,
          epsHigh:   trend0y.earningsEstimate?.high?.raw ?? null,
          epsCount:  trend0y.earningsEstimate?.numberOfAnalysts?.raw ?? null,
          epsGrowth: trend0y.earningsEstimate?.growth?.raw != null ? trend0y.earningsEstimate.growth.raw * 100 : null,
          revAvg:    trend0y.revenueEstimate?.avg?.raw ?? null,
          revLow:    trend0y.revenueEstimate?.low?.raw ?? null,
          revHigh:   trend0y.revenueEstimate?.high?.raw ?? null,
          revGrowth: trend0y.revenueEstimate?.growth?.raw != null ? trend0y.revenueEstimate.growth.raw * 100 : null,
        } : null,
        // Trimestre en cours
        currentQtr: trend0q ? {
          period:       trend0q.period,
          endDate:      trend0q.endDate || null,
          epsAvg:       trend0q.earningsEstimate?.avg?.raw ?? null,
          epsLow:       trend0q.earningsEstimate?.low?.raw ?? null,
          epsHigh:      trend0q.earningsEstimate?.high?.raw ?? null,
          epsCount:     trend0q.earningsEstimate?.numberOfAnalysts?.raw ?? null,
          epsGrowth:    trend0q.earningsEstimate?.growth?.raw != null ? trend0q.earningsEstimate.growth.raw * 100 : null,
          revGrowth:    trend0q.revenueEstimate?.growth?.raw != null ? trend0q.revenueEstimate.growth.raw * 100 : null,
          revAvg:       trend0q.revenueEstimate?.avg?.raw ?? null,
          revLow:       trend0q.revenueEstimate?.low?.raw ?? null,
          revHigh:      trend0q.revenueEstimate?.high?.raw ?? null,
        } : null,
        // Trimestre suivant
        nextQtr: trendP1q ? {
          period:       trendP1q.period,
          endDate:      trendP1q.endDate || null,
          epsAvg:       trendP1q.earningsEstimate?.avg?.raw ?? null,
          epsLow:       trendP1q.earningsEstimate?.low?.raw ?? null,
          epsHigh:      trendP1q.earningsEstimate?.high?.raw ?? null,
          epsCount:     trendP1q.earningsEstimate?.numberOfAnalysts?.raw ?? null,
          epsGrowth:    trendP1q.earningsEstimate?.growth?.raw != null ? trendP1q.earningsEstimate.growth.raw * 100 : null,
          revGrowth:    trendP1q.revenueEstimate?.growth?.raw != null ? trendP1q.revenueEstimate.growth.raw * 100 : null,
          revAvg:       trendP1q.revenueEstimate?.avg?.raw ?? null,
          revLow:       trendP1q.revenueEstimate?.low?.raw ?? null,
          revHigh:      trendP1q.revenueEstimate?.high?.raw ?? null,
        } : null,
        // Exercice suivant (+1y) — ex: FY2027 pour GOOGL
        currentYear: trend1y ? {
          epsAvg:    trend1y.earningsEstimate?.avg?.raw ?? null,
          epsLow:    trend1y.earningsEstimate?.low?.raw ?? null,
          epsHigh:   trend1y.earningsEstimate?.high?.raw ?? null,
          epsCount:  trend1y.earningsEstimate?.numberOfAnalysts?.raw ?? null,
          epsGrowth: trend1y.earningsEstimate?.growth?.raw != null ? trend1y.earningsEstimate.growth.raw * 100 : null,
          revAvg:    trend1y.revenueEstimate?.avg?.raw ?? null,
          revLow:    trend1y.revenueEstimate?.low?.raw ?? null,
          revHigh:   trend1y.revenueEstimate?.high?.raw ?? null,
          revGrowth: trend1y.revenueEstimate?.growth?.raw != null ? trend1y.revenueEstimate.growth.raw * 100 : null,
          count:     trend1y.earningsEstimate?.numberOfAnalysts?.raw ?? null,
        } : null,
      };

      // ── COURS CIBLE ET RECOMMANDATION ANALYSTES ───────────────────────
      const targetMeanPrice  = raw(fd.targetMeanPrice);
      const targetHighPrice  = raw(fd.targetHighPrice);
      const targetLowPrice   = raw(fd.targetLowPrice);
      const analystCount     = raw(fd.numberOfAnalystOpinions);
      const recommendationMean = raw(fd.recommendationMean);
      const recommendationKey  = fd.recommendationKey || null;

      // ── SECTEUR & INDUSTRIE (pour comparaison vs secteur) ─────────────
      const ap = yf.assetProfile || {};
      const sector   = ap.sector   || null;
      const industry = ap.industry || null;

      const result = {
        symbol, _v: CACHE_V,
        trailingPE:      raw(sd.trailingPE),
        // Forward PE NTM calculé manuellement : cours / EPS forward consensus
        // sd.forwardPE de Yahoo utilise l'EPS GAAP fiscal (fausse la valeur pour NVDA etc.)
        // On préfère : cours / avg(earningsTrend année en cours) si disponible
        forwardPE: (function(){
          // EPS forward = moyenne analystes année en cours (earningsTrend '0y' ou '1y')
          var epsFwd = trend1y && trend1y.earningsEstimate && trend1y.earningsEstimate.avg
            ? trend1y.earningsEstimate.avg.raw : null;
          if(epsFwd && epsFwd > 0) {
            var px = raw(sd.regularMarketPrice) || raw(sd.previousClose);
            if(px && px > 0) return Math.round((px / epsFwd) * 10) / 10;
          }
          // Fallback sur sd.forwardPE si earningsTrend indispo
          return raw(sd.forwardPE);
        })(),
        pegRatio:        raw(ks.pegRatio),
        pfcf, pocf,
        profitMarginPct:    pct(fd.profitMargins),
        grossMarginPct:     pct(fd.grossMargins),
        operatingMarginPct: pct(fd.operatingMargins),
        returnOnEquity:     pct(fd.returnOnEquity),
        returnOnAssets:     pct(fd.returnOnAssets),
        currentRatio:       raw(fd.currentRatio),
        netDebtToEBITDA,
        revenueGrowthYoY:   pct(fd.revenueGrowth),
        epsGrowth1Y:        pct(fd.earningsGrowth),
        epsGrowthFwd1Y,
        // ── VALIO_SCORING_V2 : sémantique explicite FY0 / FY1 ────────────────
        // FY0 = exercice fiscal EN COURS · FY1 = exercice SUIVANT.
        // Évite l'ambiguïté du « forward PE » qui pouvait désigner l'un ou l'autre.
        epsFY0: trend0y?.earningsEstimate?.avg?.raw ?? null,
        epsFY1: trend1y?.earningsEstimate?.avg?.raw ?? null,
        epsGrowthFY0: trend0y?.earningsEstimate?.growth?.raw != null ? trend0y.earningsEstimate.growth.raw*100 : null,
        epsGrowthFY1: trend1y?.earningsEstimate?.growth?.raw != null ? trend1y.earningsEstimate.growth.raw*100 : null,
        revenueFY0: trend0y?.revenueEstimate?.avg?.raw ?? null,
        revenueFY1: trend1y?.revenueEstimate?.avg?.raw ?? null,
        revenueGrowthFY1: trend1y?.revenueEstimate?.growth?.raw != null ? trend1y.revenueEstimate.growth.raw*100 : null,
        epsGrowthFwd5Y,
        revenueGrowthFwd1Y,
        freeCashflow: fcf, operatingCashFlow: ocf,
        mktCap, sharesOutstanding, fcfGrowth: null, roic: null,
        nextEarningsTs,
        // Nouvelles données analystes
        analystEstimates,
        targetMeanPrice, targetHighPrice, targetLowPrice,
        analystCount, recommendationMean, recommendationKey,
        sector, industry,
        timestamp: Date.now(),
      };

      await setCache(symbol, result); // Stocker 24h
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }


  // ── FINANCIALS (income statement, cashflow, bilan annuels) ──────────────
  if (type === 'financials') {
    const finKey = symbol + '_fin';
    const FIN_V = 4; // requête combinée + fallbacks séquentiels si modules vides
    try {
      const cachedFin = await getCache(finKey);
      if (cachedFin && cachedFin._v === FIN_V && cachedFin.years && cachedFin.years.length)
        return res.json({ ...cachedFin, _fromCache: true });
    } catch(e) {}
    try {
      // Requête combinée (rapide) + fallbacks séquentiels si modules manquants
      const yf = await yfSummary(symbol, 'incomeStatementHistory,cashflowStatementHistory,balanceSheetHistory');
      if (!yf) return res.status(404).json({ error: 'No financial data' });

      const raw = v => v?.raw ?? null;
      const sc  = v => v != null ? Math.round(v / 1e8) / 10 : null;

      const stmt = [...(yf?.incomeStatementHistory?.incomeStatementHistory || [])].reverse();
      let cf     = [...(yf?.cashflowStatementHistory?.cashflowStatements   || [])].reverse();
      let bs     = [...(yf?.balanceSheetHistory?.balanceSheetStatements    || [])].reverse();

      // Fallbacks individuels si le combiné n'a pas retourné les données
      if (!cf.length || !cf.some(s => raw(s.totalCashFromOperatingActivities) != null)) {
        try {
          const yf2 = await yfSummary(symbol, 'cashflowStatementHistory');
          const cf2 = [...(yf2?.cashflowStatementHistory?.cashflowStatements || [])].reverse();
          if (cf2.length) cf = cf2;
        } catch(e2) {}
      }
      if (!bs.length || !bs.some(s => raw(s.totalStockholderEquity) != null)) {
        try {
          const yf3 = await yfSummary(symbol, 'balanceSheetHistory');
          const bs2 = [...(yf3?.balanceSheetHistory?.balanceSheetStatements || [])].reverse();
          if (bs2.length) bs = bs2;
        } catch(e3) {}
      }

      const years = stmt.map(s => {
        const ts = raw(s.endDate);
        return ts ? 'FY' + new Date(ts * 1000).getFullYear() : '?';
      });
      const m = (arr, fn) => arr.map(fn);

      const result = {
        symbol, _v: FIN_V, years,  // FIN_V=4
        revenue:         m(stmt, s => sc(raw(s.totalRevenue))),
        // grossProfit: fallback sur costOfRevenue si null ou 0
        grossProfit:     m(stmt, s => {
          const gp = raw(s.grossProfit);
          if(gp != null && gp !== 0) return sc(gp);
          const rev = raw(s.totalRevenue), cogs = raw(s.costOfRevenue);
          return (rev != null && cogs != null) ? sc(rev - cogs) : null;
        }),
        // operatingIncome: plusieurs fallbacks
        operatingIncome: m(stmt, s => {
          const oi = raw(s.operatingIncome) ?? raw(s.ebit);
          if(oi != null && oi !== 0) return sc(oi);
          const gp  = raw(s.grossProfit) ?? (raw(s.totalRevenue) && raw(s.costOfRevenue) ? raw(s.totalRevenue) - raw(s.costOfRevenue) : null);
          const rd  = raw(s.researchDevelopment) || 0;
          const sga = raw(s.sellingGeneralAdministrative) || 0;
          return gp != null ? sc(gp - rd - sga) : null;
        }),
        netIncome:       m(stmt, s => sc(raw(s.netIncome))),
        eps:             m(stmt, s => raw(s.dilutedEps) ?? raw(s.basicEps)),
        rd:              m(stmt, s => sc(raw(s.researchDevelopment))),
        sga:             m(stmt, s => sc(raw(s.sellingGeneralAdministrative))),
        operatingCF:     m(cf,   s => sc(raw(s.totalCashFromOperatingActivities) ?? raw(s.operatingCashflow))),
        capex:           m(cf,   s => sc(raw(s.capitalExpenditures))),
        freeCF:          m(cf,   s => {
          const ocf = raw(s.totalCashFromOperatingActivities) ?? raw(s.operatingCashflow);
          const cx  = raw(s.capitalExpenditures);
          return ocf != null ? sc(ocf + (cx ?? 0)) : null;
        }),
        equity:          m(bs,   s => {
          const eq = raw(s.totalStockholderEquity);
          if(eq != null) return sc(eq);
          const a = raw(s.totalAssets), l = raw(s.totalLiab);
          return (a != null && l != null) ? sc(a - l) : null;
        }),
        totalDebt:       m(bs,   s => sc(
          raw(s.longTermDebt) ??
          raw(s.longTermDebtAndCapitalLeaseObligation) ??
          raw(s.totalDebt) ??
          (raw(s.totalLiab) && raw(s.totalCurrentLiabilities) ? raw(s.totalLiab) - raw(s.totalCurrentLiabilities) : null)
        )),
      };
      await setCache(finKey, result);
      return res.json(result);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── FINANCIALS QUARTERLY (résultats trimestriels) ──────────────────────
  if (type === 'financials_quarterly') {
    try {
      const yf = await yfSummary(symbol, 'incomeStatementHistoryQuarterly,cashflowStatementHistoryQuarterly');
      if (!yf) return res.status(404).json({ error: 'No quarterly data' });
      const raw = v => v?.raw ?? null;
      const sc  = v => v != null ? Math.round(v / 1e8) / 10 : null;
      const stmt = [...(yf?.incomeStatementHistoryQuarterly?.incomeStatementHistory || [])].reverse();
      const cf   = [...(yf?.cashflowStatementHistoryQuarterly?.cashflowStatements  || [])].reverse();
      // Build quarter labels: "FY25 Q3" etc.
      const quarters = stmt.map(s => {
        const ts = raw(s.endDate);
        if (!ts) return '?';
        const d = new Date(ts * 1000);
        const yr = String(d.getFullYear()).slice(2);
        const mo = d.getMonth() + 1;
        const q = mo <= 3 ? 'Q1' : mo <= 6 ? 'Q2' : mo <= 9 ? 'Q3' : 'Q4';
        return q + "'"+yr;
      });
      const m = (arr, fn) => arr.map(fn);
      return res.json({
        symbol, quarters,
        revenue:     m(stmt, s => sc(raw(s.totalRevenue))),
        grossProfit: m(stmt, s => { const gp=raw(s.grossProfit); if(gp!=null&&gp!==0)return sc(gp); const rev=raw(s.totalRevenue),cogs=raw(s.costOfRevenue); return (rev!=null&&cogs!=null)?sc(rev-cogs):null; }),
        netIncome:   m(stmt, s => sc(raw(s.netIncome))),
        eps:         m(stmt, s => raw(s.dilutedEps) ?? raw(s.basicEps)),
        operatingCF: m(cf,   s => sc(raw(s.totalCashFromOperatingActivities) ?? raw(s.operatingCashflow))),
        capex:       m(cf,   s => sc(raw(s.capitalExpenditures))),
        freeCF:      m(cf,   s => { const ocf=raw(s.totalCashFromOperatingActivities)??raw(s.operatingCashflow); const cx=raw(s.capitalExpenditures); return ocf!=null?sc(ocf+(cx??0)):null; }),
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── AI AUTOFILL — Extraction automatique des résultats non-GAAP ──────────
  if (type === 'autofill') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY_MISSING',
      hint: "Ajoutez ANTHROPIC_API_KEY dans les variables Vercel" });

    const period = req.query.period || '';
    // Convertir période → texte lisible pour le prompt
    const qm = period.match(/^(\d{4})-(Q[1-4])$/);
    const fm = period.match(/^FY(\d{4})$/);
    const periodHuman = qm ? `Q${qm[2][1]} ${qm[1]}` : fm ? `fiscal year ${fm[1]}` : period;

    const prompt = `Search for the official earnings press release for ${symbol} for ${periodHuman}.

Extract and return ONLY a valid JSON object (no markdown, no extra text):
{
  "revenue": <total revenue in billions USD, GAAP — e.g. 44.1>,
  "gross_margin_pct": <gross margin in %, e.g. 57.2>,
  "gross_profit": <gross profit in billions, or null>,
  "operating_income": <NON-GAAP operating income in billions, or null>,
  "net_income": <NON-GAAP net income in billions — excludes SBC, acquisition amortization>,
  "net_margin_pct": <NON-GAAP net margin %, or null>,
  "eps_diluted": <NON-GAAP diluted EPS in USD, e.g. 4.93>,
  "ocf": <operating cash flow in billions — usually GAAP, or null>,
  "capex": <capital expenditures in billions — positive number, or null>,
  "fcf": <free cash flow in billions, or null>,
  "segments": [{"name": "Segment Name", "value": <revenue in billions>}] or null,
  "currency": "USD",
  "source": "<exact URL of the press release used>"
}

Rules:
- revenue is ALWAYS GAAP (non-GAAP revenue is extremely rare)
- net_income and eps_diluted: use NON-GAAP (NVIDIA calls it non-GAAP net income, MSFT same)
- For companies without explicit non-GAAP (Apple, French/Korean companies): use GAAP, set is_gaap_fallback: true
- Segments: use the revenue breakdown table if present in the press release
- Return null for any field you cannot find with confidence — do NOT guess
- All monetary values in BILLIONS of the reporting currency`;

    try {
      let messages = [{ role: 'user', content: prompt }];
      let finalText = null;

      // Agentic loop — handle web search tool turns
      for (let iter = 0; iter < 6; iter++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages
          })
        });
        if (!r.ok) throw new Error('Anthropic API error ' + r.status);
        const d = await r.json();

        // Collect any text block
        const tb = d.content?.find(b => b.type === 'text');
        if (tb) finalText = tb.text;

        if (d.stop_reason === 'end_turn') break;

        if (d.stop_reason === 'tool_use') {
          // Continue conversation with empty tool results (Anthropic handles the search)
          messages.push({ role: 'assistant', content: d.content });
          const toolResults = (d.content || [])
            .filter(b => b.type === 'tool_use')
            .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
          if (!toolResults.length) break;
          messages.push({ role: 'user', content: toolResults });
        } else break;
      }

      if (!finalText) throw new Error('No API response');

      // Extract JSON from response (strip markdown fences if present)
      const clean = finalText.replace(/```json|```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response: ' + finalText.slice(0, 200));
      const data = JSON.parse(jsonMatch[0]);
      return res.json({ ok: true, data });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
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
      // adjclose = ajusté splits + dividendes → corrige les reverse-splits (ex: SIVE.ST)
      const rawC = chart.indicators?.quote?.[0]?.close || [];
      const adjC = chart.indicators?.adjclose?.[0]?.adjclose;
      const closes = (adjC && adjC.length === rawC.length && adjC.some(v => v != null)) ? adjC : rawC;
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
    // Utiliser la vraie clôture J-1 depuis le tableau des closes 5d
    // (meta.chartPreviousClose peut être la clôture de la semaine précédente pour certains marchés)
    const closes5d  = chart?.indicators?.adjclose?.[0]?.adjclose || chart?.indicators?.quote?.[0]?.close || [];
    const times5d   = chart?.timestamp || [];
    const today     = Math.floor(Date.now() / 1000);
    const dayAgo    = today - 86400;
    // Trouver la dernière clôture datant d'avant aujourd'hui
    let prevFromChart = null;
    for (let i = closes5d.length - 1; i >= 0; i--) {
      if (times5d[i] < dayAgo - 3600 && closes5d[i] != null) { prevFromChart = closes5d[i]; break; }
    }
    const prev  = prevFromChart || meta.previousClose || meta.chartPreviousClose;
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
