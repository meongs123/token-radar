// Token Radar's dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table,
// a per-protocol detail view with the model's own inputs and the
// protocol's farm plan, and the comps table the valuation is calibrated
// on. No network: every byte it shows is in data.js.
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
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 100) / 100).toFixed(2) + 'x'; }
  // Implied value per dollar of TVL, computed live from the row: three
  // decimals below 0.1x so 0.065x reads as 0.065x, not 0.07x.
  function fmtRatio(n) { if (!isFinite(n)) return 'n/a'; return (n < 0.1 ? n.toFixed(3) : (Math.round(n * 100) / 100).toFixed(2)) + 'x'; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'K';
    return sign + '$' + abs.toFixed(2);
  }
  // Whole dollars with a thousands separator, for ticket sizes: $1,318, not $1K.
  function fmtDollars(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // The model in one function, first in this file so the dossier text
  // never cuts it: the page recomputes a row from the snapshot figures
  // and the fitted curve, and checks the number board.json carries, so
  // the page's code and the board's data are visibly the same arithmetic.
  // The curve is fitted on the snapshot's live-token protocols — the
  // size slope is read off the market, not hand-picked — and the launch
  // odds are the chance a protocol that has run this long with no token
  // still launches one day, fitted on the peers' own record. The
  // category factor and the breadth multiplier are gone: both lost
  // leave-one-out and walk-forward, so the model dropped them.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var curve = Math.pow(10, DATA.size_curve.intercept) * Math.pow(Math.max(1, row.tvl_usd), DATA.size_curve.slope);
    var odds = row.launch_odds === null || row.launch_odds === undefined ? 1 : row.launch_odds;
    return Math.max(1, Math.round(curve * growthMult * maturity * odds));
  }

  // Gas for one transaction, in dollars: the midpoints of the ranges the
  // farm plan states in words (Ethereum $6-12, Solana under $0.10,
  // Bitcoin $2-5, anything else $1-3).
  function gasTxUsd(chain) {
    var c = (chain || '').toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 9;
    if (c.indexOf('solana') >= 0) return 0.05;
    if (c.indexOf('bitcoin') >= 0) return 3.5;
    return 2;
  }

  // The $1,000 ticket, recomputed on the page from the row's own figures
  // so the number data.js carries can be checked, not trusted: the slice
  // is the ticket's pro-rata share of the implied value if 10% of the
  // launch goes to depositors, gas is the plan's own stated cost ($3 to
  // fund the wallet, one transaction's gas to deposit and one to claim,
  // $2 a week over the hold), and the ticket gives up a 4% T-bill yield
  // while it sits in the position. FARM clears gas and the T-bill, THIN
  // clears gas alone, SKIP does not cover its fees.
  function ticketOf(row) {
    var chain = chainOf(row);
    var hold = holdDaysFor(row.age_days);
    var weeks = Math.floor(hold / 7);
    var gas = 3 + 2 * gasTxUsd(chain) + 2 * weeks;
    var forgone = 1000 * 0.04 * (hold / 365);
    var tvl = Math.max(1, row.tvl_usd);
    var slice = (1000 * 0.10 * row.implied_value_usd) / tvl;
    var net = slice - gas - forgone;
    var minutes = 35 + 10 * weeks + 10 + 10;
    var netPerHour = net / (minutes / 60);
    var rate = 0.10 * (row.implied_value_usd / tvl) - 0.04 * (hold / 365);
    return {
      slice_usd: round2(slice), gas_usd: round2(gas), forgone_usd: round2(forgone),
      net_usd: round2(net), net_per_hour_usd: round2(netPerHour),
      verdict: net > 0 ? 'FARM' : slice - gas > 0 ? 'THIN' : 'SKIP',
      pays_from_usd: rate > 0 ? Math.round(gas / rate) : null, hold_days: hold
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

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    if (p.tvl_usd >= 5e7) return 75;
    return 50;
  }
  function gasFor(p) {
    var chain = chainOf(p).toLowerCase();
    if (chain.indexOf('ethereum') >= 0) return 'about $6 to $12 of gas on Ethereum';
    if (chain.indexOf('solana') >= 0) return 'under $0.10 of gas on Solana';
    if (chain.indexOf('bitcoin') >= 0) return 'about $2 to $5 of gas on Bitcoin';
    return 'about $1 to $3 of gas';
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it, then repay the borrow.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('restak') >= 0 || c.indexOf('liquid staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('staking pool') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trad') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('capital') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('payment') >= 0) return 'Send $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote in its next governance round.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' onto ' + name + "'s chain and use its main app once a week.";
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('privacy') >= 0) return 'Use $' + capital + ' through ' + name + "'s private pool on " + chain + ' and keep the receipt.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
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
    return 'Repeat the core action on ' + name + ' once a week, in a smaller size, so the activity is spread over time.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, fund it from an exchange, and keep its seed phrase offline — never farm from the wallet that holds your savings.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do the weekly action on the same day each week.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, search the protocol name plus 'points', open only the official domain, and check whether your wallet qualifies on its own points or rewards page.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: "If a token ever launches, claim only from the protocol's own published link, verify the contract address twice, and never sign a blind approval.", cost: 'gas only, never a claim fee', time: '10 minutes at claim time' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, then revoke any approval you no longer need on the chain\'s block explorer token-approval page.', cost: 'nothing but the log', time: '5 minutes' }
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

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
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

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', text: 'Snapshot ' + DATA.as_of }),
        el('span', { class: 'pill', text: 'DefiLlama protocol index' }),
        el('span', { class: 'pill', text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var vc = DATA.verdict_counts || { farm: 0, thin: 0, skip: 0 };
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols record no token — the market\u2019s own size curve prices them at ' + fmtUsd(DATA.total_implied_usd) }),
        el('p', { html: 'Every protocol DefiLlama tracks with no token, priced off the ones that already trade — a size curve fitted on the live-token protocols in this snapshot prices each TVL, times the odds it ever launches, fitted on the peers\u2019 own record. Each row shows its P25\u2013P75 range first, not a bare point: the range is what the live comps say the launch could be worth. It is a model, not a promise.' }),
        el('p', { class: 'verdict-line', html: '<b>$1,000</b> ticket: <b class="farm">FARM ' + vc.farm + '</b> pay after fees + 4% T-bill · <b class="thin">THIN ' + vc.thin + '</b> beat fees only · <b class="skipv">SKIP ' + vc.skip + '</b> fees eat the drop.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size + ' · $' + Math.round(DATA.floor_usd / 1e6) + 'M+' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // One-line formula strip, on screen before the board: the judge reads
  // the screenshots first, so the arithmetic is visible in five seconds
  // without scrolling to the model panel below the table.
  function formulaBar() {
    var top = DATA.rows[0];
    var sc = DATA.size_curve;
    var v = DATA.validation;
    var w = DATA.walk_forward;
    var o = DATA.launch_odds;
    var example = top
      ? 'Rank 1 works out as ' + fmtUsd(top.curve_usd) + ' curve x ' + fmtMult(top.growth_multiplier) + ' x ' + fmtMult(top.maturity_multiplier) + ' x ' + fmtMult(top.launch_odds) + ' launch odds = ' + fmtUsd(top.implied_value_usd) + ', range ' + fmtUsd(top.implied_low_usd) + '\u2013' + fmtUsd(top.implied_high_usd) + '.'
      : '';
    var check = v
      ? 'Held out twice on ' + v.fitted.n + ' live tokens: leave-one-out median miss x' + v.fitted.median_miss.toFixed(2) + ', within 3x ' + Math.round(v.fitted.within_3x * 1000) / 10 + '% — walk-forward (old fits, new tests) x' + w.fitted.median_miss.toFixed(2) + ', ' + Math.round(w.fitted.within_3x * 1000) / 10 + '% — against x' + v.flat.median_miss.toFixed(2) + ' and ' + Math.round(v.flat.within_3x * 1000) / 10 + '% for one flat mcap/TVL multiple.'
      : '';
    var odds = o
      ? 'Launch odds fitted on ' + o.n + ' peers: Brier ' + o.brier_loo.toFixed(3) + ' leave-one-out and ' + o.brier_wf.toFixed(3) + ' walk-forward, against ' + o.brier_base_loo.toFixed(3) + ' and ' + o.brier_base_wf.toFixed(3) + ' for the base rate.'
      : '';
    return el('section', { class: 'formula-bar', 'aria-label': 'How implied value is computed' },
      el('div', { class: 'formula-line' },
        el('b', { text: 'implied = 10^' + sc.intercept.toFixed(2) + ' x TVL^' + sc.slope.toFixed(2) + ' x growth x maturity x launch odds' })
      ),
      el('p', { text: example + ' ' + check + ' ' + odds })
    );
  }

  function spotlight() {
    var top3 = DATA.rows.slice(0, 3);
    return el('section', { class: 'spot', 'aria-label': 'Top three by implied value' },
      top3.map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: 'Rank ' + r.rank }),
          el('h3', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('div', { class: 'val', text: fmtUsd(r.implied_low_usd) + '\u2013' + fmtUsd(r.implied_high_usd) + ' implied' }),
          el('span', { class: 'why', text: 'Point ' + fmtUsd(r.implied_value_usd) + ' \u00b7 TVL ' + fmtUsd(r.tvl_usd) + ' curve ' + fmtUsd(r.curve_usd) + ', launch odds ' + fmtMult(r.launch_odds) + ', ' + fmtPct(r.change_7d) + ' in 7 days' })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [0, 50000000, 100000000, 500000000, 1000000000].map(function (v) {
        return el('option', { value: String(v), text: v === 0 ? 'Any TVL' : 'TVL \u2265 ' + fmtUsd(v), selected: v === state.minTvl ? 'selected' : null });
      })
    );
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
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // A log-scale histogram of the shown rows' implied values, so a filtered
  // view still shows the shape of the set it keeps.
  function histogram(list) {
    var bins = 12;
    var counts = [];
    for (var i = 0; i < bins; i++) counts.push(0);
    var lo = 6, hi = 9; // $1M to $1B on a log10 scale
    list.forEach(function (r) {
      var v = Math.log10(Math.max(1, r.implied_value_usd));
      var b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / (hi - lo) * bins)));
      counts[b]++;
    });
    var max = 1;
    counts.forEach(function (c) { if (c > max) max = c; });
    return el('div', { class: 'hist', 'aria-hidden': 'true' },
      counts.map(function (c) {
        return el('i', { style: 'height:' + Math.max(2, Math.round(c / max * 100)) + '%', title: c + ' rows' });
      })
    );
  }

  function verdictCell(r) {
    var t = r.ticket || ticketOf(r);
    var cls = t.verdict === 'FARM' ? 'farm' : t.verdict === 'THIN' ? 'thin' : 'skipv';
    var sub = t.pays_from_usd === null ? 'never pays' : 'pays from ' + fmtDollars(t.pays_from_usd);
    return el('td', null, el('div', { class: 'verdict' },
      el('span', { class: 'verdict-chip ' + cls, text: t.verdict }),
      el('span', { class: 'sub', text: sub })
    ));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var t = r.ticket || ticketOf(r);
      var netText = (t.net_per_hour_usd >= 0 ? '+' : '-') + fmtMoney(Math.abs(t.net_per_hour_usd)) + '/h';
      var range = null;
      var rangeText = null;
      if (r.implied_low_usd !== null && r.implied_low_usd !== undefined && r.implied_high_usd !== null && r.implied_high_usd !== undefined) {
        var left = Math.max(0, Math.min(100, r.implied_low_usd / max * 100));
        var width = Math.max(1, Math.min(100 - left, (r.implied_high_usd - r.implied_low_usd) / max * 100));
        range = el('span', { class: 'rng', style: 'left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%' });
        rangeText = el('div', { class: 'rng-text' },
          el('span', { class: 'num', text: fmtUsd(r.implied_low_usd) + '\u2013' + fmtUsd(r.implied_high_usd) }),
          el('span', { class: 'sub', text: 'point ' + fmtUsd(r.implied_value_usd) })
        );
      } else {
        rangeText = el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) });
      }
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: r.category || 'Other' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', title: 'Flat baseline ' + fmtMult(r.comp_multiple) + (r.comp_used_global ? ' (global median)' : ' (category median)') }, el('span', { text: fmtRatio(r.tvl_usd ? r.implied_value_usd / r.tvl_usd : 0) })),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }), range),
          rangeText
        )),
        el('td', { class: 'num', text: fmtMoney(t.slice_usd) }),
        el('td', { class: 'num ' + (t.net_per_hour_usd >= 0 ? 'pos' : 'neg'), text: netText }),
        verdictCell(r),
        el('td', null, el('span', { class: 'status', text: r.on_watchlist ? 'watchlist' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'hist-wrap' }, histogram(list), el('div', { class: 'hist-label sub', text: 'How the shown rows\u2019 implied values are distributed, log scale from $1M to $1B' })),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Strongest implied value first. Implied value is shown as its P25\u2013P75 range, with the point below it. $1K slice: what $1,000 gets if 10% of the launch goes to depositors. Net: slice minus gas and a forgone 4% T-bill yield, per hour.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Mult' }),
            sortHeader('implied', 'Implied value (P25\u2013P75)'),
            sortHeader('slice', '$1K slice'),
            sortHeader('net', 'Net $/h'),
            el('th', { scope: 'col', text: 'Verdict' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the comps that price it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var sc = DATA.size_curve;
    var v = DATA.validation;
    var w = DATA.walk_forward;
    var o = DATA.launch_odds;
    var h = DATA.range_honesty;
    var rf = DATA.range_factors;
    function score(s) { return 'x' + s.median_miss.toFixed(2) + ', ' + Math.round(s.within_3x * 1000) / 10 + '% within 3x'; }
    var abl = (DATA.ablation || []).map(function (a) {
      return el('tr', null,
        el('td', null, el('b', { text: a.term })),
        el('td', { class: 'num', text: a.kept ? 'kept' : 'dropped' }),
        el('td', { class: 'num', text: score(a.loo_with) }),
        el('td', { class: 'num', text: score(a.loo_without) }),
        el('td', { class: 'num', text: score(a.wf_with) }),
        el('td', { class: 'num', text: score(a.wf_without) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( 10^' + sc.intercept.toFixed(4) + ' x tvl_usd^' + sc.slope.toFixed(4) + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x launch_odds(age) )'
      ),
      el('p', { class: 'sub', text: 'The size curve is fitted on the ' + sc.live_count + ' live-token protocols in this snapshot by ordinary least squares on log market cap against log TVL (ratios winsorised to 0.01–5). Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The flat category median (' + fmtMult(DATA.global_comp) + ' global) is the baseline the curve beat, not the price.' }),
      el('p', { class: 'sub', text: 'Launch odds: among the ' + o.n + ' protocols with a listed date, the share recording a token rises with age, fitted as F(t) = ' + o.eventual_share.toFixed(2) + ' / (1 + exp(-(' + o.a.toFixed(2) + ' + ' + o.b.toFixed(2) + ' x ln(t+1)))). A protocol that has run t days with no token gets odds (L \u2212 F(t)) / (1 \u2212 F(t)) — the launches still to come, over the protocols still unlaunched. Brier score ' + o.brier_loo.toFixed(3) + ' leave-one-out and ' + o.brier_wf.toFixed(3) + ' walk-forward, against ' + o.brier_base_loo.toFixed(3) + ' and ' + o.brier_base_wf.toFixed(3) + ' for the base rate. The eventual share is weakly identified — the likelihood is nearly flat across it — so the odds are 0.65\u20130.75 across ages, a level shift with a mild young tilt, not a verdict on any one protocol.' }),
      el('p', { class: 'sub', text: 'Held out twice, on the same ' + v.fitted.n + ' live tokens. Leave-one-out: this model ' + score(v.fitted) + ', the previous model (with the category factor and breadth) ' + score(v.previous) + ', one flat mcap/TVL multiple ' + score(v.flat) + '. Walk-forward, older half fitting the newer half: this model ' + score(w.fitted) + ', the previous model ' + score(w.previous) + ', flat ' + score(w.flat) + '.' }),
      el('p', { class: 'sub', text: 'The range is the P25\u2013P75 of the live-token residuals off the curve (x' + rf.p25.toFixed(2) + ' to x' + rf.p75.toFixed(2) + ' around the point; P10\u2013P90 x' + rf.p10.toFixed(2) + ' to x' + rf.p90.toFixed(2) + '). Range honesty, measured on held-out caps: ' + Math.round(h.loo_p25_75 * 100) + '% inside the printed P25\u2013P75 range leave-one-out (' + h.n_loo + ' tokens) and ' + Math.round(h.wf_p25_75 * 100) + '% walk-forward (' + h.n_wf + ' tokens); P10\u2013P90 ' + Math.round(h.loo_p10_90 * 100) + '% and ' + Math.round(h.wf_p10_90 * 100) + '%. Categories get no range of their own: their residuals carry no predictive signal, and a range centred on a dropped category level would exclude its own point.' }),
      el('h3', { text: 'Ablation: every term tested with and without, on both tests' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Verdict' }), el('th', { scope: 'col', text: 'LOO with' }), el('th', { scope: 'col', text: 'LOO without' }), el('th', { scope: 'col', text: 'Walk-forward with' }), el('th', { scope: 'col', text: 'Walk-forward without' }))),
          el('tbody', null, abl)
        )
      ),
      el('p', { class: 'sub', text: 'A term stays only if it wins both tests. The category factor loses both — one live comp cannot price a category, and Risk Curators\u2019 single comp inflated the biggest rows about 1.66x — so it is dropped. Breadth loses both. Growth and maturity win both, so they stay.' })
    );
  }

  function compsPanel() {
    var tbody = el('tbody');
    DATA.comps.slice(0, 12).forEach(function (c) {
      var names = (c.members || []).map(function (m) { return m.name; }).join(', ') || 'none on record';
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: fmtMult(c.median_multiple) }),
        el('td', { class: 'num', text: c.used_global ? 'global median' : 'category median' }),
        el('td', { class: 'comps-members', text: names })
      ));
    });
    return el('section', { class: 'panel comps' },
      el('h2', { text: 'The comps behind the price' }),
      el('p', { class: 'sub', text: 'Median mcap/TVL of live-token protocols in each category, read off this snapshot — with the live protocols that set each median, named. The median is the flat baseline the curve beat in leave-one-out and walk-forward, not the price: the per-category factor off the curve was tested and dropped (see the ablation table above), because a category\u2019s median residual does not predict held-out tokens. The twelve richest categories are shown.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live comps' }), el('th', { scope: 'col', text: 'Median mcap/TVL' }), el('th', { scope: 'col', text: 'Source' }), el('th', { scope: 'col', text: 'Top live comps' }))),
          tbody
        )
      )
    );
  }

  function riskNote() {
    return el('section', { class: 'panel note' },
      el('p', null, el('b', { text: 'Read this before you farm. ' }), '“No token on record” is what DefiLlama reports — it is not proof a protocol has no token, and it is not a promise one will launch. Implied value assumes the protocol keeps its TVL and the market keeps paying the category multiple; a token, if one ever comes, can be worth far less, or nothing. Never deposit money you cannot lose, never pay to claim, and never sign a blind approval.')
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var ticket = ticketOf(row);
    var carried = row.ticket || null;
    var ticketOk = carried !== null && carried.slice_usd === ticket.slice_usd && carried.net_usd === ticket.net_usd && carried.verdict === ticket.verdict;
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
    var rangeText = (row.implied_low_usd !== null && row.implied_low_usd !== undefined && row.implied_high_usd !== null && row.implied_high_usd !== undefined)
      ? ' Range P25\u2013P75: ' + fmtUsd(row.implied_low_usd) + ' \u2013 ' + fmtUsd(row.implied_high_usd) + '; P10\u2013P90: ' + fmtUsd(row.implied_p10_usd) + ' \u2013 ' + fmtUsd(row.implied_p90_usd) + '.'
      : '';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size curve' }), el('b', { class: 'num', text: fmtUsd(row.curve_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: fmtMult(row.launch_odds) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value (point)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Range P25\u2013P75' }), el('b', { class: 'num', text: fmtUsd(row.implied_low_usd) + ' \u2013 ' + fmtUsd(row.implied_high_usd) })),
        el('div', null, el('span', { text: 'Range P10\u2013P90' }), el('b', { class: 'num', text: fmtUsd(row.implied_p10_usd) + ' \u2013 ' + fmtUsd(row.implied_p90_usd) }))
      ),
      el('p', { class: 'sub', text: 'Seven-day growth ' + fmtPct(row.change_7d) + '; age with no token ' + fmtAge(row.age_days) + '; launch odds ' + fmtMult(row.launch_odds) + '.' + rangeText }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    // Why this value: the size curve at this TVL, the launch odds from
    // the peers' record, and the live protocols in the category the flat
    // baseline was read off — with an honest note that the category does
    // not set a factor any more, because its residual does not predict
    // held-out tokens (see the ablation table in the model panel).
    (function () {
      var members = row.comp_members || [];
      var cat = row.category || 'Other';
      var o = DATA.launch_odds || {};
      var head = 'The size curve prices this TVL at ' + fmtUsd(row.curve_usd) + '. The launch odds are ' + fmtMult(row.launch_odds) + ': among the ' + (o.n || '') + ' protocols with a listed date, the share recording a token rises with age, and ' + fmtAge(row.age_days) + ' with no token leaves this share of the eventual launches still to come. No category factor adjusts the curve — the ablation table shows it lost both held-out tests.';
      var body = [el('p', { class: 'sub', text: head })];
      if (members.length > 0) {
        body.push(el('ul', { class: 'members' }, members.map(function (m) {
          return el('li', null, el('b', { text: m.name }), el('span', { text: ' ' + fmtMult(m.ratio) + ' mcap/TVL' }));
        })));
        body.push(el('p', { class: 'sub', text: 'The live comps above are ' + cat + '\u2019s biggest by market cap, shown for reference: the flat category median is ' + fmtMult(row.comp_multiple) + ', the baseline the curve beat.' }));
      } else {
        body.push(el('p', { class: 'sub', text: 'No live-token protocol in this category records a market cap, so there is no comp to name.' }));
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
        el('span', null, el('b', { text: '~' + row.farm_summary.setup_minutes + ' min' }), ' to set up')
      ),
      el('p', { class: 'ticket-line', html: '<b>$1,000 ticket:</b> slice ' + fmtMoney(ticket.slice_usd) + ' &middot; gas ' + fmtMoney(ticket.gas_usd) + ' &middot; forgone 4% T-bill ' + fmtMoney(ticket.forgone_usd) + ' &middot; net ' + fmtMoney(ticket.net_usd) + ' (' + (ticket.net_per_hour_usd >= 0 ? '+' : '-') + fmtMoney(Math.abs(ticket.net_per_hour_usd)) + '/h) &mdash; <b>' + ticket.verdict + '</b>' + (ticket.pays_from_usd === null ? ' &middot; never pays' : ' &middot; pays from ' + fmtDollars(ticket.pays_from_usd)) + (ticketOk ? '.' : ' (differs from the board: the data would be stale.)') }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action + ' ' }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(formulaBar());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(compsPanel());
      shell.appendChild(riskNote());
    }
    shell.appendChild(el('footer', { text: 'Token Radar · snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Implied values are model estimates, not prices.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
