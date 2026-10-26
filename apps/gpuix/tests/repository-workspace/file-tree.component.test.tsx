/**
 * Covers: native folder disclosure, keyboard navigation, inclusion, filters, scope retention and virtualization.
 * Real: workspace/tree models, file rows, native GPUIX layout, focus and accessibility props.
 * Doubles: Git records; no filesystem mutations.
 * Requires: patched GPUIX native renderer and macOS graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { useReducer } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { RepositoryList } from "../../src/feature/repository-workspace/components/repository-list";
import {
	RepositoryFileLayoutToggle,
	RepositoryFileViewProvider,
} from "../../src/feature/repository-workspace/components/repository-file-view";
import {
	RepositoryWorkspaceModel as Model,
	type RepositoryWorkspaceState,
} from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";

const files: readonly WorkspaceEntry[] = [
	"src/a.ts",
	"src/ui/b.ts",
	"src/ui/c.ts",
	"test/a.ts",
	"README.md",
].map((path) => ({ id: path, title: path, status: "M" }));

function Pane({
	scope = "first",
	query = "",
	entries = files,
	disabled = false,
	initialSelectedId,
}: {
	scope?: string;
	query?: string;
	entries?: readonly WorkspaceEntry[];
	disabled?: boolean;
	initialSelectedId?: string;
}) {
	const [state, dispatch] = useReducer(
		(
			state: RepositoryWorkspaceState,
			action: Parameters<typeof Model.reduce>[1]
		) => Model.reduce(state, action),
		undefined,
		(): RepositoryWorkspaceState => ({
			...Model.create(),
			entries: { changes: entries, history: [], stashes: [] },
			includedFileIds: entries.map((entry) => entry.id),
			partialFiles: {
				"src/ui/c.ts": { expectedPatch: "patch", includedLines: ["line"] },
			},
			views: {
				...Model.create().views,
				changes: {
					selectedId: initialSelectedId ?? entries[0]?.id ?? null,
					scrollY: 0,
				},
			},
		})
	);

	const visible = query
		? entries.filter((entry) => entry.title.includes(query))
		: entries;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
			}}
		>
			<RepositoryFileLayoutToggle />
			<RepositoryList
				entries={visible}
				label="Changed files"
				emptyMessage="No files"
				state={state.views.changes}
				fileTree={{
					scope,
					allEntries: entries,
					filtering: !!query,
					onInclude: (ids, included) =>
						dispatch({ type: "include-files", ids, included }),
				}}
				inclusion={{
					ids: state.includedFileIds,
					partialIds: Object.keys(state.partialFiles ?? {}),
					disabled,
					onChange: (id, included) =>
						dispatch({ type: "include-file", id, included }),
				}}
				onSelect={(id, mode, visibleIds) =>
					dispatch({ type: "select", view: "changes", id, mode, visibleIds })
				}
				onScroll={() => {}}
			/>
			<text
				testId="selected"
				aria-label={state.views.changes.selectedId ?? "none"}
			>
				{state.views.changes.selectedId}
			</text>
		</div>
	);
}

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 1100, height: 700 });
});
afterEach(() => root.unmount());

const element = (testId: string) => {
	const node = root.renderer.findByTestId(testId);

	if (!node) throw new Error(`Missing ${testId}`);

	return node;
};

function click(testId: string): void {
	const bounds = root.renderer.getElementBounds(element(testId).id);

	if (!bounds) throw new Error(`Missing bounds for ${testId}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
}

function key(testId: string, value: string): void {
	root.renderer.nativeSimulateKeyDown(element(testId).id, value);
	root.renderer.flush();
}

const checked = (id: string) => element(id).customProps?.["aria-checked"];
const selected = () => element("selected").customProps?.["aria-label"];

it("keeps viewed files independent of disclosure and includes collapsed descendants in one folder action", () => {
	root.render(
		<RepositoryFileViewProvider initialLayout="tree">
			<Pane />
		</RepositoryFileViewProvider>
	);

	expect(element("repository-list-viewport").customProps?.role).toBe(
		"treegrid"
	);
	const accessibility = Object.values(root.renderer.getA11yTree().nodes ?? {});

	expect(
		accessibility.some(
			(node) =>
				node.aria?.role === "TreeGrid" && node.aria.label === "Changed files"
		)
	).toBe(true);
	expect(
		accessibility.some(
			(node) =>
				node.aria?.role === "Row" &&
				node.aria.level === 1 &&
				node.aria.expanded === true
		)
	).toBe(true);
	expect(checked("include-folder:src/")).toBe("mixed");
	expect(root.renderer.findByTestId("directory-src/a.ts")).toBeUndefined();
	const checkbox = root.renderer.getElementBounds(
		element("include-src/a.ts").id
	);

	const folderCheckbox = root.renderer.getElementBounds(
		element("include-folder:src/").id
	);

	const viewport = root.renderer.getElementBounds(
		element("repository-list-viewport").id
	);

	expect(checkbox?.x).toBe(folderCheckbox?.x);
	expect((checkbox?.x ?? 0) + (checkbox?.width ?? 0)).toBeGreaterThan(
		(viewport?.width ?? 0) - 20
	);
	click("entry-folder:src/");
	expect(root.renderer.findByTestId("entry-src/a.ts")).toBeUndefined();
	expect(selected()).toBe("src/a.ts");
	click("include-folder:src/");
	expect(checked("include-folder:src/")).toBe(true);
	click("include-folder:src/");
	expect(checked("include-folder:src/")).toBe(false);
	expect(checked("include-README.md")).toBe(true);
	key("entry-folder:src/", "right");
	expect(checked("include-src/a.ts")).toBe(false);
	expect(selected()).toBe("src/a.ts");
	key("file-layout", "enter");
	expect(element("repository-list-viewport").customProps?.role).toBe("grid");
	expect(element("directory-src/a.ts")).toBeDefined();
	expect(checked("include-src/ui/c.ts")).toBe(false);
	click("file-layout");
	expect(checked("include-folder:src/ui/")).toBe(false);
});

it("navigates visible folders with arrows, toggles inclusion with Space and preserves the file preview", () => {
	root.render(
		<RepositoryFileViewProvider initialLayout="tree">
			<Pane />
		</RepositoryFileViewProvider>
	);

	key("entry-folder:src/", "right");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-folder:src/ui/").id
	);
	expect(selected()).toBe("src/a.ts");
	key("entry-folder:src/ui/", "right");
	expect(selected()).toBe("src/ui/b.ts");
	key("entry-src/ui/b.ts", "left");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-folder:src/ui/").id
	);
	key("entry-folder:src/ui/", "left");
	expect(root.renderer.findByTestId("entry-src/ui/b.ts")).toBeUndefined();
	expect(selected()).toBe("src/ui/b.ts");
	key("entry-folder:src/ui/", "space");
	expect(checked("include-folder:src/ui/")).toBe(true);
	key("entry-folder:src/ui/", "down");
	expect(selected()).toBe("src/a.ts");
	key("entry-src/a.ts", "end");
	expect(selected()).toBe("README.md");
});

it("temporarily reveals matches, retains hidden descendant inclusion and restores independent pane expansion", () => {
	const render = (scope: string, query = "") =>
		root.render(
			<RepositoryFileViewProvider initialLayout="tree">
				<Pane scope={scope} query={query} />
			</RepositoryFileViewProvider>
		);

	render("first");
	click("entry-folder:src/ui/");
	expect(root.renderer.findByTestId("entry-src/ui/b.ts")).toBeUndefined();
	render("first", "b.ts");
	expect(element("entry-src/ui/b.ts")).toBeDefined();
	expect(root.renderer.findByTestId("entry-src/ui/c.ts")).toBeUndefined();
	click("include-folder:src/ui/");
	expect(checked("include-folder:src/ui/")).toBe(true);
	click("include-folder:src/ui/");
	expect(checked("include-folder:src/ui/")).toBe(false);
	render("first");
	expect(root.renderer.findByTestId("entry-src/ui/b.ts")).toBeUndefined();
	render("second");
	expect(element("entry-src/ui/c.ts")).toBeDefined();
	expect(checked("include-src/ui/c.ts")).toBe(false);
	render("first");
	expect(root.renderer.findByTestId("entry-src/ui/c.ts")).toBeUndefined();
	click("entry-folder:src/");
	render("second");
	expect(element("entry-src/a.ts")).toBeDefined();
	render("first");
	expect(root.renderer.findByTestId("entry-src/a.ts")).toBeUndefined();
	expect(selected()).toBe("src/a.ts");
});

it("windows large trees and reveals the last file with End", () => {
	const entries: WorkspaceEntry[] = Array.from(
		{ length: 3000 },
		(_, index) => ({
			id: `src/file-${index}.ts`,
			title: `src/file-${index}.ts`,
			status: "M",
		})
	);

	root.render(
		<RepositoryFileViewProvider initialLayout="tree">
			<Pane entries={entries} />
		</RepositoryFileViewProvider>
	);

	expect(root.renderer.findByTestId("entry-src/file-2999.ts")).toBeUndefined();
	key("entry-src/file-0.ts", "end");
	expect(element("entry-src/file-2999.ts")).toBeDefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-src/file-2999.ts").id
	);
	expect(selected()).toBe("src/file-2999.ts");
});

it("leaves inclusion unchanged while Git writes disable the checkboxes", () => {
	root.render(
		<RepositoryFileViewProvider initialLayout="tree">
			<Pane disabled />
		</RepositoryFileViewProvider>
	);
	click("include-folder:src/");
	expect(checked("include-folder:src/")).toBe("mixed");
});

it("reveals a restored file beyond the initial virtual window", () => {
	const entries: WorkspaceEntry[] = Array.from(
		{ length: 3000 },
		(_, index) => ({
			id: `src/file-${index}.ts`,
			title: `src/file-${index}.ts`,
			status: "M",
		})
	);

	root.render(
		<RepositoryFileViewProvider initialLayout="tree">
			<Pane entries={entries} initialSelectedId="src/file-2999.ts" />
		</RepositoryFileViewProvider>
	);
	const row = root.renderer.getElementBounds(
		element("entry-src/file-2999.ts").id
	);

	const viewport = root.renderer.getElementBounds(
		element("repository-list-viewport").id
	);

	expect(row).not.toBeNull();
	expect(row?.y).toBeGreaterThanOrEqual(viewport?.y ?? 0);
	expect((row?.y ?? 0) + (row?.height ?? 0)).toBeLessThanOrEqual(
		(viewport?.y ?? 0) + (viewport?.height ?? 0) + 1
	);
});

it("shares layout across Changes, History and Stashes while keeping revision lists flat and expansion scoped", () => {
	root.render(<App preview initialTabCount={2} />);
	click("changes-file-layout");
	expect(element("repository-list-viewport").customProps?.role).toBe(
		"treegrid"
	);
	click("view-history");
	click("entry-commit-1");
	expect(element("repository-list-viewport").customProps?.role).toBe("listbox");
	expect(element("revision-files-viewport").customProps?.role).toBe("tree");
	expect(element("revision-file-layout").customProps?.["aria-label"]).toBe(
		"Switch to list view"
	);
	key("entry-src/app.tsx", "end");
	click("entry-folder:src/styles/");
	expect(
		root.renderer.findByTestId("entry-src/styles/tokens.ts")
	).toBeUndefined();
	click("entry-commit-2");
	click("entry-commit-1");
	expect(
		root.renderer.findByTestId("entry-src/styles/tokens.ts")
	).toBeUndefined();
	click("view-stashes");
	click("entry-stash-1");
	expect(element("revision-files-viewport").customProps?.role).toBe("tree");
	expect(element("entry-src/styles/tokens.ts")).toBeDefined();
	click("revision-file-layout");
	click("view-changes");
	expect(element("repository-list-viewport").customProps?.role).toBe("grid");
	expect(element("changes-file-layout").customProps?.["aria-label"]).toBe(
		"Switch to tree view"
	);
});
