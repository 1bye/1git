import { describe, expect, test } from "bun:test";
import {
	moveWorkspaceInOrder,
	reconcileWorkspaceOrder,
} from "../src/renderer/src/workspace-order.js";
import type { RepositorySessionRecord } from "../src/shared/repository-session.js";

const session = (id: string): RepositorySessionRecord => ({
	id,
	lastActivatedAt: "2026-07-30T12:00:00.000Z",
	openedAt: "2026-07-30T12:00:00.000Z",
	repository: {
		commonDirectory: `/repos/${id}/.git`,
		gitDirectory: `/repos/${id}/.git`,
		isBare: false,
		isShallow: false,
		root: `/repos/${id}`,
	},
});

describe("workspace order", () => {
	test("preserves visual order when manager sessions are reordered", () => {
		const sessions = [session("second"), session("first")];

		expect(reconcileWorkspaceOrder(["first", "second"], sessions)).toEqual([
			"first",
			"second",
		]);
	});

	test("removes closed sessions and appends newly opened sessions", () => {
		const sessions = [session("fourth"), session("third"), session("second")];

		expect(
			reconcileWorkspaceOrder(["first", "second", "third"], sessions)
		).toEqual(["second", "third", "fourth"]);
	});

	test("moves a workspace to the hovered position", () => {
		expect(
			moveWorkspaceInOrder(["first", "second", "third"], "first", "third")
		).toEqual(["second", "third", "first"]);
		expect(
			moveWorkspaceInOrder(["first", "second", "third"], "third", "first")
		).toEqual(["third", "first", "second"]);
	});
});
