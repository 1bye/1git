import { describe, expect, it } from "bun:test";
import { getRepositoryDiffScrollEndPath } from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";

const paths = ["first.ts", "middle.ts", "last.ts"] as const;

describe("repository diff scroll synchronization", () => {
	it("selects the last file at the bottom of an overflowing diff", () => {
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 1600,
					scrollTop: 1000,
				},
				paths
			)
		).toBe("last.ts");
	});

	it("tolerates fractional scroll positions at the bottom", () => {
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 1600,
					scrollTop: 999.4,
				},
				paths
			)
		).toBe("last.ts");
	});

	it("leaves normal and non-scrollable positions to intersection sync", () => {
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 1600,
					scrollTop: 800,
				},
				paths
			)
		).toBeNull();
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 600,
					scrollTop: 0,
				},
				paths
			)
		).toBeNull();
	});
});
