/**
 * Covers: bounded, safe transfer progress across split stderr chunks and carriage returns.
 * Real: Git progress parser.
 * Doubles: progress consumer; no child process or network.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import type { GitTransferProgress } from "../../src/contracts.js";
import { GitProgress } from "../../src/process/git-progress.js";

it("streams recognized percentages once without forwarding arbitrary output", () => {
	const events: GitTransferProgress[] = [];
	const parser = new GitProgress((event) => events.push(event));

	parser.write(Buffer.from("secret credential\nWriting obj"));
	parser.write(Buffer.from("ects:  25% (1/4)\rWriting objects: 25% (1/4)\r"));
	parser.write(
		Buffer.from(
			"Writing objects: 100% (4/4), done.\nremote: Resolving deltas: 50% (1/2)\r"
		)
	);
	parser.write(Buffer.from("remote: Resolving deltas: 100% (2/2), done."));
	parser.finish();

	expect(events).toEqual([
		{ phase: "sending", percent: 25 },
		{ phase: "sending", percent: 100 },
		{ phase: "resolving", percent: 50 },
		{ phase: "resolving", percent: 100 },
	]);
	expect(JSON.stringify(events)).not.toContain("credential");
});

it("bounds incomplete output, rejects invalid percentages and tolerates a failed observer", () => {
	const events: GitTransferProgress[] = [];

	const parser = new GitProgress((event) => {
		events.push(event);

		throw new Error("The UI observer went away");
	});

	parser.write(Buffer.from("x".repeat(100_000)));
	parser.write(
		Buffer.from(
			"\nReceiving objects: 101% (1/1)\rReceiving objects: 42% (42/100)\r"
		)
	);
	parser.finish();

	expect(events).toEqual([{ phase: "receiving", percent: 42 }]);
});
