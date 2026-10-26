# Anonymous analytics

The website and GPUIX app send explicit events to the same EU PostHog project.
The checked-in token in `src/configuration.ts` is a public ingestion token, not a
personal API key. It grants no access to stored data or account settings.

Analytics is on by default in production. GPUIX exposes **Settings → Privacy →
Share anonymous usage statistics**. The website FAQ has an **Anonymous
analytics** checkbox, reachable through **Questions & answers** in the homepage
footer. Preferences are independent between the app and browser.
Development, GPUIX preview, website previews and automated tests stay offline.

## Collected events

| Source | Events | Allowed metadata |
| --- | --- | --- |
| Desktop | `app_started`, `onboarding_completed` | Release version |
| Website | `$pageview`, `download_clicked` | Fixed canonical URL for home, FAQ or not-found; no actual unknown paths |

Every event carries `source`, a random in-memory UUIDv7, an event timestamp,
`$process_person_profile: false`, `$geoip_disable: true` and a suppressed `$ip`.
The identity rotates after 30 minutes and on opt-out, and is never saved. Page
reloads start another identity; unique visitors and retention are consequently
approximate. There is no website-to-desktop identity linking.

No SDK, cookies, person profiles, autocapture, session recordings, error/log
capture, repository information, account data, referrers, query parameters or
URL fragments are collected. Direct network connections still expose a source
IP to the receiving infrastructure; this is not a guarantee of network anonymity.
Turn off **IP data capture** in the PostHog project's General settings as well.

## Volume and spending

The shared policy permits at most **100 attempted events/day** per installation
or browser origin, resetting at UTC midnight. There is no local monthly cap.
Daily counters persist independently of workspace sessions and survive
opt-out/re-enable. Identical events are
deduplicated within each in-memory session. Requests time out after 2.5 seconds,
do not retry or queue, and consume quota even if delivery fails. Storage failures
disable capture; failed preference saves show an error. Disabling cancels
in-flight requests, but cannot retract events already received.

Existing saved preferences retain consent and daily usage; obsolete monthly
counters are ignored and removed on the next save.

Local limits reduce volume; they cannot enforce an organization-wide allowance.
Multiple browsers, cleared storage, concurrent browser tabs and arbitrary client
counts can exceed a free tier. For a firm $0 ceiling, keep the PostHog organization
on **Free without a payment card**, or set every enabled product's billing limit
to **$0**. Free analytics currently includes 1 million events/month across the
organization, not per source. Excess events are dropped. Do not enable paid
addons or logs retention. Account settings are not changed by this repository.

On 2026-10-25, the EU organization's **Product analytics** billing limit was set
to **$0** and verified in PostHog Billing. This covers both sources' analytics
events. Other products have separate billing limits.

References: [capture contract](https://posthog.com/docs/api/capture),
[privacy controls](https://posthog.com/docs/privacy/data-collection),
[pricing](https://posthog.com/pricing),
[billing limits](https://posthog.com/docs/billing/limits-alerts).

## Verification

`bun run --cwd packages/analytics test` covers privacy, identity rotation,
deduplication, quota persistence/reset, opt-out, blocked storage and cancellation.
The native app and website have their own preference tests. HTTP simulation
instructions and their verification limits are in
`../../postman/simulations/analytics.context.md`.
