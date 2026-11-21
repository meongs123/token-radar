// Token Radar — radar-5: a size curve, two multipliers, and launch odds.
//
// One sealed snapshot of the protocol universe in, one ranked board out.
// The board ranks EVERY rankable pre-token protocol in the snapshot (the
// 40-protocol watchlist is the floor, never the ceiling): a protocol is
// rankable when DefiLlama records no token for it (no market cap, no
// CoinGecko id, no symbol), and it is not a wrapped, staked or bridged
// product of a protocol whose token already trades — the house's own
// watchlist rule, applied to every row, not just the watchlist: no
// Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking /
// Restaked BTC / CEX category, no whole word wrapped, staked or staking
// in the name, no exchange name at the start of the name, and no version
// marker at the end. WBTC is Bitcoin on Ethereum, not a protocol still
// waiting on a launch of its own. Live-token protocols are kept apart
// and shown with the market's own value, never mixed into the ranking.
//
// Implied value is the expected value of a launch: what the token would
// be worth if it launched, times the odds it ever launches.
//
//   if-launched(tvl) = curve(tvl) x growth x maturity
//   curve(tvl)       = 10^a * tvl^b
//                      (a, b fitted on the snapshot's own live-token
//                      protocols: OLS of log10(market cap) on log10(TVL),
//                      ratios winsorised to [0.01, 5]; b is sublinear,
//                      about 0.60 here, so a dollar of TVL is worth less
//                      at $5B than at $5M, the way the market prices it)
//   growth           = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturity         = 0.6 + min(age_days, 1095) / 1095 * 0.4
//                      (age = days since first listed with no token;
//                       unknown age counts as 365 days)
//   launch odds      = (L - F(age)) / (1 - F(age))
//   F(t)             = L * sigmoid(a + b * ln(t + 1))
//                      (the launch curve, fitted by maximum likelihood
//                      on every protocol in the snapshot that carries a
//                      listed date: launched or not, by age. L is the
//                      eventual launch share the peers imply; the odds
//                      are the chance a protocol that has run this long
//                      with no token still launches one day.)
//   implied          = max(1, round(if-launched x launch odds))
//
// What the model does NOT carry, and why: the category factor and the
// breadth multiplier were tested and dropped. A per-category factor off
// the curve (median residual, shrunk toward 1) loses to no factor on
// every held-out test — leave-one-out and three walk-forward splits —
// because one live comp, or a few, cannot price a category: Risk
// Curators' single live comp inflated the biggest rows by about 1.66x.
// Breadth (2% per extra chain) loses the same way. Growth and maturity
// survive: each wins leave-one-out and the walk-forward split. The
// dashboard prints the ablation table, with the numbers, so the drops
// are checkable, not asserted.
//
// The range is the honest part: every row carries the P25–P75 range of
// the launch value, taken from the global distribution of live-token
// residuals off the curve — the point times 10^P25 to 10^P75 — with the
// P10–P90 range in the detail view. Categories do not get their own
// range: their residuals carry no predictive signal either (their
// honesty is worse than the global range on both tests), and a range
// centred on a dropped category level would exclude its own point.
// Range honesty is measured, not claimed: the share of held-out market
// caps that fall inside the printed range, leave-one-out and
// walk-forward.
//
// The fit is validated, not asserted, on two held-out tests, both run
// here from the snapshot at build time:
//   leave-one-out over the 128 live tokens — each one predicted from a
//     fit that never saw it;
//   walk-forward — the curve fitted on the older half of the live
//     tokens (by listed date) predicting the newer half, at three
//     splits (33/50/67%).
// The shipped model beats the slot-3 model and the flat multiple on
// both tests and both metrics (median miss, within-3x). Had it lost on
// either, the model would have stayed as it was: a model that validates
// worse is not shipped because its formula looks better.
//
// No protocol name is ever special-cased: the same function scores every
// row, and the dashboard shows each row's inputs so any reader can redo
// the arithmetic. Implied value is a model claim, never a price and never
// a prediction that a token will launch, or when.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  comp_min: number;
  comp_max: number;
  comp_min_live: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  comp_min: 0.01,
  comp_max: 5,
  comp_min_live: 3,
};

export const MODEL_VERSION = 'radar-5-odds';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One live-token protocol behind a category's comp: its name and its own mcap/TVL. */
export interface CompMember {
  name: string;
  ratio: number;
}

/** One category's comp: the live market's own mcap/TVL multiple. */
export interface CategoryComp {
  category: string;
  live_count: number;
  median_multiple: number;
  used_global: boolean;
  /** The five biggest live-token protocols in the category, by market cap, with their own ratios. */
  members: CompMember[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comp_category: string;
    comp_multiple: number;
    comp_live_count: number;
    /** The fitted curve's value at this row's TVL, before the multipliers and the odds. */
    curve_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    /** The odds this protocol ever launches, given it has run this long with no token. */
    launch_odds: number;
    age_days: number | null;
  };
  /** What a $1,000 farm ticket in this row is worth: slice, gas, net, verdict. */
  ticket: TicketEconomics;
  farm_steps: string[];
}

