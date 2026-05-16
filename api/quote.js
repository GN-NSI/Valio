module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol requis' });

  // ── MODE PROFILE (secteur, pays, capitalisation) ─────────────────────
  if (type === 'profile') {
    const FMP_KEY = 'yrFxAuUHv6XgKGxfXol6sGWVxmEq6tBr';
    try {
      const r = await fetch(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`);
      const d = r.ok ? await r.json() : null;
      const p = Array.isArray(d) ? d[0] : d;
      if (!p || !p.symbol) return res.status(404).json({ error: `Profile introuvable pour ${symbol}` });
      return res.json({ symbol, sector: p.sector||null, industry: p.industry||null, country: p.country||null, mktCap: p.mktCap||null, isEtf: p.isEtf||false, currency: p.currency||null });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }


  // ── MODE FUNDAMENTALS ──────────────────────────────────────────────
  if (type === 'fundamentals') {
    const FMP_KEY = 'yrFxAuUHv6XgKGxfXol6sGWVxmEq6tBr';
    try {
      const [rMetrics, rRatios, rCF, rEst] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&limit=2&apikey=${FMP_KEY}`),
        fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=annual&limit=10&apikey=${FMP_KEY}`)
      ]);
      const metricsData = rMetrics.ok ? await rMetrics.json() : [];
      const ratiosData  = rRatios.ok  ? await rRatios.json()  : [];
      const m = Array.isArray(metricsData) ? metricsData[0] : metricsData;
      const r = Array.isArray(ratiosData)  ? ratiosData[0]  : ratiosData;
      if (!m && !r) return res.status(404).json({ error: `Données introuvables pour ${symbol}` });
      let epsForward = null;
      if (rEst.ok) {
        const estData = await rEst.json();
        if (Array.isArray(estData)) {
          const today = new Date();
          const nineMonths = new Date(today.getTime() + 9*30*24*60*60*1000);
          const nextFY = estData.filter(e => new Date(e.date) > nineMonths && e.epsAvg > 0).sort((a,b) => new Date(a.date)-new Date(b.date))[0];
          if (!nextFY) {
            const fallback = estData.filter(e => new Date(e.date) > today && e.epsAvg > 0).sort((a,b) => new Date(a.date)-new Date(b.date))[0];
            if (fallback) epsForward = fallback.epsAvg;
          } else { epsForward = nextFY.epsAvg; }
        }
      }
      let fcfGrowth=null,fcf0=null,cfo0=null,capex0=null;
      if (rCF.ok) {
        const cfData = await rCF.json();
        if (Array.isArray(cfData) && cfData.length >= 2) {
          fcf0=cfData[0]?.freeCashFlow||null; cfo0=cfData[0]?.operatingCashFlow||null; capex0=cfData[0]?.capitalExpenditure||null;
          const fcf1=cfData[1]?.freeCashFlow||null;
          if (fcf0&&fcf1&&fcf1!==0) fcfGrowth=((fcf0-fcf1)/Math.abs(fcf1))*100;
        } else if (Array.isArray(cfData)&&cfData.length===1) {
          fcf0=cfData[0]?.freeCashFlow||null; cfo0=cfData[0]?.operatingCashFlow||null; capex0=cfData[0]?.capitalExpenditure||null;
        }
      }
      return res.json({
        symbol, trailingPE:r?.priceToEarningsRatioTTM||null, epsForward,
        currentPriceUSD:m?.stockPriceTTM||null, pegRatio:r?.priceToEarningsGrowthRatioTTM||null,
        profitMarginPct:r?.netProfitMarginTTM?r.netProfitMarginTTM*100:null,
        freeCashflow:fcf0, operatingCashFlow:cfo0, capex:capex0?Math.abs(capex0):null,
        capexToCFO:cfo0&&capex0&&cfo0!==0?(Math.abs(capex0)/cfo0)*100:null,
        fcfGrowth, pfcf:r?.priceToFreeCashFlowRatioTTM||null, mktCap:m?.marketCap||null,
        returnOnEquity:m?.returnOnEquityTTM?m.returnOnEquityTTM*100:null,
        freeCashFlowYield:m?.freeCashFlowYieldTTM?m.freeCashFlowYieldTTM*100:null,
        timestamp:Date.now()
      });
    } catch(err) { return res.status(500).json({error:err.message}); }
  }

  // ── MODE COURS ─────────────────────────────────────────────────────
  try {
    const safeSym = symbol.replace(/%5E/gi,'^').replace(/%3D/gi,'=');
    const range = req.query.range || '1y';

    const fetchOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com'
      }
    };

    // Appel principal : range demandé (1y par défaut) avec interval 1d
    // meta.regularMarketPrice = cours actuel
    // meta.chartPreviousClose = close J-1 RÉEL (fiable sur range >= 5d)
    // Pour la variation journalière on fait un 2ème appel sur 5d qui est plus fiable
    const url5d   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(safeSym)}?interval=1d&range=5d`;
    const urlHist = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(safeSym)}?interval=1d&range=${range}`;

    const [r5d, rHist] = await Promise.all([
      fetch(url5d, fetchOpts),
      fetch(urlHist, fetchOpts)
    ]);

    if (!r5d.ok && !rHist.ok) return res.status(502).json({ error: 'Yahoo Finance indisponible' });

    // Extraire prix et variation J depuis l'appel 5d
    let price=null, changeAbs=null, changePct=null, prevClose=null, currency='USD', exchange='';

    const parse5d = r5d.ok ? await r5d.json() : null;
    const meta5d = parse5d?.chart?.result?.[0]?.meta;

    if (meta5d) {
      price    = meta5d.regularMarketPrice || null;
      currency = meta5d.currency || 'USD';
      exchange = meta5d.exchangeName || '';

      // Reconstituer le vrai J-1 depuis les closes du range 5d
      const result5d = parse5d?.chart?.result?.[0];
      const ts5d     = result5d?.timestamp || [];
      const cl5d     = result5d?.indicators?.quote?.[0]?.close || [];

      // Filtrer les closes valides et triés
      const validDays = ts5d
        .map((t, i) => ({ ts: t, close: cl5d[i] }))
        .filter(d => d.close != null)
        .sort((a, b) => a.ts - b.ts);

      const nowTs = Date.now() / 1000;
      // Le close J-1 = dernier close avant le cours actuel (avant aujourd'hui)
      const today0h = new Date(); today0h.setHours(0,0,0,0);
      const today0hTs = today0h.getTime() / 1000;

      const prevDays = validDays.filter(d => d.ts < today0hTs);
      if (prevDays.length > 0) {
        prevClose = prevDays[prevDays.length - 1].close;
      } else if (validDays.length >= 2) {
        // Fallback : avant-dernier point
        prevClose = validDays[validDays.length - 2].close;
      } else {
        prevClose = meta5d.chartPreviousClose || meta5d.previousClose || null;
      }

      if (price && prevClose) {
        changeAbs = price - prevClose;
        changePct = ((price - prevClose) / prevClose) * 100;
      }
    }

    // Fallback prix depuis hist si 5d a échoué
    if (!price && rHist.ok) {
      const parseHist = await rHist.json();
      const metaH = parseHist?.chart?.result?.[0]?.meta;
      if (metaH) {
        price    = metaH.regularMarketPrice || metaH.previousClose || null;
        currency = metaH.currency || 'USD';
        exchange = metaH.exchangeName || '';
        prevClose = metaH.chartPreviousClose || metaH.previousClose || null;
        if (price && prevClose) { changeAbs = price - prevClose; changePct = ((price-prevClose)/prevClose)*100; }
      }
    }

    if (!price) return res.status(404).json({ error: `Cours introuvable pour ${symbol}` });

    // Variations multi-périodes depuis hist
    let change1M=null, changeYTD=null, change1Y=null;
    if (rHist.ok) {
      // Si déjà consommé pour fallback, re-fetch (rare)
      let parseHist2;
      try { parseHist2 = await rHist.json(); } catch(e) { parseHist2 = null; }
      const result = parseHist2?.chart?.result?.[0];
      if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
        const timestamps = result.timestamp;
        const closes     = result.indicators.quote[0].close;
        const now        = Date.now() / 1000;
        const findClose  = ts => {
          let best=null, bestDiff=Infinity;
          timestamps.forEach((t,i)=>{ const d=Math.abs(t-ts); if(d<bestDiff&&closes[i]!=null){best=closes[i];bestDiff=d;} });
          return best;
        };
        const c1M  = findClose(now - 30*24*3600);
        const cYTD = findClose(new Date(new Date().getFullYear(),0,1).getTime()/1000);
        const c1Y  = findClose(now - 365*24*3600);
        if (c1M  && price) change1M  = ((price-c1M) /c1M) *100;
        if (cYTD && price) changeYTD = ((price-cYTD)/cYTD)*100;
        if (c1Y  && price) change1Y  = ((price-c1Y) /c1Y) *100;
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.json({ symbol, price, prevClose, changeAbs, changePct, change1M, changeYTD, change1Y, currency, exchange, timestamp:Date.now() });

  } catch(err) { return res.status(500).json({error:err.message}); }
};
