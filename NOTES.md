# TokenScope Build Notes

Date: 2026-10-23. Author: Aariv Patel. Built overnight for the Nebius x NVIDIA
Global AI Hackathon (deadline Oct 30).

## What Was Built

A static single page app at the repo root: `index.html`, vanilla HTML, CSS and
JavaScript, zero dependencies, zero CDN requests, GitHub Pages deployable as is
(`.nojekyll` included). Four panels plus a guided tour:

1. **Model Planner** (`js/engine/pricing.js`): workload inputs (tokens per
   request, requests per day) feed a comparison of five generic model tiers on
   cost per request, cost per 1K requests, monthly cost, expected latency
   (TTFT plus decode) and throughput. The pricing table is fully editable;
   every cell recomputes all estimates. Cheapest and fastest tiers get badges.
2. **Memory Fit** (`js/engine/memory.js`): KV cache and weight memory from
   parameters, layers, KV heads, head dim, context tokens, weight and KV
   precision (fp16, bf16, int8, int4) and a memory budget. Six arithmetic
   lines are shown step by step, ending in max concurrent full context
   sequences and a Fits, Tight or Over Budget verdict.
3. **Batch Simulator** (`js/engine/queue.js`): a deterministic single server
   batch queue with seeded exponential arrivals. One batch of up to B requests
   completes in one service window. The panel shows p50 and p95 latency,
   utilization and throughput for the chosen settings plus a sweep across
   arrival rates 0.5 to 6 with a hand drawn canvas chart and a full data table.
   Runs are hard capped at 200 requests.
4. **Route Builder** (`js/engine/routing.js`): ordered routing rules (category,
   minimum input tokens, target model, escalation threshold) with a default
   cheap model, replayed against a 60 request synthetic log generated from a
   fixed seed. Each request escalates one tier at a time while a confidence
   proxy sits below the threshold and every attempt is billed. The summary
   reports total cost, the all premium cost of the same log, savings, success
   rate against difficulty labels, escalation rate and attempts per request.
5. **Guided Tour** (`js/app.js`): seven steps with a spotlight highlight on the
   relevant panel element, Next, Back and End buttons, Escape and arrow key
   support, focus restoration on exit, and reduced motion respect.

Supporting modules: `js/engine/random.js` (mulberry32 seeded PRNG and FNV key
hashing), `js/engine/fixtures.js` (model fixtures and the synthetic log
generator). Docs: `README.md` (features, quick start, the Nebius key section),
`LICENSE` (MIT), `package.json` (test script only, no dependencies).

## Test Results From The Real Run

Command: `node --test tests/` on Node v26.8.1 (macOS, arm64).

```
tests 100
suites 0
pass 100
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 50.071084
```

Assertion count: 82 direct `assert.*` call sites plus 25 calls to the `approx`
helper across the five suite files, 107 call sites total; 6 of those are the
helper definitions themselves, so **101 assertions execute**, all passing. The
requirement was at least 40 across pricing math, memory calculations, queueing
simulation and route replay; the actual coverage is 17 pricing, 22 memory, 24
queueing, 26 routing and 11 fixtures assertions, and the whole run finishes in
about 0.05 seconds with no network access.

## Verification Performed

- `node --check` passed on all 12 JavaScript files.
- A scan of every file for em dashes, en dashes and related dash codepoints
  (U+2012 through U+2015, U+2212) came back empty, as did an emoji scan. No
  `text-transform` exists in the stylesheet.
- A cross reference of every element ID requested by `js/app.js` against
  `index.html` found no missing IDs (the only regex hits were canvas color
  literals, not selectors).
- The station honesty harness (`hark_honesty_and_defect_harness.py --audit`)
  audited 15 files and reported 0 violations.

## Bugs Found And Fixed During The Build

- **Queue clock jump:** the simulation originally reset the clock to the next
  arrival time while the server was still busy, so saturated systems showed
  zero waiting. Caught by the saturated p95 test; fixed by never moving the
  clock backwards.
- **UMD require guard:** three engine modules called `require()` before the
  environment check, which would have thrown in the browser. Fixed before any
  page load; the browser path now passes the global namespaces instead.

## Honest Caveats

- **Not visually verified.** The build rules for this session forbade opening a
  browser, so nobody has seen the page render. The markup, styles and wiring
  were written to spec and statically cross checked (IDs, syntax, selectors),
  but layout, contrast and the tour positioning on real screens are unverified.
  Load `index.html` and look at it before submitting.
- **The queueing model is a teaching sketch, not a validated simulator.** It is
  a single server with coordinated batching (one batch of up to B requests per
  service window), seeded exponential arrivals and uniform service time. Real
  continuous batching, preemption and heterogeneous service times are not
  modeled.
