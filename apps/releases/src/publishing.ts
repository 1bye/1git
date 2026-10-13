import { createHash, randomUUID } from "node:crypto";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CloudflareApiLive, CloudflareEnvironment } from "alchemy/Cloudflare";
import { resolvePolicies } from "alchemy/Cloudflare/ApiToken";
import { layerNonInteractive } from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { State } from "alchemy/State/State";
import { createToken, deleteToken } from "@distilled.cloud/cloudflare/accounts";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

/** The unchanged infrastructure identity used by deployments and release lookups. */
export const RELEASE_STACK_NAME = "1git-releases";
const UPLOAD_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** Non-secret destination resolved from a successfully deployed Alchemy stack. */
export interface ReleaseTarget {
	accountId: string;
	bucket: string;
	jurisdiction: string;
	feedURL: string;
}

/** In-memory, short-lived S3 credentials obtained through the selected Alchemy profile. */
export interface ReleaseUploadCredentials {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/** Reads saved outputs only; never imports, applies, or deploys the stack. */
export class ReleaseStack {
	constructor(private readonly stateDirectory: string) {}

	async load(stage: string): Promise<ReleaseTarget> {
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(stage))
			throw new Error("Invalid release stage.");

		const output = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* yield* State;

				return yield* store.getOutput({ stack: RELEASE_STACK_NAME, stage });
			}).pipe(
				Effect.provide(localState()),
				Effect.provideService(AlchemyContext, {
					dotAlchemy: this.stateDirectory,
					dev: false,
					adopt: false,
				}),
				Effect.provide(BunServices.layer)
			)
		);

		if (
			typeof output !== "object" ||
			output === null ||
			!("accountId" in output) ||
			typeof output.accountId !== "string" ||
			!/^[a-f0-9]{32}$/u.test(output.accountId) ||
			!("bucketName" in output) ||
			typeof output.bucketName !== "string" ||
			!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(output.bucketName) ||
			!("jurisdiction" in output) ||
			typeof output.jurisdiction !== "string" ||
			!["default", "eu", "us", "fedramp", "fedramp-high"].includes(
				output.jurisdiction
			) ||
			!("workerURL" in output) ||
			typeof output.workerURL !== "string"
		)
			throw new Error(
				`Missing or invalid outputs for ${RELEASE_STACK_NAME}/${stage}. Deploy updates explicitly first; release never deploys infrastructure.`
			);

		const url = new URL(output.workerURL);

		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/"
		)
			throw new Error(
				"The saved downloads Worker URL must be an HTTPS origin."
			);

		return {
			accountId: output.accountId,
			bucket: output.bucketName,
			jurisdiction: output.jurisdiction,
			feedURL: new URL("/appcast.xml", url).href,
		};
	}
}

/** Uses Alchemy's profile/OAuth refresh path, without environment-token fallback or deployment. */
export const releaseProfileLayer = (profile: string | undefined) =>
	CloudflareApiLive().pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AuthProviders, {}),
				layerNonInteractive(),
				FetchHttpClient.layer
			)
		),
		Layer.provide(BunServices.layer),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					CI: false,
					...(profile ? { ALCHEMY_PROFILE: profile } : {}),
				})
			)
		)
	);

/** Mints a one-hour, bucket-only token for guarded S3 writes and revokes it after use. */
export const withReleaseUploadCredentials = <A>(
	target: ReleaseTarget,
	publish: (credentials: ReleaseUploadCredentials) => Promise<A>
) =>
	Effect.gen(function* () {
		const environment = yield* yield* CloudflareEnvironment;

		if (environment.accountId !== target.accountId)
			throw new Error(
				"Selected Alchemy profile belongs to a different account than the saved release stack. Nothing uploaded."
			);

		const acquire = createToken({
			accountId: target.accountId,
			name: `1git-release-${randomUUID()}`,
			expiresOn: new Date(Date.now() + UPLOAD_TOKEN_LIFETIME_MS).toISOString(),
			policies: resolvePolicies([
				{
					effect: "allow",
					permissionGroups: [
						"Workers R2 Storage Bucket Item Read",
						"Workers R2 Storage Bucket Item Write",
					],
					resources: {
						[`com.cloudflare.edge.r2.bucket.${target.accountId}_${target.jurisdiction}_${target.bucket}`]:
							"*",
					},
				},
			]),
		}).pipe(
			Effect.timeout("30 seconds"),
			Effect.mapError(
				() =>
					new Error(
						"Could not obtain upload credentials from the Alchemy profile. Account API Tokens Write/provisioning permission is required. Nothing uploaded."
					)
			)
		);

		return yield* Effect.acquireUseRelease(
			acquire,
			(token) =>
				Effect.tryPromise({
					try: async () => {
						if (!token.id || !token.value)
							throw new Error(
								"Cloudflare returned incomplete upload credentials. Nothing uploaded."
							);

						return await publish({
							endpoint:
								target.jurisdiction === "default"
									? `https://${target.accountId}.r2.cloudflarestorage.com`
									: `https://${target.accountId}.${target.jurisdiction}.r2.cloudflarestorage.com`,
							bucket: target.bucket,
							accessKeyId: token.id,
							secretAccessKey: createHash("sha256")
								.update(token.value)
								.digest("hex"),
						});
					},
					catch: (error) =>
						error instanceof Error
							? error
							: new Error("Release publication failed."),
				}),

			(token) =>
				token.id
					? deleteToken({
							accountId: target.accountId,
							tokenId: token.id,
						}).pipe(
							Effect.timeout("30 seconds"),
							Effect.catch(() =>
								Effect.sync(() =>
									process.stderr.write(
										"Warning: could not revoke the release upload token; it expires within one hour. Check Cloudflare tokens before retrying a release.\n"
									)
								)
							),
							Effect.asVoid
						)
					: Effect.void
		);
	});

/** Authenticates only for a real publication; temporary credentials remain in this process. */
export async function publishWithProfile<A>(
	target: ReleaseTarget,
	profile: string | undefined,
	publish: (credentials: ReleaseUploadCredentials) => Promise<A>
): Promise<A> {
	return await Effect.runPromise(
		withReleaseUploadCredentials(target, publish).pipe(
			Effect.provide(releaseProfileLayer(profile)),
			Effect.provide(FetchHttpClient.layer)
		)
	);
}
