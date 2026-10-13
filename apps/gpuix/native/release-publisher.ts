import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { ReleaseVersion } from "./release-options";
import type { PreparedUpdate } from "./prepare-updates";

/** Snapshot used for an atomic conditional replacement of the signed feed. */
export interface PublishedFeed {
	bytes: Uint8Array;
	etag: string;
}

/** Narrow authenticated storage boundary; archives can only be created once. */
export interface ReleaseStorage {
	readFeed(): Promise<PublishedFeed | null>;
	createArchive(key: string, body: Blob): Promise<void>;
	replaceFeed(body: Blob, previousEtag: string | null): Promise<void>;
}

/** Fetch call boundary, excluding Bun's unrelated preconnect helper. */
export type ReleaseFetch = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

const sparkleNamespace = "http://www.andymatuschak.org/xml-namespaces/sparkle";

/** Parses versions only from top-level appcast items, not delta entries. */
export class ReleaseFeed {
	static latest(xml: string): string | undefined {
		if (Buffer.byteLength(xml) > 1024 * 1024)
			throw new Error("Published feed exceeds the 1 MiB limit.");

		const parser = new SaxesParser({ xmlns: true });
		const path: string[] = [];
		let text = "";
		let reading = false;
		let latest: string | undefined;
		let rss = false;

		const add = (value: string): void => {
			const version = ReleaseVersion.parse(value.trim());

			if (!latest || ReleaseVersion.compare(version, latest) > 0)
				latest = version;
		};

		parser.on("doctype", () => {
			throw new Error("Appcast document types are not supported.");
		});
		parser.on("error", (error) => {
			throw error;
		});
		parser.on("opentag", (tag) => {
			path.push(tag.local);

			if (path.length === 1) rss = tag.local === "rss";

			if (
				path.join("/") === "rss/channel/item/version" &&
				tag.uri === sparkleNamespace
			) {
				reading = true;
				text = "";
			}

			if (path.join("/") === "rss/channel/item/enclosure") {
				for (const attribute of Object.values(tag.attributes)) {
					if (
						attribute.uri === sparkleNamespace &&
						attribute.local === "version"
					)
						add(attribute.value);
				}
			}
		});
		parser.on("text", (value) => {
			if (reading) text += value;
		});
		parser.on("cdata", (value) => {
			if (reading) text += value;
		});
		parser.on("closetag", () => {
			if (reading && path.join("/") === "rss/channel/item/version") {
				add(text);
				reading = false;
			}

			path.pop();
		});
		parser.write(xml).close();

		if (!rss) throw new Error("Published feed is not an RSS appcast.");

		return latest;
	}
}

/** Uploads an immutable ZIP, verifies public bytes, then atomically advances the feed. */
export class ReleasePublisher {
	constructor(
		private readonly storage: ReleaseStorage,
		private readonly fetchDownload: ReleaseFetch = fetch
	) {}

	async publish(artifacts: PreparedUpdate): Promise<void> {
		const previous = await this.storage.readFeed();

		const latest = previous
			? ReleaseFeed.latest(new TextDecoder().decode(previous.bytes))
			: undefined;

		if (latest && ReleaseVersion.compare(artifacts.version, latest) <= 0)
			throw new Error(
				`Release ${artifacts.version} must be newer than published ${latest}.`
			);

		const archive = Bun.file(artifacts.archivePath);
		const feedFile = Bun.file(artifacts.feedPath);

		if (feedFile.size > 1024 * 1024)
			throw new Error("Prepared feed exceeds the 1 MiB limit.");

		// Keep the exact signed bytes even if another build replaces a local feed.
		const feed = new Blob([await feedFile.arrayBuffer()], {
			type: "application/xml",
		});

		const archiveName = `1git-${artifacts.version}-macos-arm64.zip`;
		const feedURL = new URL(artifacts.feedURL);

		if (feedURL.pathname !== "/appcast.xml")
			throw new Error(
				"The downloads Worker requires a root /appcast.xml feed URL."
			);

		if (ReleaseFeed.latest(await feed.text()) !== artifacts.version)
			throw new Error("Prepared feed does not match the requested version.");

		await this.storage.createArchive(archiveName, archive);
		await this.verifyDownload(new URL(archiveName, feedURL), archive);
		await this.storage.replaceFeed(feed, previous?.etag ?? null);

		try {
			await this.verifyDownload(feedURL, feed);
		} catch (error) {
			throw new Error(
				"Feed uploaded, but public verification failed. Inspect the endpoint before retrying.",
				{ cause: error }
			);
		}
	}

	private async verifyDownload(url: URL, local: Blob): Promise<void> {
		const response = await this.fetchDownload(url, {
			headers: { "Cache-Control": "no-cache" },
			signal: AbortSignal.timeout(120000),
			redirect: "error",
		});

		if (!response.ok || !response.body)
			throw new Error(
				`Public download verification failed (${response.status}). Feed not advanced.`
			);

		const expected = createHash("sha256");

		for await (const chunk of local.stream()) expected.update(chunk);

		const received = createHash("sha256");
		let size = 0;

		for await (const chunk of response.body) {
			size += chunk.byteLength;

			if (size > local.size)
				throw new Error(
					"Public download exceeds the expected size. Feed not advanced."
				);

			received.update(chunk);
		}

		if (
			size !== local.size ||
			expected.digest("hex") !== received.digest("hex")
		)
			throw new Error("Public download checksum mismatch. Feed not advanced.");
	}
}
