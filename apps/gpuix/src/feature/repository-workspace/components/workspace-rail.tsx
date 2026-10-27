import { workspaceRailIcons } from "./workspace-rail-icons";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import {
	useRef,
	useState,
	useEffect,
	useLayoutEffect,
	type Ref,
	type RefObject,
	type ReactNode,
} from "react";
import {
	useGpuixRequired,
	type Props,
	type StyleDesc,
	type PublicInstance,
} from "@gpuix/react";
import { setRefs } from "@gpuix/react/floating";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { controlSize, radius, iconSize, spacing } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	AccountStore,
	type SavedAccount,
} from "../../accounts/lib/account-store";
import type { Accounts } from "../../accounts/lib/accounts";
import { accountProviderIcons } from "../../accounts/account-provider-icons";
import { NativeFileMenu } from "../lib/native-file-menu";
import {
	WorkspaceSettingsMenu,
	type WorkspaceSettingsChoice,
} from "../lib/workspace-settings-menu";
import type { SettingsSection } from "../../accounts/accounts-settings";
import type {
	RepositoryAppearanceOptions,
	RepositoryAppearanceSection,
} from "../../repository-appearance/repository-patterns";
import { repositoryViews, type RepositoryView } from "../types";
import { RailSpaceSwipe } from "../../spaces/rail-space-swipe";
import type { SpaceDirection } from "../../spaces/workspace-spaces";

export const workspaceRailWidth = 48;

// Native SVG masks, using the same light line weight as the app's controls.
const svg = (paths: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const actionStyle: StyleDesc = {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: controlSize.rail,
		height: controlSize.rail,
		flexShrink: 0,
		borderRadius: radius.lg,
		backgroundColor: "transparent",
		cursor: "pointer",
		hover: { backgroundColor: appColors.editorHairline },
	};

	return { actionStyle };
});

