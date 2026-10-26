import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Button } from "@1git/gpuix-ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../../styles/theme";
import type { RepositoryFileLayout } from "../lib/repository-file-tree";
import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";

const emptyFolders: ReadonlySet<string> = new Set();

const FileLayoutContext = createContext<{
	layout: RepositoryFileLayout;
	setLayout?: (layout: RepositoryFileLayout) => void;
}>({ layout: "list" });

const FileViewContext = createContext<{
	folders: ReadonlyMap<string, ReadonlySet<string>>;
	revealed: Map<string, string>;
	setFolders?: (
		scope: string,
		update: (paths: ReadonlySet<string>) => ReadonlySet<string>
	) => void;
}>({ folders: new Map(), revealed: new Map() });

/** Window-owned layout and per-workspace/pane expansion survive file-list remounts. */
export function RepositoryFileViewProvider({
	initialLayout = "list",
	children,
}: {
	initialLayout?: RepositoryFileLayout;
	children: ReactNode;
}) {
	const [layout, setLayout] = useState(initialLayout);
	const revealed = useRef(new Map<string, string>());

	const [folders, setFolders] = useState<
		ReadonlyMap<string, ReadonlySet<string>>
	>(new Map());

	const updateFolders = useCallback(
		(
			scope: string,
			update: (paths: ReadonlySet<string>) => ReadonlySet<string>
		) => {
			setFolders((previous) => {
				const current = previous.get(scope) ?? emptyFolders;
				const next = update(current);

				return current === next ? previous : new Map(previous).set(scope, next);
			});
		},
		[]
	);

	const value = useMemo(
		() => ({
			folders,
			setFolders: updateFolders,
			revealed: revealed.current,
		}),
		[folders, updateFolders]
	);

	const layoutValue = useMemo(() => ({ layout, setLayout }), [layout]);

	return (
		<FileLayoutContext value={layoutValue}>
			<FileViewContext value={value}>{children}</FileViewContext>
		</FileLayoutContext>
	);
}

/** Subscribes to the saved layout without rerendering the app for folder disclosure. */
export function useRepositoryFileLayout() {
	return useContext(FileLayoutContext);
}

/** Shared layout preference and retained folder state for a file-pane owner. */
export function useRepositoryFileView(scope = "") {
	const context = useContext(FileViewContext);
	const layout = useRepositoryFileLayout();
	const setFolders = context.setFolders;

	const toggle = (paths: readonly string[]) =>
		setFolders?.(scope, (current) => {
			const next = new Set(current);
			const expanding = paths.some((path) => current.has(path));

			for (const path of paths) {
				if (expanding) next.delete(path);
			}

			const last = paths.at(-1);

			if (!expanding && last !== undefined) next.add(last);

			return next;
		});

	const reveal = useCallback(
		(path: string, owner: string, force: boolean) => {
			const selection = JSON.stringify([owner, path]);

			if (!force && context.revealed.get(scope) === selection) return;

			context.revealed.set(scope, selection);
			setFolders?.(scope, (current) => {
				const next = new Set(
					[...current].filter((folder) => !path.startsWith(`${folder}/`))
				);

				return next.size === current.size ? current : next;
			});
		},
		[setFolders, scope, context.revealed]
	);

	return {
		...context,
		...layout,
		collapsed: context.folders.get(scope) ?? emptyFolders,
		toggle,
		reveal,
	};
}

/** One icon button toggles the shared file layout without taking extra toolbar space. */
export function RepositoryFileLayoutToggle({
	testId = "file-layout",
}: {
	testId?: string;
}) {
	const { layout, setLayout } = useRepositoryFileLayout();
	const { colors, tokens } = useAppTheme();
	const tree = layout === "tree";
	const action = tree ? "Switch to list view" : "Switch to tree view";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					testId={testId}
					aria-label={action}
					aria-description={`Current layout: ${tree ? "Tree" : "List"} view`}
					tokens={tokens}
					variant="ghost"
					size="sm"
					onPress={() => setLayout?.(tree ? "list" : "tree")}
					style={{
						width: 26,
						height: 26,
						paddingLeft: 0,
						paddingRight: 0,
						backgroundColor: tree ? colors.editorSunken2 : "transparent",
						hover: {
							backgroundColor: tree
								? colors.editorSunken2
								: colors.editorHairline,
						},
					}}
				>
					<WorkspaceTabIcon
						name={layout}
						color={tree ? colors.brand : colors.editorMuted}
					/>
				</Button>
			</TooltipTrigger>
			<TooltipContent tokens={tokens} side="bottom">
				{action}
			</TooltipContent>
		</Tooltip>
	);
}
