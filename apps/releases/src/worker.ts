/** Only the read operations used by the public downloads handler are exposed. */
export interface ReleaseBucket {
	head(key: string): Promise<ReleaseObject | null>;
	get(key: string): Promise<ReleaseObject | null>;
}

/** Metadata is present on HEAD and GET; only GET includes the streaming body. */
export interface ReleaseObject {
	size: number;
	httpEtag: string;
	body?: ReadableStream<Uint8Array>;
}

/** A private R2 binding; no publisher credentials or write endpoints. */
export interface DownloadEnvironment {
	UPDATES: ReleaseBucket;
}

const archiveName =
	/^1git-(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-macos-arm64\.zip$/u;

const releaseVersionTag = /<sparkle:version>([^<]+)<\/sparkle:version>/u;

export default {
	async fetch(request: Request, env: DownloadEnvironment): Promise<Response> {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response(null, {
				status: 405,
				headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
			});
		}

		const key = new URL(request.url).pathname.slice(1);
		const feed = key === "appcast.xml";
		const download = key === "download";

		if (!feed && !download && !archiveName.test(key))
			return new Response(null, {
				status: 404,
				headers: { "Cache-Control": "no-store" },
			});

		try {
			if (download) {
				const appcast = await env.UPDATES.get("appcast.xml");

				if (!appcast?.body)
					return new Response(null, {
						status: 404,
						headers: { "Cache-Control": "no-store" },
					});

				if (appcast.size > 1024 * 1024)
					throw new Error("Published feed exceeds the 1 MiB limit.");

				// Release preparation publishes one item with this Sparkle version tag.
				const xml = await new Response(appcast.body).text();
				const version = releaseVersionTag.exec(xml)?.[1];
				const archive = `1git-${version}-macos-arm64.zip`;

				if (!version || !archiveName.test(archive))
					throw new Error("Published feed has no valid release version.");

				return new Response(null, {
					status: 302,
					headers: {
						Location: new URL(`/${archive}`, request.url).href,
						"Cache-Control": "no-store",
					},
				});
			}

			const object =
				request.method === "HEAD"
					? await env.UPDATES.head(key)
					: await env.UPDATES.get(key);

			if (!object)
				return new Response(null, {
					status: 404,
					headers: { "Cache-Control": "no-store" },
				});

			const headers = new Headers({
				"Content-Type": feed
					? "application/xml; charset=utf-8"
					: "application/zip",
				"Cache-Control": feed
					? "no-store"
					: "public, max-age=31536000, immutable",
				"Content-Length": String(object.size),
				"X-Content-Type-Options": "nosniff",
				ETag: object.httpEtag,
			});

			if (!feed)
				headers.set("Content-Disposition", `attachment; filename="${key}"`);

			return new Response(
				request.method === "HEAD" ? null : (object.body ?? null),
				{ headers }
			);
		} catch {
			return new Response("Download temporarily unavailable", {
				status: 503,
				headers: { "Cache-Control": "no-store" },
			});
		}
	},
};
