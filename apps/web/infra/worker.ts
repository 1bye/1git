/** Cloudflare supplies the built Astro files through this binding. */
export interface WebsiteEnvironment {
	ASSETS: { fetch(request: Request): Promise<Response> };
}

const releasePath =
	/^\/(?:download|appcast\.xml|1git-(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-macos-arm64\.zip)$/u;

export default {
	async fetch(request: Request, env: WebsiteEnvironment): Promise<Response> {
		const { pathname, search } = new URL(request.url);

		if (!releasePath.test(pathname)) return env.ASSETS.fetch(request);

		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response(null, {
				status: 405,
				headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
			});
		}

		try {
			// Route subrequests reach the Downloads custom-domain origin, bypassing
			// this route. Never forward browser credentials to the release service.
			return await fetch(`https://git.1bye.dev${pathname}${search}`, {
				method: request.method,
				redirect: "manual",
			});
		} catch {
			return new Response("Download temporarily unavailable", {
				status: 503,
				headers: { "Cache-Control": "no-store" },
			});
		}
	},
};