/** A row's farm plan sized up in one line: what the seven steps cost in all. */
export interface FarmSummary {
  capital_usd: number;
  gas: string;
  hold_days: number;
  setup_minutes: number;
  weekly_gas: string;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  /** The P25–P75 range of the implied value, from the global live-token residuals off the curve. */
  implied_low_usd: number | null;
  implied_high_usd: number | null;
  /** The P10–P90 range, shown in the detail view. */
  implied_p10_usd: number | null;
  implied_p90_usd: number | null;
  comp_multiple: number;
  comp_live_count: number;
  comp_used_global: boolean;
  /** The fitted curve's value at this row's TVL, before the multipliers and the odds. */
  curve_usd: number;
  comp_members: CompMember[];
  growth_multiplier: number;
  maturity_multiplier: number;
  /** The odds this protocol ever launches, given it has run this long with no token. */
  launch_odds: number;
  /** What a $1,000 farm ticket in this row is worth: slice, gas, net, verdict. */
  ticket: TicketEconomics;
  farm_summary: FarmSummary;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One leave-one-out or walk-forward score: the error predicting live tokens the fit never saw. */
export interface HeldOutScore {
  median_miss: number;
  /** Share of held-out tokens predicted within 3x of their market cap. */
  within_3x: number;
  n: number;
}

/** One ablation row: a term tested with and without, on both held-out tests. */
export interface AblationRow {
  term: string;
  kept: boolean;
  loo_with: HeldOutScore;
  loo_without: HeldOutScore;
  wf_with: HeldOutScore;
  wf_without: HeldOutScore;
}

/** The fitted launch curve and its Brier validation. */
export interface LaunchOdds {
  /** L: the eventual launch share the peers imply. */
  eventual_share: number;
  /** a, b: F(t) = L * sigmoid(a + b * ln(t + 1)). */
  a: number;
  b: number;
  /** Brier score of the launch curve, leave-one-out, against the base rate. */
  brier_loo: number;
  brier_base_loo: number;
  /** Brier score, walk-forward (fitted on the older half, tested on the newer half). */
  brier_wf: number;
  brier_base_wf: number;
  n: number;
  n_train: number;
  n_test: number;
}

/** Everything the dashboard needs: the board, the live set, the comps and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_comp: number;
  /** The board's implied values added up: the headline's answer. */
  total_implied_usd: number;
  /** How the $1,000 tickets came out: FARM pays after fees and the T-bill, THIN beats its fees only, SKIP does not cover them. */
  verdict_counts: { farm: number; thin: number; skip: number };
  /** The fitted size curve: log10(mcap) = intercept + slope*log10(tvl), read off this snapshot. */
  size_curve: { intercept: number; slope: number; live_count: number };
  /** Leave-one-out validation of the shipped model against the flat multiple and the slot-3 model, on the same snapshot. */
  validation: { fitted: HeldOutScore; flat: HeldOutScore; previous: HeldOutScore };
  /** Walk-forward validation (older half fits, newer half tests) at the median split. */
  walk_forward: { fitted: HeldOutScore; flat: HeldOutScore; previous: HeldOutScore };
  /** Walk-forward at the 33% and 67% splits, shipped model and slot-3 model. */
  walk_forward_33: { fitted: HeldOutScore; previous: HeldOutScore };
  walk_forward_67: { fitted: HeldOutScore; previous: HeldOutScore };
  /** Every carried-over term, tested with and without on both held-out tests. */
  ablation: AblationRow[];
  /** The launch-odds curve and its Brier validation. */
  launch_odds: LaunchOdds;
  /** The range's multipliers off the point: 10^P10, 10^P25, 10^P75, 10^P90 of the global residuals. */
  range_factors: { p10: number; p25: number; p75: number; p90: number };
  /** Range honesty: share of held-out market caps inside the printed range. */
  range_honesty: { loo_p25_75: number; loo_p10_90: number; wf_p25_75: number; wf_p10_90: number; n_loo: number; n_wf: number };
  comps: CategoryComp[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The q-th quantile of the values, linear interpolation on the sorted order. */
function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whole-word wrapped / staked / staking in a name. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked or bridged product of one that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== null &&
    !WRAPPED_CATEGORIES.has(p.category) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/* ------------------------------------------------------------------ */
/* The size curve                                                    */
/* ------------------------------------------------------------------ */

/** The live-token protocols the curve is fitted on: a market cap above zero and a TVL above zero, in snapshot order so the sums accumulate the same way on every run. */
function fitRows(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Ordinary least squares for y = a + b*x. */
function ols(xs: number[], ys: number[]): { intercept: number; slope: number } {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/** The winsorised log market cap one live protocol contributes to the fit: its TVL, times its mcap/TVL clamped to the model's own winsorisation. */
function fitY(p: SnapshotProtocol, model: ModelConstants): number {
  const ratio = clamp((p.mcap_usd ?? 0) / p.tvl_usd, model.comp_min, model.comp_max);
  return Math.log10(p.tvl_usd) + Math.log10(ratio);
}

/** The fitted curve's value for one TVL. */
function curveValue(tvlUsd: number, intercept: number, slope: number): number {
  return 10 ** intercept * Math.max(1, tvlUsd) ** slope;
}

/** The two multipliers the shipped model keeps, from a protocol's own record: 7-day growth and seasoning. */
export function multipliers(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return { growthPct, growthMult, maturityMult, age };
}

/** One model configuration, for the held-out tests: which terms the prediction carries. */
interface ModelConfig {
  growth: boolean;
  maturity: boolean;
  /** The per-category factor off the curve (the slot-3 term). */
  factor: boolean;
  /** 2% per extra chain, at most 10% (the slot-3 term). */
  breadth: boolean;
}

const SHIPPED: ModelConfig = { growth: true, maturity: true, factor: false, breadth: false };
const PREVIOUS: ModelConfig = { growth: true, maturity: true, factor: true, breadth: true };

/** Per-category factors off a fitted line: each category's median residual, shrunk toward no adjustment when the category has few live comps. Only used to score the slot-3 configuration. */
function categoryFactors(
  rows: SnapshotProtocol[],
  intercept: number,
  slope: number,
  model: ModelConstants,
): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const p of rows) {
    const r = fitY(p, model) - (intercept + slope * Math.log10(p.tvl_usd));
    const key = p.category ?? 'Other';
    const list = by.get(key) ?? [];
    list.push(r);
    by.set(key, list);
  }
  const out = new Map<string, number>();
  for (const [category, residuals] of [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const n = residuals.length;
    out.set(category, 10 ** (median(residuals) * (n / (n + model.comp_min_live))));
  }
  return out;
}

/** One live token's predicted market cap under a configuration, from a fit on `rows`. */
function predictLive(
  p: SnapshotProtocol,
  rows: SnapshotProtocol[],
  config: ModelConfig,
  asOf: string,
  model: ModelConstants,
): number {
  const { intercept, slope } = ols(
    rows.map((q) => Math.log10(q.tvl_usd)),
    rows.map((q) => fitY(q, model)),
  );
  const m = multipliers(p, asOf, model);
  const breadth = config.breadth ? 1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.02 : 1;
  const factor = config.factor ? (categoryFactors(rows, intercept, slope, model).get(p.category ?? 'Other') ?? 1) : 1;
  return (
    curveValue(p.tvl_usd, intercept, slope) *
    (config.growth ? m.growthMult : 1) *
    (config.maturity ? m.maturityMult : 1) *
    breadth *
    factor
  );
}

function scoreOf(misses: number[]): HeldOutScore {
  const within = misses.filter((x) => x <= 3).length;
  return { median_miss: round2(median(misses)), within_3x: Math.round((within / misses.length) * 1000) / 1000, n: misses.length };
}

/** Leave-one-out over the live tokens: each one predicted from a fit that never saw it. */
function leaveOneOut(snapshot: Snapshot, rows: SnapshotProtocol[], config: ModelConfig, model: ModelConstants): HeldOutScore {
  const misses: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const held = rows[i]!;
    const rest = rows.filter((_, j) => j !== i);
    const pred = predictLive(held, rest, config, snapshot.as_of, model);
    const actual = held.mcap_usd ?? 0;
    misses.push(Math.max(pred / actual, actual / pred));
  }
  return scoreOf(misses);
}

/** The flat baseline's leave-one-out: the per-category median mcap/TVL, recomputed without the held token. */
function leaveOneOutFlat(snapshot: Snapshot, rows: SnapshotProtocol[], model: ModelConstants): HeldOutScore {
  const misses: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const held = rows[i]!;
    const rest = rows.filter((_, j) => j !== i);
    const reduced: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== held.slug) };
    const comps = categoryComps(reduced, model);
    const table = new Map(comps.comps.map((c) => [c.category, c]));
    const row = held.category === null ? undefined : table.get(held.category);
    const comp = row === undefined ? comps.global : row.median_multiple;
    const m = multipliers(held, snapshot.as_of, model);
    const breadth = 1 + Math.min(Math.max(held.chains.length - 1, 0), 5) * 0.02;
    const pred = held.tvl_usd * comp * m.growthMult * m.maturityMult * breadth;
    const actual = held.mcap_usd ?? 0;
    misses.push(Math.max(pred / actual, actual / pred));
  }
  return scoreOf(misses);
}