- **Confidence is a synthetic proxy.** It is a linear function (0.92 minus 0.15
  per tier short of the labeled difficulty, floored at 0.05), not a measured
  model score. Difficulty labels in the log are invented. The panel says so.
- **Memory math omits runtime overheads.** Activations, fragmentation, CUDA or
  framework reserves and non KV buffers are not modeled; GB means decimal
  gigabytes (1e9 bytes) in this app, stated in the UI. The default shape
  (8B parameters, 32 layers, 8 KV heads, 128 head dim) is a generic teaching
  example, not a description of a specific product.
- **Every price, latency and throughput number is invented.** They are labeled
  fixtures with editable cells and a reset button. The tier names are generic
  on purpose so nothing reads as a vendor quote.
- **No live API.** The Nebius integration is documentation only: a marked
  `INTEGRATION POINT: NEBIUS` comment at `state.models` in `js/app.js` and a
  README section describing the shape, the hydration point and server side key
  handling. The app makes zero network requests.
- **Accessibility is implemented but untested** with an actual screen reader;
  keyboard paths, ARIA roles and labels are in place and statically checked.

## Devpost Description Bullets (Paste Ready)

1. TokenScope is an inference planning studio that runs entirely offline in one
   static page: open `index.html` and every panel works, with zero dependencies
   and zero network calls, deployable to GitHub Pages as is.
2. The Model Planner compares five editable model tier fixtures on cost,
   latency and throughput, recomputing per request, per 1,000 request and
   monthly estimates the moment you change a workload or edit a price cell.
3. Memory Fit shows the full KV cache and weight arithmetic line by line, from
   bytes per token to how many concurrent full context sequences fit in your
   memory budget, with fp16, bf16, int8 and int4 precision options.
4. A deterministic, seeded batch simulator charts p50 and p95 latency across
   arrival rates, and the Route Builder replays cheap first routing with
   confidence based escalation against a labeled synthetic log to put a number
   on the cost versus quality tradeoff.
5. Beginner friendly by design: a guided tour with step highlights and Next
   buttons walks new users through every panel, and 100 passing node:test
   assertions pin the pricing, memory, queueing and routing math.

## Refinement Pass 2026-10-24

A defect and polish sweep over the deployed build. No art direction, feature or dependency
changed. Tests before the pass, 100 passing. Tests after the pass, 100 passing.

Defects found and fixed.

- Missing share metadata. The page had description, theme color and favicon but no Open Graph
  tags. Added og title, og description and og type, all text only, no external images.
- Token level contrast near misses, computed with the WCAG formula from the hex tokens.
  `--faint` on `--panel` measured 4.34 to 1 (hints, the proof index and cost unit labels sit
  on that pair) and 4.31 to 1 on `--panel-2`. Raised `--faint` from `#707c8a` to `#7d8794`,
  which measures 4.75 to 1 or better on every surface in the palette including `--panel-2`.
- The canvas chart palette comment says it mirrors the stylesheet tokens, but it had drifted.
  Chart muted was `#8d99a8` against the token `#9aa4b1`, and chart faint was `#5a6472`,
  measuring 3.24 to 1 for the tick marks it draws. Both now mirror the tokens exactly
  (`#9aa4b1` and `#7d8794`), which lifts the axis label text to 7.7 to 1 and the tick marks to
  5.3 to 1 on the chart well.
- The route chain arrows in the replay table were plain text to screen readers. The arrow
  spans are now aria hidden, so a row reads as model names with the arrow left out.

Checked and found already sound. All 40 id references in app.js resolve against the HTML or
the dynamically created tour and rule row markup, no duplicate ids, no dead listeners, no
console paths on load. Tabs implement the full ARIA pattern with roving tabindex and arrow,
Home and End keys. The chart is focusable with the same keyboard model and mirrors every
crosshair readout into a polite live region. Skip link, focus visible rings and label
associations all check out, and the fields hidden on small screens are display none rather
than focus traps. Reduced motion kills the LED pulse, panel transition, tab indicator and
smooth scrolling; the two JS animations run on requestAnimationFrame or user gesture, both of
which pause in hidden tabs. Copy has no em or en dashes, no emoji, no all caps kickers. No
layout overflows at 320 px, tables scroll inside their own containers and the rule rows
collapse by 640 px.

Noted, not forced. The guided tour is a modeless spotlight by design, the overlay passes
pointer events through and there is no focus trap, which matches the non blocking tour
concept, so I left it as built rather than converting it into a blocking modal dialog.
