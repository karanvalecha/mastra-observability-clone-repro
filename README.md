# Mastra observability metadata clone reproduction

A standalone mock-model reproduction of redundant `structuredClone` calls when Mastra creates logger and metrics contexts. No database, API key, network model calls, or exporter service is required.

## Run

Use Node.js 22.22.0 or newer (verified with 22.22.3). Dependencies are pinned and the lockfile is included.

```bash
npm ci
npm run repro
```

Or run each mode separately:

```bash
node clones-min.mjs off
node clones-min.mjs never
node clones-min.mjs always
```

Each process warms up once, then measures ten sequential agent turns. Each turn calls one mock tool and returns a streamed answer, with approximately 4 KB of tracing metadata.

## Observed results

Recorded with Node.js 22.22.3, `@mastra/core` 1.83.0 and `@mastra/observability` 1.24.0:

| Observability | Sampling | Clone calls per turn |
| --- | --- | ---: |
| Disabled | — | 0 |
| Enabled | `never` | 286 |
| Enabled | `always` | 324 |

The script counts **all** `structuredClone` calls during the measured turns. Counts describe this fixture; they are not universal per-turn costs. It also prints time spent inside the clone calls, which varies with the machine. That timing does not include allocation-related garbage collection outside those calls.

To inspect call sites:

```bash
npm run callers
```

This optional preload captures stacks, adding measurement overhead. Its tally includes the warm-up turn; use the ordinary reproduction for timing comparisons.

## Suspected redundant work

In `observability/mastra/src/instances/base.ts`, `getLoggerContext` and `getMetricsContext` clone span metadata before passing it to constructors that clone it again.

The proposed change is to pass `span.metadata` directly from the factory methods and keep the constructor copies. Those copies should preserve the metadata snapshot for each context.

Earlier local measurements with those two factory copies removed yielded 143 calls per turn with sampling `never` and 164 with sampling `always`. This repository contains the unmodified packages so maintainers can reproduce the baseline. Those patched results do not establish mutation isolation; that should be covered by an upstream regression test.

## Files

- `clones-min.mjs`: standalone reproduction and clone counter.
- `clone-callers.mjs`: optional stack-based caller tally.
- `package.json` and `package-lock.json`: exact direct dependencies and resolved dependency tree.

The two scripts can also be pasted directly into a GitHub issue. This reproduction is limited to metadata copying; it makes no claim about durable lease failures.