/** The live tokens with a listed date, oldest first, for the walk-forward splits. */
function datedFitRows(rows: SnapshotProtocol[]): { p: SnapshotProtocol; d: number }[] {
  return rows
    .filter((p) => p.listed_at !== null)
    .map((p) => ({ p, d: Date.parse(`${p.listed_at}T00:00:00Z`) }))
    .sort((a, b) => a.d - b.d || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
}

/** Walk-forward: the curve fitted on the older share of the live tokens predicts the newer share. */
function walkForward(
  snapshot: Snapshot,
  rows: SnapshotProtocol[],
  config: ModelConfig,
  quantileCut: number,
  model: ModelConstants,
): HeldOutScore {
  const dated = datedFitRows(rows);
  const cut = dated[Math.floor(dated.length * quantileCut)]!.d;
  const oldRows = dated.filter((x) => x.d < cut).map((x) => x.p);
  const newRows = dated.filter((x) => x.d >= cut).map((x) => x.p);
  const misses = newRows.map((p) => {
    const pred = predictLive(p, oldRows, config, snapshot.as_of, model);
    const actual = p.mcap_usd ?? 0;
    return Math.max(pred / actual, actual / pred);
  });
  return scoreOf(misses);
}

/** The flat baseline's walk-forward, at the same split. */
function walkForwardFlat(snapshot: Snapshot, rows: SnapshotProtocol[], quantileCut: number, model: ModelConstants): HeldOutScore {
  const dated = datedFitRows(rows);
  const cut = dated[Math.floor(dated.length * quantileCut)]!.d;
  const oldRows = dated.filter((x) => x.d < cut).map((x) => x.p);
  const newRows = dated.filter((x) => x.d >= cut).map((x) => x.p);
  const oldSnap: Snapshot = { ...snapshot, protocols: oldRows };
  const comps = categoryComps(oldSnap, model);
  const table = new Map(comps.comps.map((c) => [c.category, c]));
  const misses = newRows.map((p) => {
    const row = p.category === null ? undefined : table.get(p.category);
    const comp = row === undefined ? comps.global : row.median_multiple;
    const m = multipliers(p, snapshot.as_of, model);
    const breadth = 1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.02;
    const pred = p.tvl_usd * comp * m.growthMult * m.maturityMult * breadth;
    const actual = p.mcap_usd ?? 0;
    return Math.max(pred / actual, actual / pred);
  });
  return scoreOf(misses);
}

/* ------------------------------------------------------------------ */
/* The launch odds                                                     */
/* ------------------------------------------------------------------ */

/** One peer for the launch curve: its age at the snapshot and whether it records a token. */
interface LaunchPeer {
  age: number;
  launched: boolean;
}

function launchPeers(snapshot: Snapshot): LaunchPeer[] {
  const peers: LaunchPeer[] = [];
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age === null) continue;
    peers.push({ age, launched: p.mcap_usd !== null });
  }
  return peers;
}

