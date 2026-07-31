import { describe, expect, test } from "bun:test";
import type { RepositorySnapshot } from "@1git/git";
import { snapshotForSession } from "../src/renderer/src/feature/workspace/lib/workspace-snapshot.js";

const snapshot = (branch: string): RepositorySnapshot => ({
	files: [],
	head: {
		ahead: 0,
		behind: 0,
		branch,
		detached: false,
		oid: "0123456789abcdef",
		unborn: false,
		upstream: null,
	},
	operationState: "normal",
	repository: {
		commonDirectory: "/repos/example/.git",
		gitDirectory: "/repos/example/.git",
		isBare: false,
		isShallow: false,
		root: "/repos/example",
	},
	stashCount: 0,
});

describe("workspace snapshot ownership", () => {
	test("does not expose a previous workspace snapshot after activation changes", () => {
		const firstWorkspaceSnapshot = snapshot("movement1");
		const state = {
			sessionId: "workspace-1",
			snapshot: firstWorkspaceSnapshot,
		};

		expect(snapshotForSession(state, "workspace-1")).toBe(
			firstWorkspaceSnapshot
		);
		expect(snapshotForSession(state, "workspace-2")).toBeNull();
	});
});
