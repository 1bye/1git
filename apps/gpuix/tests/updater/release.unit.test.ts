/**
 * Covers: release arguments, profile/stage selection, numeric ordering and appcast versions.
 * Real: CLI parsing, SAX XML parsing and version validation.
 * Doubles: synthetic feed; no build, keys, or R2 access.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { releaseOptions, ReleaseVersion } from "../../native/release-options";
import { ReleaseFeed } from "../../native/release-publisher";

it("requires an explicit canonical version and supports an offline dry-run/help", () => {
	expect(releaseOptions(["--", "--version", "0.0.2", "--dry-run"])).toEqual({
		help: false,
		version: "0.0.2",
		dryRun: true,
		stage: "prod",
	});
	expect(releaseOptions(["--help"])).toEqual({ help: true });
	expect(() => releaseOptions([])).toThrow("--version");
	expect(() => releaseOptions(["--version", "../bad"])).toThrow("numeric");
	expect(() => ReleaseVersion.parse("01.0.0")).toThrow("numeric");
	expect(() => releaseOptions(["--version", "0.0.2", "--unknown"])).toThrow();
	expect(
		releaseOptions([
			"--version",
			"0.0.2",
			"--stage",
			"beta",
			"--profile",
			"personal",
		])
	).toEqual({
		help: false,
		version: "0.0.2",
		dryRun: false,
		stage: "beta",
		profile: "personal",
	});
	expect(() =>
		releaseOptions(["--version", "0.0.2", "--stage", "../bad"])
	).toThrow("stage");
	expect(() =>
		releaseOptions(["--version", "0.0.2", "--profile", "../bad"])
	).toThrow("profile");
	expect(ReleaseVersion.compare("0.0.10", "0.0.2")).toBe(1);
	expect(ReleaseVersion.compare("1.0.0", "0.999.999")).toBe(1);
	expect(ReleaseVersion.compare("0.0.2", "0.0.2")).toBe(0);
});

it("reads the newest top-level release with namespace aliases and ignores deltas", () => {
	const xml = `<rss xmlns:s="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><s:version>0.0.2</s:version><s:deltas><enclosure s:version="99.0.0"/></s:deltas></item><item><enclosure s:version="0.0.10"/></item></channel></rss>`;

	expect(ReleaseFeed.latest(xml)).toBe("0.0.10");
	expect(() => ReleaseFeed.latest("<rss><channel>")).toThrow();
	expect(() =>
		ReleaseFeed.latest(
			'<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>'
		)
	).toThrow("document types");
	expect(() => ReleaseFeed.latest("<other/>")).toThrow("RSS");
});
