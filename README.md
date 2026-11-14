# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/meongs123/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/meongs123/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by a comps-calibrated implied value — each category priced at its own median mcap/TVL from the live-token protocols in the same snapshot — and gives each one a concrete farm plan with costs and times, in an offline dashboard with board, detail view and filters.

The radar-3 model names its evidence on every row: each category's comp lists the live protocols it was read off, and rows whose category was too thin to price (fewer than 3 live comps) say so and use the global median instead — 84 of the 198 rows fall back, including the Risk Curators at the top. Every detail view shows the full equation, the category justification, and a farm summary (capital, gas, hold, setup time) ahead of the seven steps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vh95w5pk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