/** A native host trigger preserves tooltip focus/hover events and tab semantics. */
function RailAction({
	label,
	icon,
	selected = false,
	disabled = false,
	children: _children,
	style: _style,
	...props
}: Props & {
	label: string;
	icon: string;
	selected?: boolean;
	disabled?: boolean;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const { actionStyle } = themedStyles.get(theme);

	const [focused, setFocused] = useState(false);
	const [pointerFocus, setPointerFocus] = useState(false);
	const highlighted = selected || props["aria-expanded"] === true;

	return (
		<Tooltip open={props["aria-expanded"] === true ? false : undefined}>
			<TooltipTrigger asChild>
				<div
					{...props}
					aria-label={label}
					aria-disabled={disabled || undefined}
					tabIndex={disabled ? undefined : (props.tabIndex ?? 0)}
					onMouseDown={() => {
						setPointerFocus(true);
					}}
					onFocus={() => setFocused(true)}
					onBlur={() => {
						setFocused(false);
						setPointerFocus(false);
					}}
					onClick={(event) => {
						if (!disabled) props.onClick?.(event);
					}}
					onKeyDown={(event) => {
						setPointerFocus(false);
						setFocused(true);

						if (!disabled) props.onKeyDown?.(event);
					}}
					style={StyleSheet.compose(
						actionStyle,
						highlighted && {
							backgroundColor: theme.repositoryColor
								? appTokens.colors.accent
								: appColors.editorHairline,
						},
						disabled && { opacity: 0.45, cursor: "not-allowed" }
					)}
				>
					<svg
						testId={props.testId ? `${props.testId}-icon` : undefined}
						source={icon}
						style={{
							width: iconSize.lg,
							height: iconSize.lg,
							pointerEvents: "none",
							color:
								focused && !pointerFocus
									? appColors.brand
									: highlighted
										? theme.repositoryColor
											? appColors.brand
											: appColors.editorInk
										: appColors.editorMuted,
						}}
					/>
				</div>
			</TooltipTrigger>
			<TooltipContent
				tokens={appTokens}
				testId={props.testId ? `${props.testId}-tooltip` : undefined}
				side="right"
				align="center"
			>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

function readCatalog(accounts: Accounts): {
	saved: SavedAccount[];
	error?: string;
} {
	try {
		return { saved: accounts.load(), error: undefined };
	} catch {
		return { saved: [], error: "Could not load accounts. Open Settings." };
	}
}

/** Window chrome navigation. Account selection changes only the default for new Clone views. */
export function WorkspaceRail({
	view,
	onView,
	accounts,
	preferredAccountKey,
	onAccount,
	onSettings,
	onAppearance,
	onAddAccount,
	settingsActive = false,
	disabled = false,
	settingsButtonRef,
	accountButtonRef,
	viewButtonRefs,
	savedAccounts,
	repositoryAppearance,
	ignoredHistory,
	spaceSwitcher,
	tourAnchorRef,
	onMenuOpenChange,
	onSpaceSwipe,
	children,
}: {
	ignoredHistory?: { readonly active: boolean; readonly onOpen: () => void };
	view?: RepositoryView;
	onView?: (view: RepositoryView) => void;
	accounts: Accounts;
	preferredAccountKey?: string;
	onAccount?: (key: string) => void;
	onSettings: (section?: SettingsSection) => void;
	onAppearance?: (section: RepositoryAppearanceSection) => void;
	onAddAccount: () => void;
	settingsActive?: boolean;
	disabled?: boolean;
	settingsButtonRef?: Ref<PublicInstance>;
	accountButtonRef?: RefObject<PublicInstance | null>;
	viewButtonRefs?: RefObject<Map<RepositoryView, PublicInstance>>;
	/** Settings owns a live list; use it immediately after connecting/removing an account. */
	savedAccounts?: readonly SavedAccount[];
	/** Omitted on Home/Settings; those gears retain direct Settings access. */
	repositoryAppearance?: Pick<
		RepositoryAppearanceOptions,
		"onChange" | "onPatternChange"
	>;
	/** Repository-wide actions sit above the navigation group. */
	spaceSwitcher?: (disabled: boolean) => ReactNode;
	onSpaceSwipe?: (direction: SpaceDirection) => void;
	tourAnchorRef?: Ref<PublicInstance>;
	onMenuOpenChange?: (open: boolean) => void;
	children?: ReactNode;
}) {
	const theme = useAppTheme();
	const { colors: appColors } = theme;

	const renderer = useGpuixRequired();
	const localButtons = useRef(new Map<RepositoryView, PublicInstance>());
	const buttons = viewButtonRefs ?? localButtons;
	const accountButton = useRef<PublicInstance>(null);
	const settingsButton = useRef<PublicInstance>(null);
	const settingsTracking = useRef(false);
	const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
	const [catalog, setCatalog] = useState(() => readCatalog(accounts));
	const spaceSwipe = useRef(new RailSpaceSwipe());
	const swipeEnabled = !disabled && !settingsMenuOpen && !!onSpaceSwipe;

	useEffect(() => {
		if (!swipeEnabled) spaceSwipe.current.cancel();
	}, [swipeEnabled]);

	useLayoutEffect(() => {
		onMenuOpenChange?.(settingsMenuOpen);
	}, [settingsMenuOpen, onMenuOpenChange]);

	useLayoutEffect(() => () => onMenuOpenChange?.(false), [onMenuOpenChange]);

	const saved = savedAccounts ?? catalog.saved;

	const account =
		saved.find((item) => AccountStore.key(item) === preferredAccountKey) ??
		saved[0];

	const activate = (next: RepositoryView) => {
		onView?.(next);
		const button = buttons.current.get(next);

		if (button) renderer.focusElement?.(button.id);

		setTimeout(() => {
			const current = buttons.current.get(next);

			if (current) renderer.focusElement?.(current.id);
		}, 0);
	};

	const chooseAccount = () => {
		const current = readCatalog(accounts);

		setCatalog(current);
		const selected =
			current.saved.find(
				(item) => AccountStore.key(item) === preferredAccountKey
			) ?? current.saved[0];

		const labels = current.saved.map(
			(item) =>
				`${item === selected ? "✓ " : ""}${item.username} · ${item.provider === "github" ? "GitHub" : "GitLab"} (${new URL(item.webUrl).host})`
		);

		const empty = labels.length === 0;

		if (empty) labels.push(current.error ?? "No accounts connected");

		const addIndex = labels.length;

		labels.push("Add account…", "Manage accounts…");
		const bounds = accountButton.current
			? renderer.getElementBounds?.(accountButton.current.id)
			: undefined;

		if (!bounds) return;

		try {
			const index = NativeFileMenu.show(
				renderer,
				labels,
				labels.map((_, index) => !empty || index !== 0),
				bounds.x + bounds.width,
				bounds.y
			);

			if (index === addIndex) onAddAccount();
			else if (index === addIndex + 1) onSettings();
			else if (!empty && index >= 0 && current.saved[index])
				onAccount?.(AccountStore.key(current.saved[index]));
		} catch {
			setCatalog({
				...current,
				error: "Account menu unavailable. Open Settings with Command comma.",
			});
		}
	};

	const chooseSettings = async (): Promise<void> => {
		if (disabled || settingsTracking.current) return;

		if (!repositoryAppearance || settingsActive) {
			onSettings();

			return;
		}

		const button = settingsButton.current;
		const bounds = button && renderer.getElementBounds?.(button.id);

		if (!bounds) return;

		settingsTracking.current = true;
		setSettingsMenuOpen(true);

		try {
			// Paint the active gear before AppKit enters its synchronous menu tracking loop.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			const choice = NativeFileMenu.showItems<WorkspaceSettingsChoice>(
				renderer,
				WorkspaceSettingsMenu.items(),
				bounds.x + bounds.width,
				bounds.y
			);

			renderer.focusElement?.(button.id);

			if (choice?.kind === "appearance") {
				if (onAppearance) onAppearance(choice.section);
				else onSettings("repository-appearance");
			} else if (choice?.kind === "settings") onSettings(choice.section);
		} catch {
			// Settings stays reachable if this native build cannot show grouped menus.
			onSettings();
		} finally {
			settingsTracking.current = false;
			setSettingsMenuOpen(false);
		}
	};

	const actionKey =
		(press: () => void): Props["onKeyDown"] =>
		(event) => {
			if (
				!event.isHeld &&
				!event.modifiers?.cmd &&
				!event.modifiers?.ctrl &&
				!event.modifiers?.alt &&
				!event.modifiers?.shift &&
				(event.key === "enter" || event.key === "space")
			)
				press();
		};

	return (
		<TooltipProvider delayDuration={350}>
			<div
				ref={tourAnchorRef}
				testId="workspace-rail"
				role="navigation"
				aria-label="Workspace tools"
				onMouseLeave={
					onSpaceSwipe ? () => spaceSwipe.current.cancel() : undefined
				}
				aria-description={
					onSpaceSwipe
						? "Swipe left or right with two fingers to switch spaces."
						: undefined
				}
				onScroll={
					onSpaceSwipe
						? (event) => {
								if (!swipeEnabled) {
									spaceSwipe.current.cancel();

									return;
								}

								const direction = spaceSwipe.current.update(event);

								if (direction) onSpaceSwipe(direction);
							}
						: undefined
				}
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					width: workspaceRailWidth,
					flexShrink: 0,
					paddingTop: spacing[1.5],
					paddingBottom: spacing[3],
					gap: spacing[1],
				}}
			>
				{children ? (
					<>
						{children}
						<div
							testId="rail-sync-separator"
							style={{
								width: 20,
								height: 1,
								flexShrink: 0,
								backgroundColor: appColors.editorHairlineStrong,
							}}
						/>
					</>
				) : null}
				{view && onView ? (
					<div
						role="tablist"
						aria-label="Repository views"
						aria-orientation="vertical"
						style={{
							display: "flex",
							flexDirection: "column",
							gap: spacing[1],
						}}
					>
						{repositoryViews.map((item, index) => (
							<RailAction
								key={item.value}
								testId={`view-${item.value}`}
								role="tab"
								aria-selected={!ignoredHistory?.active && view === item.value}
								tabIndex={view === item.value ? 0 : -1}
								selected={!ignoredHistory?.active && view === item.value}
								disabled={disabled}
								label={item.label}
								icon={workspaceRailIcons[item.value]}
								ref={(node) => {
									if (node) buttons.current.set(item.value, node);
									else buttons.current.delete(item.value);
								}}
								onClick={() => activate(item.value)}
								onKeyDown={(event) => {
									if (
										event.modifiers?.cmd ||
										event.modifiers?.ctrl ||
										event.modifiers?.alt ||
										event.modifiers?.shift
									)
										return;

									if (event.key === "enter" || event.key === "space") {
										if (!event.isHeld) activate(item.value);

										return;
									}

									let nextIndex = index;

									if (event.key === "up" || event.key === "left")
										nextIndex =
											(index + repositoryViews.length - 1) %
											repositoryViews.length;
									else if (event.key === "down" || event.key === "right")
										nextIndex = (index + 1) % repositoryViews.length;
									else if (event.key === "home") nextIndex = 0;
									else if (event.key === "end")
										nextIndex = repositoryViews.length - 1;
									else return;

									const next = repositoryViews[nextIndex];

									if (next) activate(next.value);
								}}
							/>
						))}
					</div>
				) : null}
				{ignoredHistory ? (
					<RailAction
						testId="view-ignored"
						role="button"
						label="Ignored changes"
						aria-pressed={ignoredHistory.active}
						selected={ignoredHistory.active}
						disabled={disabled}
						icon={svg(
							'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h3m3 3 2 2 4-4"/>'
						)}
						onClick={ignoredHistory.onOpen}
						onKeyDown={actionKey(ignoredHistory.onOpen)}
					/>
				) : null}
				<div
					testId="rail-window-drag-region"
					windowDrag
					style={{ flexGrow: 1, width: "100%" }}
				/>
				{spaceSwitcher?.(disabled)}
				<RailAction
					ref={(node) => setRefs(node, settingsButton, settingsButtonRef)}
					testId="rail-settings"
					role="button"
					aria-haspopup={
						repositoryAppearance && !settingsActive ? "menu" : undefined
					}
					aria-expanded={
						repositoryAppearance && !settingsActive
							? settingsMenuOpen
							: undefined
					}
					label={
						repositoryAppearance && !settingsActive
							? "Workspace settings (Command comma opens Settings)"
							: "Settings (Command comma)"
					}
					icon={workspaceRailIcons.settings}
					selected={settingsActive}
					disabled={disabled}
					onClick={() => {
						void chooseSettings();
					}}
					onKeyDown={actionKey(() => {
						void chooseSettings();
					})}
				/>
				<RailAction
					ref={(node) => {
						accountButton.current = node;

						if (accountButtonRef) accountButtonRef.current = node;
					}}
					testId="rail-account"
					role="button"
					aria-haspopup="menu"
					label={
						catalog.error ??
						(account
							? `${account.username} · ${new URL(account.webUrl).host} — default for new clones`
							: "Accounts")
					}
					icon={
						account
							? accountProviderIcons[account.provider]
							: workspaceRailIcons.account
					}
					disabled={disabled}
					onClick={chooseAccount}
					onKeyDown={actionKey(chooseAccount)}
				/>
			</div>
		</TooltipProvider>
	);
}
