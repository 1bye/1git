import { useRef, useState, type Ref, type RefObject } from "react";
import {
	useGpuixRequired,
	type Props,
	type StyleDesc,
	type PublicInstance,
} from "@gpuix/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	AccountStore,
	type SavedAccount,
} from "../../accounts/lib/account-store";
import type { Accounts } from "../../accounts/lib/accounts";
import { accountProviderIcons } from "../../accounts/account-provider-icons";
import { NativeFileMenu } from "../lib/native-file-menu";
import { repositoryViews, type RepositoryView } from "../types";
import { appTokens } from "../../../styles/tokens";

export const workspaceRailWidth = 48;

// Native SVG masks, using the same light line weight as the app's controls.
const svg = (paths: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const icons = {
	changes: svg(
		'<path d="M5 3v12m14-6v12M5 9h9l-3-3m3 3-3 3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="6" r="3"/>'
	),
	history: svg('<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l4 2"/>'),
	stashes: svg(
		'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M9 12h6"/>'
	),
	settings: svg(
		'<path d="m9 3-.7 2.4-2 .9L4 5.6l-2 3.5 1.8 1.7v2.4L2 14.9l2 3.5 2.3-.7 2 .9L9 21h6l.7-2.4 2-.9 2.3.7 2-3.5-1.8-1.7v-2.4L22 9.1l-2-3.5-2.3.7-2-.9L15 3Z"/><circle cx="12" cy="12" r="3"/>'
	),
	account: svg(
		'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5.5 18a6.5 6.5 0 0 1 13 0"/>'
	),
};

const actionStyle: StyleDesc = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	width: 32,
	height: 32,
	flexShrink: 0,
	borderRadius: 8,
	backgroundColor: "transparent",
	cursor: "pointer",
	hover: { backgroundColor: lightColors.editorHairline },
};

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
	const [focused, setFocused] = useState(false);
	const [pointerFocus, setPointerFocus] = useState(false);

	return (
		<Tooltip>
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
						selected && { backgroundColor: lightColors.editorHairline },
						disabled && { opacity: 0.45, cursor: "not-allowed" }
					)}
				>
					<svg
						testId={props.testId ? `${props.testId}-icon` : undefined}
						source={icon}
						style={{
							width: 18,
							height: 18,
							pointerEvents: "none",
							color:
								focused && !pointerFocus
									? lightColors.brand
									: selected
										? lightColors.editorInk
										: lightColors.editorMuted,
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
	onAddAccount,
	settingsActive = false,
	disabled = false,
	settingsButtonRef,
	accountButtonRef,
	viewButtonRefs,
	savedAccounts,
}: {
	view?: RepositoryView;
	onView?: (view: RepositoryView) => void;
	accounts: Accounts;
	preferredAccountKey?: string;
	onAccount?: (key: string) => void;
	onSettings: () => void;
	onAddAccount: () => void;
	settingsActive?: boolean;
	disabled?: boolean;
	settingsButtonRef?: Ref<PublicInstance>;
	accountButtonRef?: RefObject<PublicInstance | null>;
	viewButtonRefs?: RefObject<Map<RepositoryView, PublicInstance>>;
	/** Settings owns a live list; use it immediately after connecting/removing an account. */
	savedAccounts?: readonly SavedAccount[];
}) {
	const renderer = useGpuixRequired();
	const localButtons = useRef(new Map<RepositoryView, PublicInstance>());
	const buttons = viewButtonRefs ?? localButtons;
	const accountButton = useRef<PublicInstance>(null);
	const [catalog, setCatalog] = useState(() => readCatalog(accounts));

	const saved = savedAccounts ?? catalog.saved;

	const account =
		saved.find((item) => AccountStore.key(item) === preferredAccountKey) ??
		saved[0];

	const activate = (next: RepositoryView) => {
		onView?.(next);
		const button = buttons.current.get(next);

		if (button) renderer.focusElement?.(button.id);
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
				testId="workspace-rail"
				role="navigation"
				aria-label="Workspace tools"
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					width: workspaceRailWidth,
					flexShrink: 0,
					paddingTop: 6,
					paddingBottom: 12,
					gap: 6,
				}}
			>
				{view && onView ? (
					<div
						role="tablist"
						aria-label="Repository views"
						aria-orientation="vertical"
						style={{ display: "flex", flexDirection: "column", gap: 6 }}
					>
						{repositoryViews.map((item, index) => (
							<RailAction
								key={item.value}
								testId={`view-${item.value}`}
								role="tab"
								aria-selected={view === item.value}
								tabIndex={view === item.value ? 0 : -1}
								selected={view === item.value}
								disabled={disabled}
								label={item.label}
								icon={icons[item.value]}
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
				<div style={{ flexGrow: 1 }} />
				<RailAction
					ref={settingsButtonRef}
					testId="rail-settings"
					role="button"
					label="Settings (Command comma)"
					icon={icons.settings}
					selected={settingsActive}
					disabled={disabled}
					onClick={onSettings}
					onKeyDown={actionKey(onSettings)}
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
						account ? accountProviderIcons[account.provider] : icons.account
					}
					disabled={disabled}
					onClick={chooseAccount}
					onKeyDown={actionKey(chooseAccount)}
				/>
			</div>
		</TooltipProvider>
	);
}
