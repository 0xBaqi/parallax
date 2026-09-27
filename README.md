# Parallax

**the future changes how the past looks**

[Open Parallax](https://insightful-imagination-production.up.railway.app/#home)

Parallax is a hindsight-bias exercise for onchain evidence. Choose a historical cutoff **T**, examine the evidence available within that boundary, lock your judgment, then reveal what happened afterward.

Once we know the outcome, earlier signals can look much clearer than they really were. Parallax separates **KNOWABLE THEN** from **OBVIOUS AFTER** so you can inspect that change in perspective. What supported your judgment? What contradicted it? What was missing?

**TRUST / PASS records a hindsight exercise, not a trading signal.** Later price performance does not prove predictive ability.

## The experience

**Time Machine** opens a curated historical case with an offline, zero-credit workflow. **Investigate** accepts a token, Ethereum or Solana, a cutoff and a lookback window. The public demo allows anonymous investigations with explicit approval of any quoted credit cost. Arbitrary inputs do not guarantee historical coverage.

```text
STATE → PATH → CONFLICT | TEMPORAL FIREWALL | OUTCOME
           KNOWABLE THEN                    AFTER
                    lock TRUST / PASS → reveal
```

| Stage | What you inspect |
| --- | --- |
| STATE | Available historical cohort evidence and its directional character. |
| PATH | How observed activity developed across the window, including persistence, reversals and breadth where supported. |
| CONFLICT | Agreement or disagreement among usable evidence, with missing coverage kept explicit. |
| TEMPORAL FIREWALL | The boundary separating evidence at T from subsequent outcomes; your decision locks before reveal. |
| OUTCOME | Available later performance at defined horizons, shown only after the reveal gate. |

## Evidence, not a generated story

The core is a **deterministic evidence engine with no LLM**. Normalization, temporal filtering, classification and outcome calculations are explicit code. Missing or invalid values do not become invented observations or zeros.

Evidence receipts explain source, historical cutoff, requested and observed windows, coverage and deterministic methodology. PIT, HISTORICAL, DERIVED and OUTCOME labels distinguish the role of evidence. Public receipts use readable source labels and omit raw provider field lists and endpoint paths.

The temporal firewall excludes future and incomplete observations from THEN. Tests mutate later evidence and verify that sealed pre-reveal results remain unchanged. Historical reconstruction remains limited by provider coverage and the point-in-time fidelity of the available labels; it is not proof that every observation could actually have been retrieved on the original date.

## Powered by Nansen

Parallax integrates [Nansen](https://nansen.ai/) historical flow summaries, historical Smart Money movement and historical OHLCV on the server. These support complementary views of cohort state, the path of activity, and historical price context or later outcomes. Ethereum and Solana inputs pass through the same evidence pipeline, subject to source availability.

Public application outputs are derived classifications, coverage information, receipts and relative outcome measures. They do not provide a raw Nansen data download or a general-purpose provider proxy. Attribution remains visible in the application.

Both the Nansen key and admin token stay server-side. Set `PARALLAX_PUBLIC_DEMO=true` to permit anonymous access only to the bounded quote/start/decision/break workflow. It defaults to disabled; legacy routes remain blocked when the session workflow is installed. No browser token is needed or supplied. Session and quote identifiers are unguessable capabilities; keep them private.

## Controls and unavailable data

- Fixture mode is the default; live mode requires explicit configuration.
- An uncached reconstruction and an uncached outcome reveal have separate credit approval steps. Current code estimates 11 credits for reconstruction and 5 for reveal; these are application assumptions, not a promise of future provider pricing.
- A durable global ledger reserves credits before requests. Failed or uncertain calls are not automatically refunded locally.
- A total credit budget, per-request cap and durable global limit of 3 uncached investigations per 10 minutes bound usage. Public-demo session requests also share a durable 120-request/minute limit, independent of forwarded IP headers. Expired free quotes cannot silently turn into paid execution.
- Reconstruction caching includes the query and source namespace; reveal results persist. Concurrent matching work is deduplicated in-process.
- Unavailable, partial and unsupported evidence stays explicit. Missing cutoff prices prevent fabricated returns. Transient outcome-source failures leave AFTER sealed and surface an error for deliberate retry.

## Architecture

The application uses Node.js 24+, native modules and a plain HTML/CSS/JavaScript interface, with no runtime package dependencies.

| Location | Responsibility |
| --- | --- |
| `public/` | Frozen interface and session workflow. |
| `server/http.mjs`, `server/main.mjs` | HTTP boundary, origin checks, security headers and startup configuration. |
| `server/experience.mjs` | Time Machine / Investigate, quotes, locked decisions and reveal gate. |
| `server/adapter.mjs` | Separate fixture and server-side Nansen adapters. |
| `server/normalize.mjs`, `server/engine.mjs`, `server/reveal.mjs` | Temporal normalization, deterministic evidence and outcome calculations. |
| `server/public-output.mjs` | Allowlisted, derived-only public serialization. |
| `server/store.mjs`, `server/costs.mjs`, `server/service.mjs` | Persistent storage, credit reservations, caching and rate controls. |
| `tests/`, `scripts/` | Existing regression suite, production packaging and smoke checks. |

## Local setup

**This source release deliberately excludes the private research data bundle.** The frozen server, full suite, build and smoke workflow require the existing `fixtures/` and `curated/` directories. A public clone alone cannot start the complete app. Live mode also initializes Time Machine, so a live key does not remove this prerequisite. The deployed demo remains the immediately usable experience.

An authorized maintainer must restore their existing private bundle locally, including `curated/m5-test-expectations.json`. Do not upload that bundle to GitHub. M5 moved research-valued test constants into that ignored file without changing their values or assertions. No replacement observations are fabricated or silently downloaded.

With Node.js 24+ and the private bundle in place, run from the repository root:

```sh
npm test
npm run build
npm run smoke
npm run dev
```

Open `http://127.0.0.1:3000`. No dependency installation or Nansen key is needed for fixture mode. Keep live credentials unset during offline verification.

`.env.example` contains configuration names and placeholders only. The app reads process environment variables; it does **not** load `.env` automatically. Set variables through your shell or deployment platform.

| Variable | Purpose |
| --- | --- |
| `PARALLAX_MODE` | `fixture` by default; explicitly set `live` only for authorized live operation. |
| `PARALLAX_DATA_DIR` | Private writable state directory; defaults to `.data`. |
| `PORT` | Local HTTP port, default 3000. |
| `NANSEN_API_KEY` | Server-side credential for live data only. |
| `PARALLAX_LIVE_APPROVED` | Must be `true` to enable the live adapter. |
| `PARALLAX_ADMIN_TOKEN` | Private operator token of at least 24 characters for live Investigate. |
| `PARALLAX_CREDIT_BUDGET` | Total local reservation limit, default 0. |
| `PARALLAX_MAX_REQUEST_CREDITS` | Per-request reservation cap, default 11. |
| `PARALLAX_PUBLIC_ORIGIN` | Exact HTTPS origin for hosted operation, with no trailing slash. |

## Verification

The M5 maintainer validation runs the full existing suite, production build and eight packaged smoke checks with the private bundle. Tests cover temporal isolation, locked decisions, credit approval, mocked live transport, unavailable outcomes, serialization, caching and startup locking. Smoke runs in fixture mode in a disposable local state directory. None of these checks needs a paid Nansen request.

The public source contains test logic, while research inputs and raw-valued expected constants remain private. Therefore maintainer validation is not a claim that a bare public clone passes the full suite without those prerequisites.

## Deployment

M5.1 adds opt-in public judge access to the existing Railway service. Keep the global budget at 30 and the per-request cap at 11 during rollout; preserve existing persistent state.

An authorized deployment needs the private bundle, the configured secrets and a persistent `PARALLAX_DATA_DIR`. Use one active writer for that directory. Preserve its cache, sessions, reveal records, rate records and credit ledger across deployments; do not replace it with a test directory or reset it to replenish the budget.

The existing Dockerfile builds the package but retains a sleeping default command used by the deployment setup. A host must explicitly override its start command with `node dist/server/main.mjs` (or `npm start`). It is not a self-starting public-clone image, and its private data contents must not be published as a public container image.

## Limitations and release scope

- Historical coverage and label history vary. Unknown tokens, sparse observations and partial windows can produce unavailable evidence or outcomes.
- The curated catalog is narrow; chain input support is not universal historical coverage.
- Daily observations do not describe intraday price paths. Outcome horizons are constrained by validated cutoff and subsequent observations.
- The application is a single-writer, filesystem-backed buildathon release, not a multi-tenant or horizontally scaled service.
- Private research inputs are withheld from GitHub. Independent reproduction of the full curated experience requires authorized access to those inputs.
- A repository audit and passing tests are not a formal external security certification.

Built for the **Nansen Meridian Buildathon**. **Powered by Nansen.** The M5 scope is code freeze, repository hygiene, documentation and offline verification. Demo recording, social publication and competition submission are separate steps.
