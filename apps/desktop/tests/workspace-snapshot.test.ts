import { describe, expect, test } from "bun:test";

import type { RepositorySnapshot } from "@1git/git";

import {
	presentedSession,
	sessionForSnapshot,
	snapshotForSession,
} from "../src/renderer/src/feature/workspace/lib/workspace-snapshot.js";
import type { RepositorySessionRecord } from "../src/shared/repository-session.js";

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

const session = (id: string): RepositorySessionRecord => ({
	id,
	lastActivatedAt: "2026-08-09T10:00:00.000Z",
	openedAt: "2026-08-09T10:00:00.000Z",
	repository: {
		commonDirectory: `/repos/${id}/.git`,
		gitDirectory: `/repos/${id}/.git`,
		isBare: false,
		isShallow: false,
		root: `/repos/${id}`,
	},
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

	test("keeps the presented session aligned with its snapshot during activation", () => {
		const firstSession = session("workspace-1");
		const secondSession = session("workspace-2");
		const firstSnapshot = snapshot("movement1");
		const secondSnapshot = snapshot("movement2");
		const sessions = [firstSession, secondSession];

		const previousState = {
			sessionId: firstSession.id,
			snapshot: firstSnapshot,
		};

		const nextState = {
			sessionId: secondSession.id,
			snapshot: secondSnapshot,
		};

		const previousSnapshotSession = sessionForSnapshot(previousState, sessions);

		expect(previousSnapshotSession).toBe(firstSession);
		expect(previousSnapshotSession?.id).toBe(firstSession.id);

		const nextSnapshotSession = sessionForSnapshot(nextState, sessions);

		expect(nextSnapshotSession).toBe(secondSession);
		expect(nextSnapshotSession?.id).toBe(secondSession.id);
	});

	test("does not preserve a snapshot whose session was closed", () => {
		const state = {
			sessionId: "workspace-1",
			snapshot: snapshot("movement1"),
		};

		expect(sessionForSnapshot(state, [session("workspace-2")])).toBeNull();
	});

	test("presents the snapshot owner only while a workspace transition is pending", () => {
		const firstSession = session("workspace-1");
		const secondSession = session("workspace-2");

		expect(presentedSession(secondSession, firstSession, true)).toBe(
			firstSession
		);
		expect(presentedSession(secondSession, firstSession, false)).toBe(
			secondSession
		);
		expect(presentedSession(secondSession, null, true)).toBe(secondSession);
	});
});
