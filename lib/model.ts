// Token Radar — comps-calibrated implied-value model (radar-3).
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
// Implied value is calibrated on the snapshot itself, not on a flat guess:
// the market's own mcap/TVL multiple for each category is read off the
// live-token protocols in the same snapshot, so a lending protocol is
// priced like lending protocols that already trade, and a DEX like DEXs.
//
//   comp(category) = median(mcap_usd / tvl_usd) over live-token protocols
//                    in that category (winsorised to [0.01, 5]); categories
//                    with fewer than 3 live comps use the global median.
//   growth         = clamp(change_7d, -60, 120) per cent
//   growthMult     = 1 + (growth / 100) * 0.5
//   maturity       = 0.6 + min(age_days, 1095) / 1095 * 0.4
//                    (age = days since first listed with no token;
//                     unknown age counts as 365 days)
//   breadth        = 1 + 0.02 * min(chains - 1, 5)   (at most 1.10)
//   implied        = max(1, round(tvl_usd * comp * growthMult
//                                  * maturity * breadth))
//
// radar-3 adds what the detail view needs to defend the number: every
// category's comp now names the live protocols it was read off (the five
// biggest by market cap, with their own ratios), and every row carries
// whether its multiple is its category's median or the global fallback —
// 84 of the 198 rows fall back, most of all the Risk Curators at the top,
// whose single live comp (Api3, 2.98x) is too thin to price a category.
// The dashboard says so on the row, instead of printing a bare 0.17x.
// Farm plans stay derived from the protocol's own record, and each row
// now carries a one-line farm summary (capital, gas, hold, setup time)
// so a reader can size the whole plan before reading its seven steps.
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
  breadth_per_chain: number;
  breadth_max_extra: number;
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
  breadth_per_chain: 0.02,
  breadth_max_extra: 5,
  comp_min: 0.01,
  comp_max: 5,
  comp_min_live: 3,
};

export const MODEL_VERSION = 'radar-3-comps';

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
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
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
  comp_multiple: number;
  comp_live_count: number;
  comp_used_global: boolean;
  comp_members: CompMember[];
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
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

/**
 * The comps table, read off the snapshot's own live-token protocols:
 * per-category median mcap/TVL, winsorised, with the global median as the
 * fallback for thin categories. Each row also names the five biggest
 * live-token protocols in the category, by market cap, with their own
 * ratios, so the dashboard can show exactly who prices the category —
 * and say when the category was too thin and the global median was used.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; comps: CategoryComp[] } {
  const all: number[] = [];
  const byCategory = new Map<string, { ratios: number[]; members: { name: string; ratio: number; mcap: number }[] }>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = Math.min(model.comp_max, Math.max(model.comp_min, p.mcap_usd / p.tvl_usd));
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

/** The multipliers and the implied value one protocol gets under `model` and the comps table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: { global: number; comps: CategoryComp[] },
  model: ModelConstants = MODEL,
): { implied: number; comp: number; compLive: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const table = new Map(comps.comps.map((c) => [c.category, c]));
  const { multiple: comp, liveCount: compLive } = compFor(protocol.category, table, comps.global);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp * growthMult * maturityMult * breadthMult));
  return { implied, comp, compLive, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n: every rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = categoryComps(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, comps, model) }));
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
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      breadth_multiplier: s.v.breadthMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
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

/** A board row's compact form for data.js, with the comp's provenance and the farm summary. */
export function radarRow(row: BoardRow, watch: Set<string>, comps: { global: number; comps: CategoryComp[] }): RadarRow {
  const table = new Map(comps.comps.map((c) => [c.category, c]));
  const compRow = row.category === null ? undefined : table.get(row.category);
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
    implied_value_usd: row.implied_value_usd,
    comp_multiple: row.model.comp_multiple,
    comp_live_count: compRow?.live_count ?? 0,
    comp_used_global: compRow?.used_global ?? true,
    comp_members: compRow?.members ?? [],
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_summary: farmSummary(
      { slug: row.slug, name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at, gecko_id: row.gecko_id, symbol: row.symbol },
      row.age_days,
    ),
    on_watchlist: watch.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = categoryComps(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
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
    comps: comps.comps,
    rows: board.map((r) => radarRow(r, watch, comps)),
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
