/**
 * Covers: conservative conventional-prefix parsing, scopes/breaking markers and safe session preference round-trips.
 * Real: commit subject and workspace session models.
 * Doubles: none.
 * Requires: none; no native rendering, filesystem or Git I/O.
 */
import { expect, it } from "bun:test";
import { CommitSubject } from "../../src/feature/repository-workspace/lib/commit-subject";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("recognizes supported prefixes without changing scope, description or breaking intent", () => {
	for (const type of [
		"feat",
		"fix",
		"refactor",
		"perf",
		"docs",
		"test",
		"build",
		"ci",
		"chore",
		"style",
		"revert",
	] as const) {
		expect(
			CommitSubject.parse(
				`${type}(db)!: Keep Unicode ✓ and feat: inside the title`
			)
		).toEqual({
			type,
			scope: "db",
			breaking: true,
			description: "Keep Unicode ✓ and feat: inside the title",
		});
	}

	expect(CommitSubject.parse("Feat: add a feature")).toEqual({
		type: "feat",
		scope: undefined,
		breaking: false,
		description: "add a feature",
	});
	expect(CommitSubject.parse("fix!: breaking correction")?.breaking).toBe(true);
	expect(
		CommitSubject.parse("docs(api/client): explain the contract")?.scope
	).toBe("api/client");
});

it("recognizes editable prefixes without requiring a complete summary or touching the body", () => {
	for (const type of [
		"feat",
		"fix",
		"refactor",
		"perf",
		"docs",
		"test",
		"build",
		"ci",
		"chore",
		"style",
		"revert",
	] as const) {
		expect(CommitSubject.prefix(`${type}:`)).toEqual({
			type,
			length: type.length,
			scope: undefined,
		});
		expect(CommitSubject.prefix(`${type}(界🙂)!: title\n\nfeat: body`)).toEqual(
			{
				type,
				length: type.length,
				scope: { start: type.length, end: type.length + 5 },
			}
		);
	}

	expect(CommitSubject.prefix("FEAT: add Unicode é🙂")).toEqual({
		type: "feat",
		length: 4,
		scope: undefined,
	});

	for (const message of [
		"feat",
		"feature:",
		"unknown:",
		" feat:",
		"feat():",
		"feat((scope)):",
		"feat(scope\n):",
		"plain\n\nfeat:",
	]) {
		expect(CommitSubject.prefix(message)).toBeNull();
	}
});

it("leaves ordinary, unknown, malformed and multiline messages untouched", () => {
	for (const subject of [
		"Update feature",
		"Merge branch 'main'",
		"custom: keep my prefix",
		"feature: not a standard type",
		" feat: leading space",
		"feat:",
		"feat:   ",
		"feat:no space",
		"feat(): empty scope",
		"feat(db: missing parenthesis",
		"feat((db)): nested scope",
		"feat: title\nbody",
		"feat: title\rbody",
		"feat: title\n",
	]) {
		expect(CommitSubject.parse(subject)).toBeNull();
	}
});

it("locates only the scope delimiters in UTF-16, not parentheses in the summary or body", () => {
	expect(CommitSubject.prefix("feat(界🙂)!: keep (summary)\n\n(body)")).toEqual(
		{
			type: "feat",
			length: 4,
			scope: { start: 4, end: 9 },
		}
	);
	expect(CommitSubject.prefix("fix: keep (summary)")?.scope).toBeUndefined();
	expect(CommitSubject.prefix("feat(unclosed: title")).toBeNull();
});

it("persists either badge choice without losing false or trusting invalid optional values", () => {
	const state = WorkspaceTabsModel.create();

	for (const enabled of [true, false]) {
		const document = WorkspaceSession.capture(
			state,
			undefined,
			"dark",
			enabled
		);

		expect(WorkspaceSession.parse(JSON.stringify(document))).toEqual(document);
		expect(document.commitTypeBadges).toBe(enabled);
	}

	const document = WorkspaceSession.capture(state);

	for (const commitTypeBadges of [undefined, null, "false", 0, {}]) {
		const parsed = WorkspaceSession.parse(
			JSON.stringify({ ...document, commitTypeBadges })
		);

		expect(parsed.commitTypeBadges).toBeUndefined();
		expect(parsed.tabs).toEqual(document.tabs);
	}
});
