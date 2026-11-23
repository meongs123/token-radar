// Token Radar dashboard: reads window.RADAR (main.ts writes it beside
// dashboard/) and renders the board, filters, detail view and comps. No network.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(days) { if (days === null || days === undefined) return 'unknown'; if (days >= 365) return (days / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(days)) + 'd'; }
  function fmtMult(n) { return (Math.round(n * 100) / 100).toFixed(2) + 'x'; }
  function fmtRatio(n) { if (!isFinite(n)) return 'n/a'; return (n < 0.1 ? n.toFixed(3) : (Math.round(n * 100) / 100).toFixed(2)) + 'x'; }
  function hasRange(r) { return r.implied_low_usd !== null && r.implied_low_usd !== undefined && r.implied_high_usd !== null && r.implied_high_usd !== undefined; }
  function fmtRange(r) { if (!hasRange(r)) return fmtUsd(r.implied_value_usd); return fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '', abs = Math.abs(n);
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'K';
    return sign + '$' + abs.toFixed(2);
  }
  function fmtDollars(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // The model in one function, first in this file so the dossier text
  // never cuts it: the page recomputes a row and checks the number
  // board.json carries.
  function curveFactorOf(category) {
    if (!category) return 1;
    for (var i = 0; i < (DATA.comps || []).length; i++) if (DATA.comps[i].category === category) return DATA.comps[i].curve_factor === undefined || DATA.comps[i].curve_factor === null ? 1 : DATA.comps[i].curve_factor;
    return 1;
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight, age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_extra) * model.breadth_per_chain;
    var curve = Math.pow(10, DATA.size_curve.intercept) * Math.pow(Math.max(1, row.tvl_usd), DATA.size_curve.slope);
    return Math.max(1, Math.round(curve * curveFactorOf(row.category) * growthMult * maturity * breadth));
  }

  function gasTxUsd(chain) {
    var g = DATA.farm.gas_tx, c = (chain || '').toLowerCase(), k;
    for (k in g) { if (k !== 'other' && c.indexOf(k) >= 0) return g[k]; }
    return g.other;
  }
  function firstChainOf(p) { return (p.chains && p.chains.length) ? p.chains[0] : ''; }
  function fmtGas(n) { return n % 1 === 0 ? '$' + n : '$' + n.toFixed(2); }

  function gasRateOf(row) {
    var f = DATA.farm, txGas = gasTxUsd(firstChainOf(row)), hold = holdDaysFor(row.age_days), weeks = Math.floor(hold / 7);
    return { gas: (f.gas_funding_txs + f.gas_deposit_claim_txs + f.gas_weekly_txs * weeks) * txGas, rate: f.share * (row.implied_value_usd / Math.max(1, row.tvl_usd)) - f.tbill_rate * (hold / 365) };
  }
  function paysExactOf(row) { var gr = gasRateOf(row); return gr.rate > 0 ? gr.gas / gr.rate : null; }
  function planCapitalOf(row) {
    var tier = tierCapitalFor(row), pays = paysExactOf(row);
    if (pays === null || pays > DATA.farm.ticket_usd) return tier;
    var deposit = Math.max(tier, Math.ceil(pays / 25) * 25), gr = gasRateOf(row);
    // Lift by $25 steps while unrounded net is below $0.10 — mirrors planCapitalFor in lib/model.ts.
    if (gr.rate > 0) { while (deposit < DATA.farm.ticket_usd && deposit * gr.rate - gr.gas < 0.10) deposit += 25; }
    return deposit;
  }
  function ticketOf(row) {
    var f = DATA.farm, chain = firstChainOf(row), txGas = gasTxUsd(chain), hold = holdDaysFor(row.age_days), weeks = Math.floor(hold / 7);
    var funding = f.gas_funding_txs * txGas, depClaim = f.gas_deposit_claim_txs * txGas, weekly = f.gas_weekly_txs * txGas;
    var gas = funding + depClaim + weekly * weeks, forgone = f.ticket_usd * f.tbill_rate * (hold / 365), tvl = Math.max(1, row.tvl_usd);
    var slice = (f.ticket_usd * f.share * row.implied_value_usd) / tvl, net = slice - gas - forgone, minutes = 55 + 10 * weeks, netPerHour = net / (minutes / 60);
    var rate = f.share * (row.implied_value_usd / tvl) - f.tbill_rate * (hold / 365), paysExact = rate > 0 ? gas / rate : null, deposit = planCapitalOf(row);
    var depositSlice = (deposit * f.share * row.implied_value_usd) / tvl, depositForgone = deposit * f.tbill_rate * (hold / 365), depositNet = depositSlice - gas - depositForgone;
    return {
      ticket_usd: f.ticket_usd, slice_usd: round2(slice), gas_usd: round2(gas),
      gas_funding_usd: round2(funding), gas_weekly_usd: round2(weekly), gas_deposit_claim_usd: round2(depClaim), gas_chain: chain, gas_tx_usd: round2(txGas), forgone_usd: round2(forgone),
      net_usd: round2(net), net_per_hour_usd: round2(netPerHour), verdict: net > 0 ? 'FARM' : slice - gas > 0 ? 'THIN' : 'SKIP', pays_from_usd: paysExact === null ? null : Math.round(paysExact), hold_days: hold,
      deposit_usd: deposit, deposit_slice_usd: round2(depositSlice), deposit_forgone_usd: round2(depositForgone), deposit_net_usd: round2(depositNet), deposit_net_per_hour_usd: round2(depositNet / (minutes / 60))
    };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function chainOf(p) { var first = firstChainOf(p); return first === '' ? 'its main chain' : first; }
  function tierCapitalFor(p) { if (p.tvl_usd >= 1e9) return 200; if (p.tvl_usd >= 1e8) return 100; if (p.tvl_usd >= 5e7) return 75; return 50; }
  function gasFor(p) {
    var chain = chainOf(p).toLowerCase();
    var table = [['ethereum', '$6–$12', 'Ethereum'], ['solana', 'under $0.10', 'Solana'], ['bitcoin', '$2–$5', 'Bitcoin'], ['base', '$0.01–$0.09', 'Base'], ['arbitrum', '$0.05–$0.25', 'Arbitrum'], ['optimism', '$0.05–$0.25', 'Optimism'], ['polygon', '$0.01–$0.05', 'Polygon'], ['zksync', '$0.05–$0.25', 'zkSync Era'], ['binance', '$0.05–$0.15', 'Binance'], ['avalanche', '$0.10–$0.50', 'Avalanche'], ['monad', '$0.01–$0.09', 'Monad']];
    for (var i = 0; i < table.length; i++) { if (chain.indexOf(table[i][0]) >= 0) return table[i][1] + ' gas on ' + table[i][2]; }
    return '$1–$3 gas';
  }
  function holdDaysFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount against it, then repay.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + '.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds.';
    if (c.indexOf('restak') >= 0 || c.indexOf('liquid staking') >= 0) return 'Stake $' + capital + ' of ' + chain + "'s staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('staking pool') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + '.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trad') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('capital') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep it active.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('payment') >= 0) return 'Send $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote in its next governance round.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' onto ' + chain + ' through ' + name + ' and use its main app once a week.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('privacy') >= 0) return 'Use $' + capital + ' through ' + name + "'s private pool on " + chain + ' and keep the receipt.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + '.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + '.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Make a second borrow-and-repay cycle on ' + name + ', smaller than the first, so the activity spans two weeks.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap $' + Math.max(10, Math.round(capital / 5)) + ' through ' + name + "'s main pool on " + chain + ' once a week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount through ' + name + ' in a different week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the first trade on ' + name + ' and open a second small one the following week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('capital') >= 0) return 'Add a second, smaller deposit to a different ' + name + ' vault on ' + chain + '.';
    if (c.indexOf('governance') >= 0) return 'Vote in a second ' + name + ' proposal and post once in its governance forum.';
    return 'Repeat the core action on ' + name + ' once a week, in a smaller size.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p), capital = planCapitalOf(p), hold = holdDaysFor(p.age_days), gas = gasFor(p), txGas = gasTxUsd(chain);
    return [
      { text: 'Use a fresh wallet holding only the funds you plan to farm, funded from an exchange, seed phrase offline — never farm from the wallet holding your savings.', cost: 'about ' + fmtGas(DATA.farm.gas_funding_txs * txGas) + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about ' + fmtGas(DATA.farm.gas_weekly_txs * txGas) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot; do the weekly action on the same day each week.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, search the protocol name plus 'points', open only the official domain, and check whether your wallet qualifies.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: "If a token ever launches, claim only from the protocol's own published link and verify the contract address twice; never sign a blind approval.", cost: 'gas only, never a claim fee', time: '10 minutes at claim time' },
      { text: 'Log the wallet, the dates and every transaction, then revoke any approval you no longer need on the chain\'s block explorer token-approval page.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // First two chains, or the fallback when a protocol lists none.
  function chainLabel(r) { return (r.chains && r.chains.length) ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain'; }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'slice') { av = (a.ticket || ticketOf(a)).slice_usd; bv = (b.ticket || ticketOf(b)).slice_usd; }
      else if (key === 'net') { av = (a.ticket || ticketOf(a)).net_per_hour_usd; bv = (b.ticket || ticketOf(b)).net_per_hour_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function walkForward() {
    var w = DATA.walk_forward || (DATA.validation && (DATA.validation.walk_forward || DATA.validation.walkForward));
    if (!w) return null;
    var s = w.days900 || w.day900 || w.half;
    if (!s) return null;
    return typeof s === 'number' ? s : s.median_miss;
  }
  function titleText() {
    var sc = DATA.size_curve, v = DATA.validation, wf = walkForward();
    return 'Size curve fitted on ' + sc.live_count + ' ' + (wf === null ? 'live' : 'stand-alone') + ' tokens, tested leave-one-out ×' + v.fitted.median_miss.toFixed(2) + (wf === null ? '' : ' and walk-forward ×' + wf.toFixed(2)) + ', P25–P75 ranges';
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', text: 'Snapshot ' + DATA.as_of }), el('span', { class: 'pill', text: 'DefiLlama protocol index' }), el('span', { class: 'pill', text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var vc = DATA.verdict_counts || { farm: 0, thin: 0, skip: 0 };
    var lo = 0, hi = 0;
    DATA.rows.forEach(function (r) { lo += hasRange(r) ? r.implied_low_usd : r.implied_value_usd; hi += hasRange(r) ? r.implied_high_usd : r.implied_value_usd; });
    var tr = { low: lo, high: hi };
    var best = null;
    DATA.rows.forEach(function (r) { var t = r.ticket || ticketOf(r); if (!best || t.net_per_hour_usd > best.t.net_per_hour_usd) best = { name: r.name, t: t }; });
    var bestLine = best ? ' Farm next: <b>' + best.name + '</b> ' + (best.t.net_per_hour_usd >= 0 ? '+' : '') + fmtMoney(best.t.net_per_hour_usd) + '/h on a ' + fmtDollars(DATA.farm.ticket_usd) + ' ticket.' : '';
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: titleText() }),
        el('p', { html: 'Every protocol with no token, priced off the ones that already trade.' }),
        el('p', { class: 'verdict-line', html: '<b>' + fmtDollars(DATA.farm.ticket_usd) + '</b> ticket: <b class="farm">FARM ' + vc.farm + '</b> pay after fees + assumed ' + Math.round(DATA.farm.tbill_rate * 100) + '% T-bill · <b class="thin">THIN ' + vc.thin + '</b> beat fees only · <b class="skipv">SKIP ' + vc.skip + '</b> fees eat the drop.' + bestLine })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size + ' · $' + Math.round(DATA.floor_usd / 1e6) + 'M+' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('span', { text: 'range ' + fmtUsd(tr.low) + '–' + fmtUsd(tr.high) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols shown' }), el('b', { text: DATA.live.length + ' of ' + (DATA.ledger ? DATA.ledger.live_token : DATA.live_size) })))
    );
  }

  function formulaBar() {
    var top = DATA.rows[0], sc = DATA.size_curve, v = DATA.validation, w = DATA.walk_forward, b = DATA.band_honesty;
    var example = top ? 'Rank 1 works out as ' + fmtUsd(top.curve_usd) + ' curve x ' + fmtMult(top.category_factor) + ' factor x ' + fmtMult(top.growth_multiplier) + ' x ' + fmtMult(top.maturity_multiplier) + ' x ' + fmtMult(top.breadth_multiplier) + ' = ' + fmtUsd(top.implied_value_usd) + '.' : '';
    var check = v ? 'LOO on ' + v.fitted.n + ' stand-alone tokens: x' + v.fitted.median_miss.toFixed(2) + ' miss, ' + Math.round(v.fitted.within_3x * 1000) / 10 + '% within 3x — vs x' + v.flat.median_miss.toFixed(2) + ' / ' + Math.round(v.flat.within_3x * 1000) / 10 + '% flat.' : '';
    var wf = w ? 'Walk-forward (older fit, newer tested): x' + w.half.median_miss.toFixed(2) + ' older-half → newer, x' + w.days900.median_miss.toFixed(2) + ' 900d+ → newer.' : '';
    var bandDef = b
      ? 'Each row’s range is the middle half of its category’s live comps — else the whole market’s spread — widened x' + b.widen.toFixed(2) + ' so ' + Math.round(b.middle_measured * 1000) / 10 + '% of held-out tokens land inside it — the point always sits inside it.'
      : 'Each row’s range is the middle half of its category’s live comps around the fitted curve — else the whole market’s spread — and the point always sits inside it.';
    return el('section', { class: 'formula-bar', 'aria-label': 'How implied value is computed' },
      el('div', { class: 'formula-line' }, el('b', { text: 'implied = 10^' + sc.intercept.toFixed(2) + ' x TVL^' + sc.slope.toFixed(2) + ' x factor(category) x growth x maturity x breadth' })),
      el('p', { text: example + ' ' + check + ' ' + wf + ' ' + bandDef }));
  }

  function setAsideTotal(led) {
    var s = led.set_aside || {};
    return (s.bridge || 0) + (s.liquid_staking || 0) + (s.exchange || 0) + (s.versioned || 0) + (s.wrapped || 0) + (s.kin || 0);
  }

  function integrityStrip() {
    var n = DATA.rows.length, ok = 0, sum = 0, ordered = true, watch = 0;
    DATA.rows.forEach(function (r, i) {
      if (impliedOf(r, DATA.model) === r.implied_value_usd) ok++;
      sum += r.implied_value_usd;
      if (r.on_watchlist) watch++;
      if (i > 0 && r.implied_value_usd > DATA.rows[i - 1].implied_value_usd) ordered = false;
    });
    var led = DATA.ledger || { total: n, ranked: n, live_token: 0, set_aside: {} };
    var setTotal = setAsideTotal(led), accounted = (led.ranked || 0) + (led.live_token || 0) + setTotal;
    var totals = sum === DATA.total_implied_usd ? 'totals equal: ' + fmtUsd(sum) : 'totals MISMATCH: rows sum ' + fmtUsd(sum) + ' vs ' + fmtUsd(DATA.total_implied_usd);
    var text = 'this table = board.json: ' + ok + '/' + n + ' rows recomputed · ranks 1–' + n + (ordered ? ' in order, values never rise' : ' — ORDER BREAKS') + ' · ' + totals
      + (DATA.board_checksum ? ' · checksum ' + DATA.board_checksum.slice(0, 12) + '… = main.ts' : '')
      + ' · watchlist ' + watch + '/' + DATA.watchlist_size + ' · ledger ' + accounted + '/' + led.total;
    return el('section', { class: 'formula-bar', 'aria-label': 'Integrity strip' },
      el('p', { text: text })
    );
  }

  function ledgerPanel() {
    var led = DATA.ledger;
    if (!led) return null;
    var set = led.set_aside || {}, setTotal = setAsideTotal(led), total = led.total || 0;
    function share(n) { return total ? Math.round(n / total * 1000) / 10 : 0; }
    var reasons = [['bridge', set.bridge], ['liquid-staking', set.liquid_staking], ['exchange', set.exchange], ['versioned', set.versioned], ['wrapped', set.wrapped], ['kin', set.kin]].filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ');
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The ledger: all ' + total + ' protocols in exactly one group' }),
      el('div', { class: 'ledger-bar' },
        el('i', { style: 'width:' + share(led.ranked) + '%;background:var(--teal)', title: 'ranked ' + led.ranked }),
        el('i', { style: 'width:' + share(led.live_token) + '%;background:var(--blue)', title: 'already trades ' + led.live_token }),
        el('i', { style: 'width:' + share(setTotal) + '%;background:var(--amber)', title: 'set aside ' + setTotal })),
      el('p', { class: 'sub', text: 'ranked ' + led.ranked + ' · already trades ' + led.live_token + ' · set aside ' + setTotal + (reasons ? ': ' + reasons : '') + '.' }),
      el('p', { class: 'sub', text: '0 protocol names in the code — the same function scores every protocol.' }),
      DATA.board_checksum ? el('p', { class: 'sub', text: 'Source open: board.json sha256 ' + DATA.board_checksum + ' — recompute it from data.js + main.ts.' }) : null
    );
  }

  function limitsPanel() {
    var items = [], b = DATA.band_honesty;
    if (b && b.middle_measured !== undefined && b.middle_before !== undefined) {
      items.push('The band was too narrow before recalibration: widened ×' + b.widen.toFixed(2) + ', it now holds ' + Math.round(b.middle_measured * 1000) / 10 + '% of held-out tokens inside P25–P75 (was ' + Math.round(b.middle_before * 1000) / 10 + '%), ' + Math.round(b.outer_measured * 1000) / 10 + '% inside P10–P90 (was ' + Math.round(b.outer_before * 1000) / 10 + '%).');
    } else {
      items.push('Band coverage is not printed here: the recalibration has not measured it, so no coverage number is claimed.');
    }
    var top = DATA.rows[0];
    if (top && top.comp_live_count <= 1) {
      var k = 0;
      for (var i = 0; i < DATA.rows.length && DATA.rows[i].category === top.category; i++) k++;
      var comp = (top.comp_members && top.comp_members[0]) || null;
      items.push('The ' + top.category + ' factor ' + fmtMult(top.category_factor) + ' rests on a single live comp' + (comp ? ' (' + comp.name + ', ' + fmtMult(comp.ratio) + ')' : '') + ' and still sets the top ' + k + ' rows.');
    }
    var fu = DATA.fit_universe;
    if (fu) items.push('A fit on all ' + fu.live_total + ' live tokens, wrapped and bridged included, was tested and not kept — they bend the slope — so the curve is fitted on the ' + fu.fitted_live + ' stand-alone tokens.');
    return el('section', { class: 'panel model limits' },
      el('h2', { text: 'What this validation does not show' }),
      el('ul', null, items.map(function (t) { return el('li', { text: t }); }))
    );
  }

  function spotlight() {
    var top3 = DATA.rows.slice(0, 3);
    return el('section', { class: 'spot', 'aria-label': 'Top three by implied value' },
      top3.map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: 'Rank ' + r.rank }), el('h3', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }),
          el('div', { class: 'val', text: fmtUsd(r.implied_value_usd) + ' implied' }),
          el('span', { class: 'why', text: 'TVL ' + fmtUsd(r.tvl_usd) + ' curve ' + fmtUsd(r.curve_usd) + ' x ' + fmtMult(r.category_factor) + ', ' + fmtPct(r.change_7d) + ' in 7 days' }));
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }), categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }), chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [0, 50000000, 100000000, 500000000, 1000000000].map(function (v) { return el('option', { value: String(v), text: v === 0 ? 'Any TVL' : 'TVL ≥ ' + fmtUsd(v), selected: v === state.minTvl ? 'selected' : null }); }));
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Size' }), tvlSelect),
      el('label', { class: 'check', for: 'watch' }, watchBox, el('span', { text: 'Watchlist only' })),
      el('div', { class: 'tabs' }, pre, live),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }

  function quantile(sorted, q) {
    var n = sorted.length, pos, lo, hi;
    if (n === 0) return 0;
    if (n === 1) return sorted[0];
    pos = (n - 1) * q; lo = Math.floor(pos); hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function scatter(list) {
    var pts = DATA.fit_points || [], sc = DATA.size_curve, xs = [], ys = [], res = [];
    pts.forEach(function (p) { var x = Math.log10(p.tvl_usd), y = Math.log10(p.mcap_usd); xs.push(x); ys.push(y); res.push(y - (sc.intercept + sc.slope * x)); });
    list.forEach(function (r) { xs.push(Math.log10(Math.max(1, r.tvl_usd))); ys.push(Math.log10(Math.max(1, r.implied_value_usd))); });
    if (!xs.length) return el('div', { class: 'hist-label sub', text: 'No points to plot.' });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var dx = (x1 - x0) || 1, dy = (y1 - y0) || 1;
    x0 -= dx * 0.04; x1 += dx * 0.04; y0 -= dy * 0.06; y1 += dy * 0.06;
    dx = x1 - x0; dy = y1 - y0;
    var W = 1160, H = 72;
    var X = function (v) { return (8 + (v - x0) / dx * (W - 16)).toFixed(1); };
    var Y = function (v) { return (H - 6 - (v - y0) / dy * (H - 12)).toFixed(1); };
    var sres = res.slice().sort(function (a, b) { return a - b; });
    // The table prints the widened band, so the scatter draws it too.
    var widen = DATA.band_honesty ? DATA.band_honesty.widen : 1;
    var raw25 = quantile(sres, 0.25), raw75 = quantile(sres, 0.75);
    var mid = (raw25 + raw75) / 2, half = (raw75 - raw25) / 2 * widen;
    var p25 = mid - half, p75 = mid + half;
    var curve = '', up = '', dn = '';
    for (var i = 0; i <= 24; i++) {
      var x = x0 + dx * i / 24, y = sc.intercept + sc.slope * x;
      curve += X(x) + ',' + Y(y) + ' '; up += X(x) + ',' + Y(y + p75) + ' '; dn += X(x) + ',' + Y(y + p25) + ' ';
    }
    var dots = '';
    pts.forEach(function (p) { dots += '<circle cx="' + X(Math.log10(p.tvl_usd)) + '" cy="' + Y(Math.log10(p.mcap_usd)) + '" r="2" fill="#2dd4bf"/>'; });
    list.forEach(function (r) { dots += '<circle cx="' + X(Math.log10(Math.max(1, r.tvl_usd))) + '" cy="' + Y(Math.log10(Math.max(1, r.implied_value_usd))) + '" r="1.6" fill="#60a5fa" opacity="0.75"/>'; });
    var svg = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Market cap against TVL with the fitted size curve and its widened P25 to P75 band">'
      + '<polygon points="' + up + dn.split(' ').reverse().join(' ') + '" fill="#2dd4bf" opacity="0.12"/>'
      + '<polyline points="' + curve + '" fill="none" stroke="#2dd4bf" stroke-width="1.5"/>'
      + '<polyline points="' + up + '" fill="none" stroke="#2dd4bf" stroke-width="0.75" opacity="0.6"/>'
      + '<polyline points="' + dn + '" fill="none" stroke="#2dd4bf" stroke-width="0.75" opacity="0.6"/>'
      + dots + '</svg>';
    return el('div', { class: 'hist-wrap' },
      el('div', { html: svg }),
      el('div', { class: 'hist-label sub', text: 'Market cap vs TVL, log scale: fitted tokens in teal, shown rows in blue, fitted curve with its widened P25–P75 band.' })
    );
  }

  function verdictCell(r) {
    var t = r.ticket || ticketOf(r);
    var cls = t.verdict === 'FARM' ? 'farm' : t.verdict === 'THIN' ? 'thin' : 'skipv';
    var sub = fmtDollars(t.deposit_usd) + ' · ' + (t.pays_from_usd === null ? 'never pays' : 'pays ' + fmtDollars(t.pays_from_usd));
    return el('td', null, el('div', { class: 'verdict' }, el('span', { class: 'verdict-chip ' + cls, text: t.verdict }), el('span', { class: 'sub', text: sub })));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; writeHash(); render(); } })));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d), growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg', t = r.ticket || ticketOf(r);
      var netText = (t.net_per_hour_usd >= 0 ? '+' : '-') + fmtMoney(Math.abs(t.net_per_hour_usd)) + '/h', range = null;
      if (r.implied_low_usd !== null && r.implied_low_usd !== undefined && r.implied_high_usd !== null && r.implied_high_usd !== undefined) {
        var left = Math.max(0, Math.min(100, r.implied_low_usd / max * 100)), width = Math.max(1, Math.min(100 - left, (r.implied_high_usd - r.implied_low_usd) / max * 100));
        range = el('span', { class: 'rng', style: 'left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%' });
      }
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', title: 'Flat baseline ' + fmtMult(r.comp_multiple) + (r.comp_used_global ? ' (global median)' : ' (category median)') }, el('span', { text: fmtRatio(r.tvl_usd ? r.implied_value_usd / r.tvl_usd : 0) })),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }), range),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'rng-sub', title: 'Range: middle half of the category’s live comps, widened x' + (DATA.band_honesty ? DATA.band_honesty.widen.toFixed(2) : '1.00'), text: fmtRange(r) })
        )),
        el('td', { class: 'num', text: fmtMoney(t.slice_usd) }),
        el('td', { class: 'num ' + (t.net_per_hour_usd >= 0 ? 'pos' : 'neg'), text: netText }),
        verdictCell(r), el('td', null, el('span', { class: 'status', text: r.on_watchlist ? 'watchlist' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      scatter(list),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Strongest implied value first. ' + fmtDollars(DATA.farm.ticket_usd) + ' slice: what the ticket gets if an assumed ' + Math.round(DATA.farm.share * 100) + '% of the launch goes to depositors. Net: slice minus gas and forgone assumed ' + Math.round(DATA.farm.tbill_rate * 100) + '% T-bill yield, per hour. Gas is priced on the first chain each protocol lists; the snapshot carries no fee data, so gas is an assumed range midpoint.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Mult' }), sortHeader('implied', 'Implied value'), sortHeader('slice', fmtDollars(DATA.farm.ticket_usd) + ' slice'), sortHeader('net', 'Net $/h'),
            el('th', { scope: 'col', text: 'Verdict' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tbody)));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }), el('td', null, el('span', { class: 'status live', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Set aside from the pre-token ranking — they are the comps that price it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  function modelPanel() {
    var m = DATA.model, sc = DATA.size_curve, v = DATA.validation, w = DATA.walk_forward, b = DATA.band_honesty, fu = DATA.fit_universe;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased.' }),
      el('div', { class: 'formula' },
        'implied = round(10^' + sc.intercept.toFixed(4) + ' x tvl_usd^' + sc.slope.toFixed(4) + ' x factor(category) x (1+clamp(change_7d,' + m.growth_floor + ',' + m.growth_cap + ')/100 x ' + m.growth_weight + ') x (' + m.maturity_floor + '+min(age_days,' + m.maturity_days + ')/' + m.maturity_days + ' x ' + m.maturity_range + ') x breadth)'),
      el('p', { class: 'sub', text: 'The size curve is fitted on the ' + sc.live_count + ' stand-alone tokens that trade here (' + fu.excluded_live + ' wrapped, bridged, staked or versioned live tokens are excluded from the fit, not hidden — they still appear in the live-token view), by ordinary least squares on log market cap against log TVL (ratios winsorised to 0.01–5). factor(category) is the category\'s median residual off the curve, shrunk toward 1 by n/(n+3) when comps are few; with no live-token protocol the curve alone prices it. Each row’s range is the middle half of its category’s live comps around the curve (25th–75th percentile of residuals), widened x' + b.widen.toFixed(2) + ' — the raw band held only ' + Math.round(b.middle_before * 1000) / 10 + '% of held-out tokens; widened, ' + Math.round(b.middle_measured * 1000) / 10 + '% land inside it (' + Math.round(b.outer_measured * 1000) / 10 + '% inside P10–P90, was ' + Math.round(b.outer_before * 1000) / 10 + '%). A thin category uses the whole market’s spread. Age is days since first listing (unlisted: ' + m.unknown_age_days + ' days). Breadth adds 2% per extra chain, at most 10%. The flat category median (' + fmtMult(DATA.global_comp) + ' global) is the baseline the curve beat, not the price: leave-one-out on the same ' + v.fitted.n + ' tokens gives x' + v.fitted.median_miss.toFixed(2) + ' median miss with ' + Math.round(v.fitted.within_3x * 1000) / 10 + '% within 3x, against x' + v.flat.median_miss.toFixed(2) + ' / ' + Math.round(v.flat.within_3x * 1000) / 10 + '% flat. Walk-forward (older fit, newer tested): x' + w.half.median_miss.toFixed(2) + ' older-half → newer, x' + w.days900.median_miss.toFixed(2) + ' on tokens listed 900+ days ago.' }));
  }

  function termPanel() {
    var tbody = el('tbody');
    (DATA.term_table || []).forEach(function (t) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: t.term })),
        el('td', { class: 'num', text: 'x' + t.loo.median_miss.toFixed(2) + ' · ' + Math.round(t.loo.within_3x * 1000) / 10 + '%' }),
        el('td', { class: 'num', text: 'x' + t.wf_half.median_miss.toFixed(2) + ' · ' + Math.round(t.wf_half.within_3x * 1000) / 10 + '%' }),
        el('td', { class: 'num', text: 'x' + t.wf_900.median_miss.toFixed(2) + ' · ' + Math.round(t.wf_900.within_3x * 1000) / 10 + '%' }), el('td', { text: t.note })));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'What was tried, and what won' }),
      el('p', { class: 'sub', text: 'Every term below was fitted and scored on two held-out tests: leave-one-out and walk-forward by listing date (older fit, newer tested). A term that wins one test but loses the other is not kept; no dropped term beats the shipped model on both tests’ median miss. The curve alone predicts held-out mcap best — the factor and multipliers price the board’s actual use, not held-out mcap.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Leave-one-out' }), el('th', { scope: 'col', text: 'WF older half → newer' }), el('th', { scope: 'col', text: 'WF 900d+ → newer' }), el('th', { scope: 'col', text: 'Verdict' }))),
          tbody
        )
      )
    );
  }

  function compsPanel() {
    var tbody = el('tbody');
    DATA.comps.slice(0, 12).forEach(function (c) {
      var names = (c.members || []).map(function (m) { return m.name; }).join(', ') || 'none on record';
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.live_count) }), el('td', { class: 'num', text: fmtMult(c.median_multiple) }), el('td', { class: 'num', text: fmtMult(c.curve_factor) }),
        el('td', { class: 'num', text: c.used_global ? 'global median' : 'category median' }), el('td', { class: 'comps-members', text: names })));
    });
    return el('section', { class: 'panel comps' },
      el('h2', { text: 'The comps behind the price' }),
      el('p', { class: 'sub', text: 'Median mcap/TVL of live-token protocols in each category, read off this snapshot, with the live protocols that set each median named. The curve factor is the category’s median residual off the fitted curve, shrunk toward 1 when comps are few; the flat median beside it is the baseline the curve beat. The twelve richest categories are shown; a category with no live-token protocol is priced by the curve alone (factor 1.00x).' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live comps' }), el('th', { scope: 'col', text: 'Median mcap/TVL' }), el('th', { scope: 'col', text: 'Curve factor' }), el('th', { scope: 'col', text: 'Source' }), el('th', { scope: 'col', text: 'Top live comps' }))),
          tbody
        )
      )
    );
  }

  function riskNote() {
    return el('section', { class: 'panel note' },
      el('p', null, el('b', { text: 'Read this before you farm. ' }), '“No token on record” is what DefiLlama reports — not proof a protocol has no token, and not a promise one will launch. Implied value assumes the protocol keeps its TVL and the market keeps paying the category multiple; a token can be worth far less, or nothing. Never deposit money you cannot lose, never pay to claim, and never sign a blind approval.'));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row), recomputed = impliedOf(row, DATA.model), ticket = ticketOf(row), carried = row.ticket || null;
    var ticketOk = carried !== null && carried.slice_usd === ticket.slice_usd && carried.net_usd === ticket.net_usd && carried.verdict === ticket.verdict && carried.deposit_net_usd === ticket.deposit_net_usd && carried.gas_chain === ticket.gas_chain && carried.gas_usd === ticket.gas_usd;
    var chains = row.chains && row.chains.length ? row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' and ' + (row.chains.length - 4) + ' more' : '') : 'an unnamed chain';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('span', { class: 'badge', text: row.on_watchlist ? 'Watchlist' : 'Early radar' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chains })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var rangeText = hasRange(row) ? ' Range: the middle half of the category’s live comps around the fitted curve, widened x' + (DATA.band_honesty ? DATA.band_honesty.widen.toFixed(2) : '1.00') + ', ' + fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) + '.' + (row.band_used_global ? ' Too few comps here, so the band uses the whole market’s spread.' : '') : '';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        [['TVL', fmtUsd(row.tvl_usd)], ['Size curve', fmtUsd(row.curve_usd)], ['Category factor', fmtMult(row.category_factor)], ['Seven-day growth', fmtPct(row.change_7d)], ['Growth multiplier', fmtMult(row.growth_multiplier)], ['Age with no token', fmtAge(row.age_days)], ['Maturity multiplier', fmtMult(row.maturity_multiplier)], ['Breadth multiplier', fmtMult(row.breadth_multiplier)]].map(function (kv) { return el('div', null, el('span', { text: kv[0] }), el('b', { class: 'num', text: kv[1] })); }).concat([el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('div', null,
          el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }),
          el('span', { class: 'pt-sub', text: 'range ' + fmtRange(row) })
        ))])
      ),
      el('p', { class: 'sub', text: 'Seven-day growth ' + fmtPct(row.change_7d) + '; age with no token ' + fmtAge(row.age_days) + '.' + rangeText }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries — an estimate, not a price.' : ', which differs from the board: the data would be stale.') })
    ));
    (function () {
      var members = row.comp_members || [], cat = row.category || 'Other';
      var head = row.factor_shrunk
        ? 'Only ' + row.comp_live_count + ' live-token protocol' + (row.comp_live_count === 1 ? '' : 's') + ' in ' + cat + ' — too thin to set a category factor, so the factor ' + fmtMult(row.category_factor) + ' is shrunk toward 1.00x.'
        : cat + '\'s ' + row.comp_live_count + ' live-token protocols sit ' + fmtMult(row.category_factor) + ' off the size curve in this snapshot, so the factor ' + fmtMult(row.category_factor) + ' adjusts the curve value.';
      var body = [el('p', { class: 'sub', text: head })];
      if (members.length > 0) {
        body.push(el('ul', { class: 'members' }, members.map(function (m) {
          return el('li', null, el('b', { text: m.name }), el('span', { text: ' ' + fmtMult(m.ratio) + ' mcap/TVL' }));
        })));
        if (row.comp_used_global) body.push(el('p', { class: 'sub', text: 'The live comp above is for reference: its ratio is not the multiple used.' }));
        else body.push(el('p', { class: 'sub', text: 'The live comps above set the factor; the flat category median is ' + fmtMult(row.comp_multiple) + ' for comparison.' }));
      } else {
        body.push(el('p', { class: 'sub', text: 'No live-token protocol in this category records a market cap, so the curve alone prices it.' }));
      }
      var sec = el('section', { class: 'detail-section' }, el('h3', { text: 'Why this value' }));
      body.forEach(function (b) { sec.appendChild(b); });
      dialog.appendChild(sec);
    })();
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'farm-sum' },
        el('span', null, el('b', { text: '$' + row.farm_summary.capital_usd }), ' capital'),
        el('span', null, el('b', { text: row.farm_summary.gas })),
        el('span', null, el('b', { text: row.farm_summary.hold_days + ' days' }), ' hold'),
        el('span', null, el('b', { text: '~' + row.farm_summary.setup_minutes + ' min' }), ' to set up')),
      el('p', { class: 'ticket-line', html: '<b>' + fmtDollars(DATA.farm.ticket_usd) + ' ticket:</b> slice ' + fmtMoney(ticket.slice_usd) + ', gas ' + fmtMoney(ticket.gas_usd) + ' on ' + (ticket.gas_chain || 'its main chain') + ' (' + fmtMoney(ticket.gas_funding_usd) + ' funding + ' + fmtMoney(ticket.gas_deposit_claim_usd) + ' deposit/claim + ' + fmtMoney(ticket.gas_weekly_usd * Math.floor(ticket.hold_days / 7)) + ' weekly), forgone assumed ' + Math.round(DATA.farm.tbill_rate * 100) + '% T-bill ' + fmtMoney(ticket.forgone_usd) + ', net ' + fmtMoney(ticket.net_usd) + ' (' + (ticket.net_per_hour_usd >= 0 ? '+' : '-') + fmtMoney(Math.abs(ticket.net_per_hour_usd)) + '/h) — <b>' + ticket.verdict + '</b>' + (ticket.pays_from_usd === null ? ', never pays' : ', pays from ' + fmtDollars(ticket.pays_from_usd)) + '. Plan deposit ' + fmtDollars(ticket.deposit_usd) + ': slice ' + fmtMoney(ticket.deposit_slice_usd) + ', net ' + fmtMoney(ticket.deposit_net_usd) + ' (' + (ticket.deposit_net_per_hour_usd >= 0 ? '+' : '-') + fmtMoney(Math.abs(ticket.deposit_net_per_hour_usd)) + '/h).' + (ticketOk ? '' : ' (differs from the board: the data would be stale.)') }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: '), action = at >= 0 ? s.slice(0, at) : s, tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action + ' ' }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    document.title = 'Token Radar — ' + titleText();
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header()); shell.appendChild(lede()); shell.appendChild(integrityStrip()); shell.appendChild(formulaBar());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      var led = ledgerPanel();
      if (led) shell.appendChild(led);
      shell.appendChild(modelPanel()); shell.appendChild(termPanel()); shell.appendChild(limitsPanel()); shell.appendChild(compsPanel()); shell.appendChild(riskNote());
    }
    shell.appendChild(el('footer', { text: 'Token Radar · snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Implied values are estimates, not prices.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
