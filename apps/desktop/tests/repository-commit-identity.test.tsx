import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CommandLensContext } from "../src/renderer/src/feature/command-lens/hooks/use-command-lens-context.js";
import {
	hasRepositoryCommitIdentity,
	normalizeRepositoryCommitIdentity,
	readRepositoryCommitIdentity,
} from "../src/renderer/src/feature/workspace/lib/repository-commit-identity.js";
import { RepositoryCommitDock } from "../src/renderer/src/fixture/repository-workspace/components/repository-commit-dock.js";

const commit = async (): Promise<boolean> => true;

const commandLensContext = {
	refreshTarget: (): void => undefined,
	registerTarget: (): (() => void) => () => undefined,
	requestMeasurement: (): void => undefined,
};

const renderCommitDock = (
	commitIdentity: { readonly email: string; readonly name: string } | null,
	isPending = false
): string =>
	renderToStaticMarkup(
		<CommandLensContext value={commandLensContext}>
			<RepositoryCommitDock
				branch="main"
				commitIdentity={commitIdentity}
				isPending={isPending}
				onCommit={commit}
				stagedCount={2}
			/>
		</CommandLensContext>
	);

describe("repository commit identity", () => {
	test("normalizes identity without inventing values", () => {
		expect(
			normalizeRepositoryCommitIdentity("  Ada  ", " ada@example.com ")
		).toEqual({
			email: "ada@example.com",
			name: "Ada",
		});
		expect(hasRepositoryCommitIdentity({ email: "", name: "Ada" })).toBe(false);
	});

	test("reads both effective identity fields concurrently", async () => {
		const requestedKeys: string[] = [];

		const identity = await readRepositoryCommitIdentity((key) => {
			requestedKeys.push(key);

			return Promise.resolve(
				key === "user.name" ? "  Ada  " : " ada@example.com "
			);
		});

		expect(requestedKeys).toEqual(["user.name", "user.email"]);
		expect(identity).toEqual({
			email: "ada@example.com",
			name: "Ada",
		});
	});

	test("keeps the regular commit dock free of identity chrome", () => {
		const markup = renderCommitDock(null);

		expect(markup).toContain("Add a summary");
		expect(markup).not.toContain("repository-commit-author-name");
		expect(markup).not.toContain("Commit identity");
	});

	test("shows a concise repository-local identity fix path", () => {
		const markup = renderCommitDock({
			email: "",
			name: "Ada Lovelace",
		});

		expect(markup).toContain("Set the author saved for this repository.");
		expect(markup).toContain('id="repository-commit-author-name"');
		expect(markup).toContain('id="repository-commit-author-email"');
		expect(markup).toContain("Ada Lovelace");
		expect(markup).toContain("Save identity and commit");
		expect(markup).toContain("disabled");
	});

	test("announces commit progress without clearing the form", () => {
		const markup = renderCommitDock(null, true);

		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain("Committing…");
	});
});
