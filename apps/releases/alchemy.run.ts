import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import { Stage } from "alchemy/Stage";
import { resolve } from "node:path";
import { RELEASE_STACK_NAME, ReleaseStack } from "./src/publishing";

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
		const stage = yield* Stage;

		const savedKey = yield* Effect.tryPromise(() =>
			new ReleaseStack(resolve(import.meta.dir, ".alchemy")).savedPublicKey(
				stage
			)
		).pipe(Effect.orDie);

		const publicKey = process.env.ONEGIT_UPDATE_PUBLIC_KEY ?? savedKey;

		if (
			typeof publicKey !== "string" ||
			!/^[A-Za-z0-9+/]{43}=$/u.test(publicKey)
		)
			throw new Error(
				"Initial publisher deployment requires the existing Sparkle public key in ONEGIT_UPDATE_PUBLIC_KEY."
			);

		if (savedKey && savedKey !== publicKey)
			throw new Error(
				"Refusing to replace the deployed signing key without an explicit key migration."
			);

		const bucket = yield* UpdatesBucket;
		const worker = yield* UpdatesWorker;

		const publisher = yield* Cloudflare.Worker("Publisher", {
			main: "./src/publisher-worker.ts",
			env: { UPDATES: UpdatesBucket, PUBLIC_KEY: publicKey },
		});

		return {
			accountId: bucket.accountId,
			bucketName: bucket.bucketName,
			jurisdiction: bucket.jurisdiction,
			workerURL: worker.url,
			publisherURL: publisher.url,
			publicKey,
		};
	})
);
