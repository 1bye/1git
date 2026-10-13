import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import { RELEASE_STACK_NAME } from "./src/publishing";

/** Release archives survive removal of this stack or a future website deployment. */
export const UpdatesBucket = Cloudflare.R2.Bucket("Updates", {
	publicAccess: false,
	forceDestroy: false,
}).pipe(RemovalPolicy.retain());

/** Public downloads only; publishing credentials never enter this Worker. */
export const UpdatesWorker = Cloudflare.Worker("Downloads", {
	main: "./src/worker.ts",
	env: { UPDATES: UpdatesBucket },
});

export default Alchemy.Stack(
	RELEASE_STACK_NAME,
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const bucket = yield* UpdatesBucket;
		const worker = yield* UpdatesWorker;

		return {
			accountId: bucket.accountId,
			bucketName: bucket.bucketName,
			jurisdiction: bucket.jurisdiction,
			workerURL: worker.url,
		};
	})
);