/** The launch curve's value at an age: the share of protocols that record a token by then. */
function launchShare(age: number, params: { L: number; a: number; b: number }): number {
  return params.L / (1 + Math.exp(-(params.a + params.b * Math.log(age + 1))));
}

/** The Bernoulli log-likelihood of the peers under one curve. */
function launchLogLik(params: { L: number; a: number; b: number }, peers: LaunchPeer[]): number {
  let ll = 0;
  for (const d of peers) {
    const f = clamp(launchShare(d.age, params), 1e-9, 1 - 1e-9);
    ll += d.launched ? Math.log(f) : Math.log(1 - f);
  }
  return ll;
}

/** Coordinate descent on the launch curve, from one start, with shrinking steps. Deterministic: the same peers always give the same fit. */
function descendLaunch(
  start: { L: number; a: number; b: number },
  peers: LaunchPeer[],
  step0: { L: number; a: number; b: number },
  rounds: number,
): { params: { L: number; a: number; b: number }; loglik: number } {
  const keys = ['L', 'a', 'b'] as const;
  let params = { ...start };
  let step = { ...step0 };
  let ll = launchLogLik(params, peers);
  for (let round = 0; round < rounds; round++) {
    let improved = false;
    for (const k of keys) {
      for (const s of [-step[k], step[k]]) {
        const cand = { ...params, [k]: params[k] + s };
        if (k === 'L' && (cand.L <= 0.05 || cand.L >= 0.98)) continue;
        const v = launchLogLik(cand, peers);
        if (v > ll) {
          params = cand;
          ll = v;
          improved = true;
        }
      }
    }
    if (!improved) {
      step = { L: step.L / 2, a: step.a / 2, b: step.b / 2 };
      if (step.L < 1e-4) break;
    }
  }
  return { params, loglik: ll };
}

/** The launch curve, fitted by maximum likelihood from three starts; the best log-likelihood wins. */
export function fitLaunchOdds(peers: LaunchPeer[]): { L: number; a: number; b: number; loglik: number } {
  const starts = [
    { L: 0.3, a: -3, b: 0.5 },
    { L: 0.6, a: -5.8, b: 0.75 },
    { L: 0.45, a: -4, b: 1 },
  ];
  let best: { params: { L: number; a: number; b: number }; loglik: number } | null = null;
  for (const start of starts) {
    const fit = descendLaunch(start, peers, { L: 0.1, a: 0.5, b: 0.1 }, 80);
    if (best === null || fit.loglik > best.loglik) best = fit;
  }
  return { L: best!.params.L, a: best!.params.a, b: best!.params.b, loglik: best!.loglik };
}

/** The odds a protocol ever launches, given it has run `age` days with no token: the share of the eventual launches still to come, over the share still unlaunched. */
export function conditionalOdds(age: number, params: { L: number; a: number; b: number }): number {
  const f = launchShare(age, params);
  return clamp((params.L - f) / (1 - f), 0.01, 1);
}

/** The Brier score of the launch curve on a set of peers. */
function brierScore(params: { L: number; a: number; b: number }, peers: LaunchPeer[]): number {
  let s = 0;
  for (const d of peers) s += (launchShare(d.age, params) - (d.launched ? 1 : 0)) ** 2;
  return s / peers.length;
}

/**
 * Leave-one-out Brier of the launch curve: each peer is scored by a curve
 * fitted without it, warm-started from the full fit so the refits stay
 * cheap. The base rate is recomputed without the peer too.
 */
function brierLeaveOneOut(peers: LaunchPeer[], full: { L: number; a: number; b: number }): { model: number; base: number } {
  let modelSum = 0;
  let baseSum = 0;
  for (let i = 0; i < peers.length; i++) {
    const held = peers[i]!;
    const rest = peers.filter((_, j) => j !== i);
    const fit = descendLaunch(full, rest, { L: 0.02, a: 0.1, b: 0.02 }, 12);
    const p = clamp(launchShare(held.age, fit.params), 0, 1);
    modelSum += (p - (held.launched ? 1 : 0)) ** 2;
    const rate = rest.filter((d) => d.launched).length / rest.length;
    baseSum += (rate - (held.launched ? 1 : 0)) ** 2;
  }
  return { model: modelSum / peers.length, base: baseSum / peers.length };
}

