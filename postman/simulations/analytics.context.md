# Analytics simulation

Created 2026-10-25 from the official [PostHog capture contract](https://posthog.com/docs/api/capture).
The owner-mock search was skipped because the Postman CLI is signed out.

## Purpose

One PostHog ingestion stand-in exercises the real shared client over HTTP without
writing production analytics. The handler validates the anonymous capture envelope
and answers 501 for routes outside the modeled contract.

## Execution

Run `postman simulation run postman/simulations/analytics.sim.yaml --port auto --no-history --output ndjson --verbose`.
Take the bound port from its `listening` event. In another terminal run
`POSTHOG_SIMULATION_URL=http://127.0.0.1:PORT/posthog bun run --cwd packages/analytics test:integration`.
Check that the simulation logs both desktop and website POSTs, then stop it with Ctrl+C.
Keep request logs out of Git.

## Assumptions

- The model checks the documented capture envelope, not PostHog ingestion,
  dashboards, account privacy or billing settings. No live project was queried.
- The integration runner only accepts a loopback simulation URL. The production
  transport is replaced only to route the same serialized request through real fetch.

## Observations

<!-- begin:observations -->
2026-10-25: CLI 1.75.0 served exactly two capture requests (desktop and website),
both HTTP 200. The real-fetch integration passed; opt-out generated no further
requests. All members served. No production events were sent.
<!-- end:observations -->

## What didn't work

- 2026-10-25: CLI 1.75.0 required the member path to name `config.yaml`, rather
  than its directory. The manifest now names the file explicitly.
- 2026-10-25: the simulation strips trailing slashes before dispatch; the handler
  accepts both capture path forms. Binding and connecting to loopback required
  leaving the command sandbox on this machine.
