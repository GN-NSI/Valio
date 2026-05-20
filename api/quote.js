// ═══ VALIO — quote.js (Version Multiples Avancés & Profil Quantitatif) ═══
// Source unique de données : Yahoo Finance sans quota

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  if (type === 'fundamentals') {
    try {
      const yf = await yfSummary(symbol, 'defaultKeyStatistics,financialData,summaryDetail,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory');
      if (!yf) return res.status(404).json({ error: `Pas de données pour ${symbol}` });

      const sd = yf.summaryDetail        || {};
      const fd = yf.financialData        || {};
      const ks = yf.defaultKeyStatistics || {};
      
      const incHist = yf.incomeStatementHistory?.incomeStatementHistory || [];
      const balHist = yf.balanceSheetHistory?.balanceSheetHistory || [];
      const cfHist  = yf.cashflowStatementHistory?.cashflowStatementHistory || [];

      const raw = v => (v?.raw ?? null);
      const pct = v => (v?.raw != null ? v.raw * 100 : null);

      const mktCap    = raw(ks.marketCap) || raw(sd.marketCap);
      const fcf       = raw(fd.freeCashflow);
      const ocf       = raw(fd.operatingCashflow);
      const totalDebt = raw(fd.totalDebt);
      const totalCash = raw(fd.totalCash);
      const ebitda    = raw(ks.ebitda);

      // Calcul des multiples exacts demandés par l'utilisateur pour le screener
      const pfcf = (mktCap && fcf && fcf > 0) ? mktCap / fcf : null;
      const pocf = (mktCap && ocf && ocf > 0) ? mktCap / ocf : null;
      const netDebt = (totalDebt != null && totalCash != null) ? totalDebt - totalCash : null;
      const netDebtToEBITDA = (netDebt != null && ebitda && ebitda > 0) ? netDebt / ebitda : null;

      // Algorithme de calcul du ROIC Réel
      let calculatedRoic = null;
      if (incHist.length > 0 && balHist.length > 0) {
        const currentInc = incHist[0];
        const currentBal = balHist[0];
        const ebit = raw(currentInc.operatingIncome);
        const taxExpense = raw(currentInc.taxProvision) || 0;
        const ebt = raw(currentInc.incomeBeforeTax) || 1;
        const taxRate = ebt > 0 ? Math.max(0, Math.min(0.5, taxExpense / ebt)) : 0.25;
        const nopat = ebit !== null ? ebit * (1 - taxRate) : null;
        const equity = raw(currentBal.totalStockholderEquity);
        const shortDebt = raw(currentBal.shortLongTermDebt) || 0;
        const longDebt = raw(currentBal.longTermDebt) || 0;
        const cash = raw(currentBal.cash) || 0;
        const investedCapital = (equity !== null) ? (equity + shortDebt + longDebt - cash) : null;
        if (nopat !== null && investedCapital && investedCapital > 0) {
          calculatedRoic = (nopat / investedCapital) * 100;
        }
      }

      let calculatedFcfGrowth = null;
      if (cfHist.length >= 2) {
        const fcfRecent = raw(cfHist[0].freeCashflow);
        const fcfAncien = raw(cfHist[1].freeCashflow);
        if (fcfAncien && fcfAncien > 0 && fcfRecent !== null) {
          calculatedFcfGrowth = ((fcfRecent - fcfAncien) / fcfAncien) * 100;
        }
      }

      return res.json({
        symbol,
        trailingPE: raw(sd.trailingPE),
        forwardPE:  raw(sd.forwardPE),
        pegRatio:   raw(ks.pegRatio),
        pfcf,
        pocf,
        profitMarginPct:    pct(fd.profitMargins),
        grossMarginPct:     pct(fd.grossMargins),
        operatingMarginPct: pct(fd.operatingMargins),
        returnOnEquity:     pct(fd.returnOnEquity),
        netDebtToEBITDA,
        revenueGrowthYoY:   pct(fd.revenueGrowth),
        epsGrowth1Y:        pct(fd.earningsGrowth),
        freeCashflow: fcf,
        roic: calculatedRoic,
        fcfGrowth: calculatedFcfGrowth,
        timestamp: Date.now()
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // Comportement par défaut pour le prix et les graphiques de la fiche
  if (type === 'chart') {
    try {
      const rangeParam = req.query.range || '5y';
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${rangeParam}&interval=1wk&includePrePost=false`, { headers: { 'User-Agent': UA } });
      const d = await r.json();
      const chart = d?.chart?.result?.[0];
      const closes = chart?.indicators?.quote?.[0]?.close || [];
      const times  = chart?.timestamp || [];
      const pts = closes.map((c,i) => c != null ? { c, t: times[i] } : null).filter(Boolean);
      return res.json({ symbol, chartData: pts });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`, { headers: { 'User-Agent': UA } });
    const d = await r.json();
    const chart = d?.chart?.result?.[0];
    if (!chart) return res.status(404).json({ error: 'Ticker introuvable' });
    const meta = chart.meta;
    return res.json({ symbol, price: meta.regularMarketPrice, currency: meta.currency || 'USD' });
  } catch(e) { return res.status(500).json({ error: e.message }); }
};