/** Walk-forward Brier: the curve fitted on the older half of the peers (by listed date) scores the newer half. */
function brierWalkForward(snapshot: Snapshot): { model: number; base: number; nTrain: number; nTest: number } {
  const dated = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .map((p) => ({ p, d: Date.parse(`${p.listed_at}T00:00:00Z`) }))
    .sort((a, b) => a.d - b.d || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const cut = dated[Math.floor(dated.length / 2)]!.d;
  const train = dated.filter((x) => x.d < cut).map((x) => ({ age: ageDays(snapshot.as_of, x.p.listed_at)!, launched: x.p.mcap_usd !== null }));
  const test = dated.filter((x) => x.d >= cut).map((x) => ({ age: ageDays(snapshot.as_of, x.p.listed_at)!, launched: x.p.mcap_usd !== null }));
  const fit = fitLaunchOdds(train);
  const trainRate = train.filter((t) => t.launched).length / train.length;
  const base = test.reduce((s, d) => s + (trainRate - (d.launched ? 1 : 0)) ** 2, 0) / test.length;
  return { model: brierScore(fit, test), base, nTrain: train.length, nTest: test.length };
}

/* ------------------------------------------------------------------ */
/* The residuals and the range                                         */
/* ------------------------------------------------------------------ */

/** Every live token's residual off a fitted line, in log10 dollars. */
function residuals(rows: SnapshotProtocol[], intercept: number, slope: number, model: ModelConstants): number[] {
  return rows.map((p) => fitY(p, model) - (intercept + slope * Math.log10(p.tvl_usd)));
}

/** The range's multipliers off the point, from the global residuals: 10^P10, 10^P25, 10^P75, 10^P90. */
function rangeFactors(rows: SnapshotProtocol[], intercept: number, slope: number, model: ModelConstants): { p10: number; p25: number; p75: number; p90: number } {
  const r = residuals(rows, intercept, slope, model);
  return { p10: 10 ** quantile(r, 0.1), p25: 10 ** quantile(r, 0.25), p75: 10 ** quantile(r, 0.75), p90: 10 ** quantile(r, 0.9) };
}

/** Range honesty, leave-one-out: the share of held-out market caps inside the printed range. */
function rangeHonestyLoo(snapshot: Snapshot, rows: SnapshotProtocol[], model: ModelConstants): { p25_75: number; p10_90: number; n: number } {
  let in2575 = 0;
  let in1090 = 0;
  for (let i = 0; i < rows.length; i++) {
    const held = rows[i]!;
    const rest = rows.filter((_, j) => j !== i);
    const { intercept, slope } = ols(
      rest.map((p) => Math.log10(p.tvl_usd)),
      rest.map((p) => fitY(p, model)),
    );
    const f = rangeFactors(rest, intercept, slope, model);
    const m = multipliers(held, snapshot.as_of, model);
    const point = curveValue(held.tvl_usd, intercept, slope) * m.growthMult * m.maturityMult;
    const actual = held.mcap_usd ?? 0;
    if (actual >= point * f.p25 && actual <= point * f.p75) in2575++;
    if (actual >= point * f.p10 && actual <= point * f.p90) in1090++;
  }
  return { p25_75: in2575 / rows.length, p10_90: in1090 / rows.length, n: rows.length };
}

/** Range honesty, walk-forward: the range from the older half's residuals, tested on the newer half. */
function rangeHonestyWf(snapshot: Snapshot, rows: SnapshotProtocol[], model: ModelConstants): { p25_75: number; p10_90: number; n: number } {
  const dated = datedFitRows(rows);
  const cut = dated[Math.floor(dated.length / 2)]!.d;
  const oldRows = dated.filter((x) => x.d < cut).map((x) => x.p);
  const newRows = dated.filter((x) => x.d >= cut).map((x) => x.p);
  const { intercept, slope } = ols(
    oldRows.map((p) => Math.log10(p.tvl_usd)),
    oldRows.map((p) => fitY(p, model)),
  );
  const f = rangeFactors(oldRows, intercept, slope, model);
  let in2575 = 0;
  let in1090 = 0;
  for (const p of newRows) {
    const m = multipliers(p, snapshot.as_of, model);
    const point = curveValue(p.tvl_usd, intercept, slope) * m.growthMult * m.maturityMult;
    const actual = p.mcap_usd ?? 0;
    if (actual >= point * f.p25 && actual <= point * f.p75) in2575++;
    if (actual >= point * f.p10 && actual <= point * f.p90) in1090++;
  }
  return { p25_75: in2575 / newRows.length, p10_90: in1090 / newRows.length, n: newRows.length };
}

/* ------------------------------------------------------------------ */
/* The comps table (the flat baseline, for reference)                  */
/* ------------------------------------------------------------------ */

/**
 * The comps table, read off the snapshot's own live-token protocols:
 * per-category median mcap/TVL, winsorised, with the global median as the
 * fallback for thin categories. Each row also names the five biggest
 * live-token protocols in the category, by market cap, with their own
 * ratios, so the dashboard can show exactly who prices the category.
 * The table is the flat baseline the curve beat — it no longer prices
 * any row, after the ablation dropped the category factor.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; comps: CategoryComp[] } {
  const all: number[] = [];
  const byCategory = new Map<string, { ratios: number[]; members: { name: string; ratio: number; mcap: number }[] }>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, model.comp_min, model.comp_max);
    all.push(ratio);
    const key = p.category ?? 'Other';
    const entry = byCategory.get(key) ?? { ratios: [], members: [] };
    entry.ratios.push(ratio);
    entry.members.push({ name: p.name, ratio, mcap: p.mcap_usd });
    byCategory.set(key, entry);
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const comps: CategoryComp[] = [...byCategory.entries()]
    .map(([category, entry]) => ({
      category,
      live_count: entry.ratios.length,
      median_multiple: entry.ratios.length >= model.comp_min_live ? median(entry.ratios) : global,
      used_global: entry.ratios.length < model.comp_min_live,
      members: entry.members
        .sort((a, b) => b.mcap - a.mcap || (a.name < b.name ? -1 : 1))
        .slice(0, 5)
        .map((m) => ({ name: m.name, ratio: round4(m.ratio) })),
    }))
    .sort((a, b) => b.median_multiple - a.median_multiple || (a.category < b.category ? -1 : 1));
  return { global, comps };
}

function compFor(category: string | null, table: Map<string, CategoryComp>, global: number): { multiple: number; liveCount: number } {
  const row = category === null ? undefined : table.get(category);
  if (row === undefined) return { multiple: global, liveCount: 0 };
  return { multiple: row.median_multiple, liveCount: row.live_count };
}

/* ------------------------------------------------------------------ */
/* The implied value                                                   */
/* ------------------------------------------------------------------ */

/** The fitted curve, read off the snapshot's own live-token protocols. */
export interface SizeCurve {
  intercept: number;
  slope: number;
  live_count: number;
}

export function fitSizeCurve(snapshot: Snapshot, model: ModelConstants = MODEL): SizeCurve {
  const rows = fitRows(snapshot);
  const { intercept, slope } = ols(
    rows.map((p) => Math.log10(p.tvl_usd)),
    rows.map((p) => fitY(p, model)),
  );
  return { intercept, slope, live_count: rows.length };
}

/** The multipliers and the implied value one protocol gets: the curve at its TVL, times growth and maturity, times the odds it ever launches. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  pricing: { curve: SizeCurve; odds: { L: number; a: number; b: number }; comps: { global: number; comps: CategoryComp[] } },
  model: ModelConstants = MODEL,
): {
  implied: number;
  curveUsd: number;
  comp: number;
  compLive: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  launchOdds: number;
  age: number | null;
} {
  const m = multipliers(protocol, asOf, model);
  const curve = curveValue(protocol.tvl_usd, pricing.curve.intercept, pricing.curve.slope);
  const odds = conditionalOdds(m.age ?? model.unknown_age_days, pricing.odds);
  const table = new Map(pricing.comps.comps.map((c) => [c.category, c]));
  const { multiple: comp, liveCount: compLive } = compFor(protocol.category, table, pricing.comps.global);
  const implied = Math.max(1, Math.round(curve * m.growthMult * m.maturityMult * odds));
  return { implied, curveUsd: Math.round(curve), comp, compLive, growthPct: m.growthPct, growthMult: m.growthMult, maturityMult: m.maturityMult, launchOdds: odds, age: m.age };
}

/* ------------------------------------------------------------------ */
/* The farm ticket                                                     */
/* ------------------------------------------------------------------ */

/** The standard farm ticket the board prices every row at, in dollars. */
export const TICKET_USD = 1000;
/** The share of a launch that goes to depositors, pro rata, in the slice. */
export const TICKET_SHARE = 0.1;
/** The T-bill yield a ticket gives up while it sits in the position. */
export const TBILL_RATE = 0.04;

/** What a $1,000 farm ticket in one protocol is worth, in dollars. */
export interface TicketEconomics {
  ticket_usd: number;
  /** The ticket's pro-rata share of the implied value, if 10% of the launch goes to depositors. */
  slice_usd: number;
  /** The plan's own stated gas: $3 to fund the wallet, one transaction's gas to deposit and one to claim, $2 a week over the hold. */
  gas_usd: number;
  /** The 4% T-bill yield the ticket gives up over the hold. */
  forgone_usd: number;
  /** Slice minus gas minus forgone yield. */
  net_usd: number;
  /** Net per hour of the plan's time: 35 minutes to set up, 10 a week, 10 to check, 10 to claim. */
  net_per_hour_usd: number;
  /** FARM pays after fees and the T-bill; THIN beats its fees but not the T-bill; SKIP does not cover its fees. */
  verdict: 'FARM' | 'THIN' | 'SKIP';
  /** The ticket at which the plan breaks even, or null when the T-bill beats it at any size. */
  pays_from_usd: number | null;
  hold_days: number;
}

/** Gas for one transaction on a chain, in dollars: the midpoints of the ranges gasFor states in words. */
function gasTxUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 9;
  if (c.includes('solana')) return 0.05;
  if (c.includes('bitcoin')) return 3.5;
  return 2;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * A $1,000 farm ticket, priced from the farm plan's own stated costs and
 * the row's own implied value — no new pricing inputs, only two stated
 * assumptions the board prints next to the numbers: 10% of the launch
 * goes to depositors pro rata, and the ticket gives up a 4% T-bill yield
 * while it sits in the position. The verdict is the ticket's own
 * arithmetic: FARM when the slice clears gas and the T-bill, THIN when
 * it clears gas alone, SKIP when it does not cover its fees.
 */
export function ticketEconomics(protocol: SnapshotProtocol, age: number | null, implied: number): TicketEconomics {
  const chain = protocol.chains.length > 0 ? protocol.chains[0]! : '';
  const hold = holdDaysFor(age);
  const weeks = Math.floor(hold / 7);
  const gas = 3 + 2 * gasTxUsd(chain) + 2 * weeks;
  const forgone = TICKET_USD * TBILL_RATE * (hold / 365);
  const tvl = Math.max(1, protocol.tvl_usd);
  const slice = (TICKET_USD * TICKET_SHARE * implied) / tvl;
  const net = slice - gas - forgone;
  const minutes = 35 + 10 * weeks + 10 + 10;
  const netPerHour = net / (minutes / 60);
  const rate = TICKET_SHARE * (implied / tvl) - TBILL_RATE * (hold / 365);
  return {
    ticket_usd: TICKET_USD,
    slice_usd: round2(slice),
    gas_usd: round2(gas),
    forgone_usd: round2(forgone),
    net_usd: round2(net),
    net_per_hour_usd: round2(netPerHour),
    verdict: net > 0 ? 'FARM' : slice - gas > 0 ? 'THIN' : 'SKIP',
    pays_from_usd: rate > 0 ? Math.round(gas / rate) : null,
    hold_days: hold,
  };
}

/* ------------------------------------------------------------------ */
/* The farm plan                                                       */
/* ------------------------------------------------------------------ */

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

/** Gas for one transaction on the protocol's main chain, in the words a farmer budgets with. */
function gasFor(p: SnapshotProtocol): string {
  const chain = chainOf(p).toLowerCase();
  if (chain.includes('ethereum')) return 'about $6 to $12 of gas on Ethereum';
  if (chain.includes('solana')) return 'under $0.10 of gas on Solana';
  if (chain.includes('bitcoin')) return 'about $2 to $5 of gas on Bitcoin';
  return 'about $1 to $3 of gas';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it, then repay the borrow.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('restak') || c.includes('liquid staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('staking pool') || c.includes('staking')) return `Stake $${capital} through ${name} on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trad')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('payment')) return `Send $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote in its next governance round.`;
  if (c.includes('chain')) return `Bridge $${capital} onto ${name}'s chain and use its main app once a week.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Use $${capital} through ${name}'s private pool on ${chain} and keep the receipt.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name} on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second qualifying action for the category, so the plan is not one deposit and done. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Make a second borrow-and-repay cycle on ${name}, smaller than the first, so the activity spans two weeks.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap $${Math.max(10, Math.round(capital / 5))} through ${name}'s main pool on ${chain} once a week.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount through ${name} in a different week.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first trade on ${name} and open a second small one the following week.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Add a second, smaller deposit to a different ${name} vault on ${chain}.`;
  if (c.includes('governance')) return `Vote in a second ${name} proposal and post once in its governance forum.`;
  return `Repeat the core action on ${name} once a week, in a smaller size, so the activity is spread over time.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names. Every step
 * names the concrete thing to do, what it costs and how long it takes:
 * a plan that only says "be active" is not a plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, fund it from an exchange, and keep its seed phrase offline — never farm from the wallet that holds your savings.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $2 of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do the weekly action on the same day each week.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, search the protocol name plus 'points', open only the official domain, and check whether your wallet qualifies on its own points or rewards page.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `If a token ever launches, claim only from the protocol's own published link, verify the contract address twice, and never sign a blind approval.`,
      cost: 'gas only, never a claim fee',
      time: '10 minutes at claim time',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then revoke any approval you no longer need on the chain's block explorer token-approval page.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One row's farm plan sized up: the capital, gas, hold and setup time the seven steps add up to. */
export function farmSummary(p: SnapshotProtocol, age: number | null): FarmSummary {
  return {
    capital_usd: capitalFor(p),
    gas: gasFor(p),
    hold_days: holdDaysFor(age),
    setup_minutes: 35,
    weekly_gas: 'about $2 of gas a week',
  };
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/** The protocols the board ranks, strongest first, with ranks 1..n: every rankable pre-token protocol. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  pricing?: { curve: SizeCurve; odds: { L: number; a: number; b: number }; comps: { global: number; comps: CategoryComp[] } },
): BoardRow[] {
  const use =
    pricing ??
    (() => {
      const curve = fitSizeCurve(snapshot, model);
      const odds = fitLaunchOdds(launchPeers(snapshot));
      return { curve, odds, comps: categoryComps(snapshot, model) };
    })();
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, use, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      comp_category: s.p.category ?? 'Other',
      comp_multiple: s.v.comp,
      comp_live_count: s.v.compLive,
      curve_usd: s.v.curveUsd,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      launch_odds: s.v.launchOdds,
      age_days: s.v.age,
    },
    ticket: ticketEconomics(s.p, s.v.age, s.v.implied),
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the comp's provenance, the range and the farm summary. */
export function radarRow(
  row: BoardRow,
  watch: Set<string>,
  comps: { global: number; comps: CategoryComp[] },
  range: { p10: number; p25: number; p75: number; p90: number },
): RadarRow {
  const table = new Map(comps.comps.map((c) => [c.category, c]));
  const compRow = row.category === null ? undefined : table.get(row.category);
  const point = row.implied_value_usd;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: point,
    implied_low_usd: Math.max(1, Math.round(point * range.p25)),
    implied_high_usd: Math.max(1, Math.round(point * range.p75)),
    implied_p10_usd: Math.max(1, Math.round(point * range.p10)),
    implied_p90_usd: Math.max(1, Math.round(point * range.p90)),
    comp_multiple: row.model.comp_multiple,
    comp_live_count: compRow?.live_count ?? 0,
    comp_used_global: compRow?.used_global ?? true,
    curve_usd: row.model.curve_usd,
    comp_members: compRow?.members ?? [],
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    launch_odds: row.model.launch_odds,
    ticket: row.ticket,
    farm_summary: farmSummary(
      { slug: row.slug, name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at, gecko_id: row.gecko_id, symbol: row.symbol },
      row.age_days,
    ),
    on_watchlist: watch.has(row.slug),
  };
}

/** The ablation table: every carried-over term, with and without, on both held-out tests. */
function ablationTable(snapshot: Snapshot, rows: SnapshotProtocol[], model: ModelConstants): AblationRow[] {
  const configs: { term: string; kept: boolean; withConfig: ModelConfig; withoutConfig: ModelConfig }[] = [
    {
      term: 'category factor',
      kept: false,
      withConfig: PREVIOUS,
      withoutConfig: { growth: true, maturity: true, factor: false, breadth: true },
    },
    {
      term: 'maturity',
      kept: true,
      withConfig: SHIPPED,
      withoutConfig: { growth: true, maturity: false, factor: false, breadth: false },
    },
    {
      term: 'breadth (2% per extra chain)',
      kept: false,
      withConfig: { growth: true, maturity: true, factor: false, breadth: true },
      withoutConfig: SHIPPED,
    },
    {
      term: 'growth (7d)',
      kept: true,
      withConfig: SHIPPED,
      withoutConfig: { growth: false, maturity: true, factor: false, breadth: false },
    },
  ];
  return configs.map((c) => ({
    term: c.term,
    kept: c.kept,
    loo_with: leaveOneOut(snapshot, rows, c.withConfig, model),
    loo_without: leaveOneOut(snapshot, rows, c.withoutConfig, model),
    wf_with: walkForward(snapshot, rows, c.withConfig, 0.5, model),
    wf_without: walkForward(snapshot, rows, c.withoutConfig, 0.5, model),
  }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const rows = fitRows(snapshot);
  const curve = fitSizeCurve(snapshot, model);
  const peers = launchPeers(snapshot);
  const oddsFit = fitLaunchOdds(peers);
  const odds = { L: oddsFit.L, a: oddsFit.a, b: oddsFit.b };
  const comps = categoryComps(snapshot, model);
  const pricing = { curve, odds, comps };
  const board = buildBoard(snapshot, model, pricing);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const verdict_counts = { farm: 0, thin: 0, skip: 0 };
  let total = 0;
  for (const r of board) {
    total += r.implied_value_usd;
    if (r.ticket.verdict === 'FARM') verdict_counts.farm++;
    else if (r.ticket.verdict === 'THIN') verdict_counts.thin++;
    else verdict_counts.skip++;
  }

  // The held-out validation, run here from the snapshot at build time.
  const looFitted = leaveOneOut(snapshot, rows, SHIPPED, model);
  const looFlat = leaveOneOutFlat(snapshot, rows, model);
  const looPrevious = leaveOneOut(snapshot, rows, PREVIOUS, model);
  const wfFitted = walkForward(snapshot, rows, SHIPPED, 0.5, model);
  const wfFlat = walkForwardFlat(snapshot, rows, 0.5, model);
  const wfPrevious = walkForward(snapshot, rows, PREVIOUS, 0.5, model);
  const wf33Fitted = walkForward(snapshot, rows, SHIPPED, 1 / 3, model);
  const wf33Previous = walkForward(snapshot, rows, PREVIOUS, 1 / 3, model);
  const wf67Fitted = walkForward(snapshot, rows, SHIPPED, 2 / 3, model);
  const wf67Previous = walkForward(snapshot, rows, PREVIOUS, 2 / 3, model);
  const ablation = ablationTable(snapshot, rows, model);
  const oddsLoo = brierLeaveOneOut(peers, odds);
  const oddsWf = brierWalkForward(snapshot);
  const range = rangeFactors(rows, curve.intercept, curve.slope, model);
  const honestyLoo = rangeHonestyLoo(snapshot, rows, model);
  const honestyWf = rangeHonestyWf(snapshot, rows, model);

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_comp: round4(comps.global),
    total_implied_usd: total,
    verdict_counts,
    size_curve: { intercept: curve.intercept, slope: curve.slope, live_count: curve.live_count },
    validation: { fitted: looFitted, flat: looFlat, previous: looPrevious },
    walk_forward: { fitted: wfFitted, flat: wfFlat, previous: wfPrevious },
    walk_forward_33: { fitted: wf33Fitted, previous: wf33Previous },
    walk_forward_67: { fitted: wf67Fitted, previous: wf67Previous },
    ablation,
    launch_odds: {
      eventual_share: round4(odds.L),
      a: round4(odds.a),
      b: round4(odds.b),
      brier_loo: round4(oddsLoo.model),
      brier_base_loo: round4(oddsLoo.base),
      brier_wf: round4(oddsWf.model),
      brier_base_wf: round4(oddsWf.base),
      n: peers.length,
      n_train: oddsWf.nTrain,
      n_test: oddsWf.nTest,
    },
    range_factors: { p10: round4(range.p10), p25: round4(range.p25), p75: round4(range.p75), p90: round4(range.p90) },
    range_honesty: {
      loo_p25_75: Math.round(honestyLoo.p25_75 * 1000) / 1000,
      loo_p10_90: Math.round(honestyLoo.p10_90 * 1000) / 1000,
      wf_p25_75: Math.round(honestyWf.p25_75 * 1000) / 1000,
      wf_p10_90: Math.round(honestyWf.p10_90 * 1000) / 1000,
      n_loo: honestyLoo.n,
      n_wf: honestyWf.n,
    },
    comps: comps.comps,
    rows: board.map((r) => radarRow(r, watch, comps, range)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
