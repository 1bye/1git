import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

/** Static Astro assets and a narrow pass-through to the existing release origin. */
export default Alchemy.Stack(
	"1git-website",
	{ providers: Cloudflare.providers(), state: Cloudflare.state() },
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;

		const website = yield* Cloudflare.Worker("Website", {
			main: "./infra/worker.ts",
			assets: {
				directory: "./dist",
				notFoundHandling: "404-page",
				runWorkerFirst: ["/download", "/appcast.xml", "/1git-*"],
			},
			// A route runs in front of the existing Downloads custom domain.
			// It preserves that domain's ownership and the installed app's feed URLs.
			routes:
				stage === "prod"
					? [{ pattern: "git.1bye.dev/*", zoneName: "1bye.dev" }]
					: [],
		});

		return {
			url: stage === "prod" ? "https://git.1bye.dev" : website.url,
			workerURL: website.url,
		};
	})
);
