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
	publisherURL?: string;
	publicKey?: string;
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
		const output = await this.readOutput(stage);

		return this.validateOutput(output, stage);
	}

	/** Keeps later infrastructure deployments pinned without repeated environment exports. */
	async savedPublicKey(stage: string): Promise<string | undefined> {
		const output = await this.readOutput(stage);

		if (
			typeof output !== "object" ||
			output === null ||
			!("publicKey" in output)
		)
			return undefined;

		if (
			typeof output.publicKey !== "string" ||
			!/^[A-Za-z0-9+/]{43}=$/u.test(output.publicKey)
		)
			throw new Error("Saved publisher public key is invalid.");

		return output.publicKey;
	}

	private async readOutput(stage: string): Promise<unknown> {
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(stage))
			throw new Error("Invalid release stage.");

		return await Effect.runPromise(
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
	}

	private validateOutput(output: unknown, stage: string): ReleaseTarget {
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

		let publisherURL: string | undefined;
		let publicKey: string | undefined;

		if ("publisherURL" in output || "publicKey" in output) {
			if (
				!("publisherURL" in output) ||
				typeof output.publisherURL !== "string" ||
				!("publicKey" in output) ||
				typeof output.publicKey !== "string" ||
				!/^[A-Za-z0-9+/]{43}=$/u.test(output.publicKey)
			)
				throw new Error(
					"Invalid publisher outputs; deploy the release stack first."
				);

			const publisher = new URL(output.publisherURL);

			if (
				publisher.protocol !== "https:" ||
				publisher.username ||
				publisher.password ||
				publisher.pathname !== "/" ||
				publisher.search ||
				publisher.hash
			)
				throw new Error("The publisher URL must be an HTTPS origin.");

			publisherURL = publisher.origin;
			publicKey = output.publicKey;
		}

		return {
			accountId: output.accountId,
			bucket: output.bucketName,
			jurisdiction: output.jurisdiction,
			feedURL: new URL("/appcast.xml", url).href,
			...(publisherURL ? { publisherURL, publicKey } : {}),
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
	publish: (request: ReleaseObjectRequest) => Promise<A>,
	write?: ReleaseObjectRequest
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

			if (method !== "GET") {
				if (!write)
					throw new Error(
						"A signed conditional publisher is required for writes."
					);

				return await write(key, method, options);
			}

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
	publish: (request: ReleaseObjectRequest) => Promise<A>,
	write?: ReleaseObjectRequest
): Promise<A> {
	return await Effect.runPromise(
		withReleaseProfileRequest(target, publish, write).pipe(
			Effect.provide(releaseProfileLayer(profile)),
			Effect.provide(FetchHttpClient.layer)
		)
	);
}
