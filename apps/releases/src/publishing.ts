import { AlchemyContext } from "alchemy/AlchemyContext";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CloudflareApiLive, CloudflareEnvironment } from "alchemy/Cloudflare";
import { layerNonInteractive } from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { State } from "alchemy/State/State";
import {
	Credentials,
	DEFAULT_API_BASE_URL,
	formatHeaders,
} from "@distilled.cloud/cloudflare/Credentials";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

/** The unchanged infrastructure identity used by deployments and release lookups. */
export const RELEASE_STACK_NAME = "1git-releases";

/** Non-secret destination resolved from a successfully deployed Alchemy stack. */
export interface ReleaseTarget {
	accountId: string;
	bucket: string;
	jurisdiction: string;
	feedURL: string;
}

/** Profile-authenticated object requests restricted to the saved release bucket. */
export type ReleaseObjectRequest = (
	key: string,
	method: "GET" | "PUT" | "DELETE",
	options?: Pick<RequestInit, "body" | "headers">
) => Promise<Response>;

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

/** Reuses profile credentials, including OAuth refresh, without minting upload tokens. */
export const withReleaseProfileRequest = <A>(
	target: ReleaseTarget,
	publish: (request: ReleaseObjectRequest) => Promise<A>
) =>
	Effect.gen(function* () {
		const environment = yield* yield* CloudflareEnvironment;

		if (environment.accountId !== target.accountId)
			throw new Error(
				"Selected Alchemy profile belongs to a different account than the saved release stack. Nothing uploaded."
			);

		const credentials = yield* Credentials;
		const request = yield* FetchHttpClient.Fetch;
		const objectPrefix = `${DEFAULT_API_BASE_URL}/accounts/${target.accountId}/r2/buckets/${encodeURIComponent(target.bucket)}/objects/`;

		const send: ReleaseObjectRequest = async (key, method, options = {}) => {
			if (
				key !== "appcast.xml" &&
				!/^1git-\d+\.\d+\.\d+-macos-arm64\.zip$/u.test(key) &&
				!/^release-checks\/[a-f0-9-]{36}\.txt$/u.test(key)
			)
				throw new Error("Invalid release object key.");

			try {
				const resolved = await Effect.runPromise(credentials);

				if (resolved.apiBaseUrl !== DEFAULT_API_BASE_URL)
					throw new Error("Unexpected Cloudflare API origin.");

				const headers = new Headers(options.headers);

				for (const [name, value] of Object.entries(formatHeaders(resolved)))
					headers.set(name, value);

				headers.set("cf-r2-jurisdiction", target.jurisdiction);

				return await request(objectPrefix + key, {
					...options,
					method,
					headers,
					signal: AbortSignal.timeout(120000),
					redirect: "error",
				});
			} catch {
				throw new Error(
					"R2 request failed; check network access and the selected Alchemy profile."
				);
			}
		};

		return yield* Effect.tryPromise({
			try: () => publish(send),
			catch: (error) =>
				error instanceof Error
					? error
					: new Error("Release publication failed."),
		});
	});

/** Authenticates only for a real publication; profile secrets never reach app builds. */
export async function publishWithProfile<A>(
	target: ReleaseTarget,
	profile: string | undefined,
	publish: (request: ReleaseObjectRequest) => Promise<A>
): Promise<A> {
	return await Effect.runPromise(
		withReleaseProfileRequest(target, publish).pipe(
			Effect.provide(releaseProfileLayer(profile)),
			Effect.provide(FetchHttpClient.layer)
		)
	);
}
