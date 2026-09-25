import { describe, expect, test } from "bun:test";

import { updateWorkspaceMenuSurfaceSession } from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-menu-presence.js";

describe("workspace menu surface presence", () => {
	test("does not let an old closing workspace clear a newer surface", () => {
		const oldSessionId = "old-session";
		const nextSessionId = "next-session";
		const nextSurface = updateWorkspaceMenuSurfaceSession(
			oldSessionId,
			nextSessionId,
			true
		);

		expect(
			updateWorkspaceMenuSurfaceSession(nextSurface, oldSessionId, false)
		).toBe(nextSessionId);
		expect(
			updateWorkspaceMenuSurfaceSession(nextSurface, nextSessionId, false)
		).toBeNull();
	});
});
