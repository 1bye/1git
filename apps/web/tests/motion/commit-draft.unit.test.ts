/**
 * Covers: edited commits, amend/undo restoration, and cancellation without losing a draft.
 * Real: the in-memory composer state used by the HTML demo.
 * Doubles: none.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import {
	CommitDraft,
	GENERATED_DRAFT,
	splitCommitType,
} from "../../src/scripts/commit-draft";

test("commits the edited message and Undo restores the previous commit and draft", () => {
	const draft = new CommitDraft();
	const previous = draft.lastCommit;

	draft.message = "  fix: keep the editor focused\n\nPreserve the selection.  ";

	expect(draft.commit()).toBe(true);
	expect(draft.lastCommit?.message).toBe(
		"fix: keep the editor focused\n\nPreserve the selection."
	);
	expect(draft.message).toBe("");
	expect(draft.undo()).toBe(true);
	expect(draft.lastCommit).toEqual(previous);
	expect(draft.message).toBe(
		"fix: keep the editor focused\n\nPreserve the selection."
	);
});

test("blank or generating drafts cannot create a commit", () => {
	const draft = new CommitDraft();
	const previous = draft.lastCommit;

	draft.message = " \n ";
	expect(draft.commit()).toBe(false);
	draft.message = "feat: my draft";
	draft.startDraft();
	expect(draft.commit()).toBe(false);
	expect(draft.lastCommit).toEqual(previous);
});

test("stopping generation keeps edits even if a late completion arrives", () => {
	const draft = new CommitDraft();

	draft.message = "feat: my carefully refined draft";
	draft.startDraft();
	draft.setPhase("Reviewing…");
	draft.cancelDraft();
	draft.setPhase("Writing message…");
	draft.finishDraft();

	expect(draft.phase).toBeNull();
	expect(draft.message).toBe("feat: my carefully refined draft");
	draft.startDraft();
	draft.finishDraft();
	expect(draft.message).toBe(GENERATED_DRAFT);
});

test("toggling Amend restores the uncommitted draft", () => {
	const draft = new CommitDraft();

	draft.message = "chore: unfinished work";
	draft.toggleAmend();
	expect(draft.amending).toBe(true);
	expect(draft.message).toBe(draft.lastCommit?.message ?? "");
	draft.message = "feat: edited previous commit";
	draft.toggleAmend();
	expect(draft.amending).toBe(false);
	expect(draft.message).toBe("chore: unfinished work");
});

test("Undo reverses an amend and restores the message for editing", () => {
	const draft = new CommitDraft();
	const previous = draft.lastCommit;

	draft.toggleAmend();
	draft.message = "feat: amended workspace";
	draft.commit();
	expect(draft.amending).toBe(false);
	draft.undo();
	expect(draft.lastCommit).toEqual(previous);
	expect(draft.message).toBe("feat: amended workspace");
});

test("Undo returns the initial commit to the editor without inventing older history", () => {
	const draft = new CommitDraft();
	const previous = draft.lastCommit?.message;

	expect(draft.undo()).toBe(true);
	expect(draft.lastCommit).toBeNull();
	expect(draft.message).toBe(previous ?? "");
	expect(draft.canUndo).toBe(false);
	expect(draft.undo()).toBe(false);
});

test("type highlighting preserves arbitrary message text", () => {
	expect(splitCommitType("feat: <script>literal text</script>")).toEqual({
		type: "feat",
		rest: ": <script>literal text</script>",
	});
	expect(splitCommitType("feature work")).toEqual({
		type: "",
		rest: "feature work",
	});
	expect(
		splitCommitType("feat(session) preserve compatible saved intent").type
	).toBe("feat");
});
