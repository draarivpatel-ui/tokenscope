# TokenScope

An offline inference planning studio for people shipping LLM features. One static
page, zero dependencies, four panels of planning math you can audit line by line,
a guided tour for first time visitors, and a node:test suite for the math.

Entry for the Nebius x NVIDIA Global AI Hackathon. Built by Aariv Patel.

## What It Does

1. **Model Planner.** Compare cost, latency and throughput across five generic
   model tiers for a workload you describe (tokens per request, requests per day).
   The pricing table is a fixture: every cell is editable and every estimate
   recomputes instantly. Cheapest and fastest tiers are flagged.
2. **Memory Fit.** Compute KV cache and weight memory for a model shape, context
   length and precision level. The arithmetic is shown step by step: bytes per
   token, bytes per sequence, weight bytes, leftover budget and the number of
   concurrent full context sequences a memory budget supports.
3. **Batch Simulator.** A deterministic, seeded queueing simulation shows p50 and
   p95 latency as arrival rate and batch size change, with a canvas sweep chart,
   a full sweep table and a per run detail card. Runs are capped at 200 requests
   so everything stays instant.
4. **Route Builder.** Compose routing rules (cheap model first, escalate when a
   confidence proxy drops below a threshold) and replay them against a labeled
   synthetic request log of 60 requests. The summary reports total cost, what the
   same log would cost all premium, savings, success rate against difficulty
   labels and escalation rate.

A guided tour walks new users through all four panels with step highlights and
Next and Back buttons.

## Quick Start

No build step and no dependencies.

- Open `index.html` in any modern browser, or serve the folder with any static
  file server.
- GitHub Pages: push these files to a repository root and enable Pages. The site
  deploys as is (a `.nojekyll` file is included).
- Tests: run `npm test` or `node --test tests/` with Node 18 or newer. The suite
  covers pricing math, memory calculations, the queueing simulation and route
  replay, runs in well under a second and makes no network requests.

## Honesty Notes

- Every model price, latency and throughput number in the app is a fixture value
  that you can edit in the UI. Nothing quotes a real vendor; the tier names
  (Nano through Ultra) are generic.
- The request log in the Route Builder is synthetic, generated locally from a
  fixed seed. Difficulty labels and confidence values are synthetic proxies, not
  measured scores.
- This build makes zero network requests. No analytics, no fonts, no scripts
  from anywhere else.

## Where a Nebius Inference API Key Would Plug In

This page is fully static, so a key never appears here and never should. A
future live build would wire the Nebius inference API in at exactly two places:

1. **Data shape.** All panels consume model records of the shape
   `{ id, name, tier, inputPerMillion, outputPerMillion, ttftMs, tokensPerSecond }`
   (plus the KV shape fields for Memory Fit). A live client, say
   `js/engine/nebius-client.js`, would fetch model metadata and measured latency
   from the Nebius inference API and map it into that same shape.
2. **Hydration point.** `js/app.js` marks `state.models` with an
   `INTEGRATION POINT: NEBIUS` comment. A live build would hydrate that array
   with the mapped records instead of the fixture defaults; every panel and the
   replay would pick the new numbers up unchanged.
3. **Key handling.** A static page cannot hold a secret. The key
   (`NEBIUS_API_KEY`) would live in a tiny server side proxy that the page
   calls; the proxy talks to Nebius and returns mapped, key free data.

None of this exists in the current build. The claim in the footer is literal:
no live inference provider is contacted.

## Project Layout

```
index.html              the whole app, one page
styles.css              one cohesive dark theme, system fonts only
js/app.js               UI wiring, chart, guided tour
js/engine/random.js     seeded PRNG (mulberry32)
js/engine/fixtures.js   editable model fixtures and the synthetic log generator
js/engine/pricing.js    cost and latency math
js/engine/memory.js     KV cache and weight memory math
js/engine/queue.js      deterministic batch queueing simulation
js/engine/routing.js    route policy replay
tests/                  node:test suites, one per engine module plus fixtures
```

## Accessibility

Semantic tabs with keyboard arrow navigation, labeled form controls, captions on
every data table, a skip link, visible focus rings, an `aria-live` results
region per panel, and a tour that supports Escape and arrow keys and restores
focus when it ends. The sweep chart carries an `aria-label` and its numbers are
fully repeated in the sweep table next to it.

## License

MIT. See `LICENSE`.
