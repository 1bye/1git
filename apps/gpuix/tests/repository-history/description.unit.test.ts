/**
 * Covers: extracting descriptions from Git's full commit messages without repeating the subject.
 * Real: History presentation parser.
 * Doubles: explicit commit metadata; no Git I/O.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { commitInfo } from "../_shared/history-page";

it("omits descriptions for empty and subject-only messages, including multiline subjects", () => {
	for (const body of [
		"",
		"Commit title",
		"Commit title\n",
		"Long title\ncontinued title\n",
		"Commit title\n\n\n",
	]) {
		expect(RepositoryHistory.description({ ...commitInfo(), body })).toBe("");
	}
});

it("separates the subject paragraph and preserves description paragraphs and trailers", () => {
	const description =
		"Explain the change.\nKeep the second line.\n\nFixes #42\nSigned-off-by: Author <author@example.invalid>";

	for (const subject of ["Commit title", "Long title\ncontinued title"]) {
		const body = `${subject}\n\n${description}\n`;

		expect(RepositoryHistory.description({ ...commitInfo(), body })).toBe(
			description
		);
	}
});

it("accepts CRLF and whitespace-only paragraph separators without changing the stored message", () => {
	const commit = {
		...commitInfo(),
		body: "Commit title\r\n \t\r\nDescription\r\n\r\nMore detail\r\n",
	};

	const original = commit.body;

	expect(RepositoryHistory.description(commit)).toBe(
		"Description\n\nMore detail"
	);
	expect(commit.body).toBe(original);
});
