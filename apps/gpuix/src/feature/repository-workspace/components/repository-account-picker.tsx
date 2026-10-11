import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, radius, iconSize } from "@1git/design-tokens";
import {
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Ref,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
} from "@1git/gpuix-ui/popover";
import type { Repository } from "@1git/hosting/contracts";

import type { SavedAccount } from "../../accounts/lib/account-store";
import type { Accounts } from "../../accounts/lib/accounts";
import { StateMessage } from "../../../fixture/state-message";
import { RepositoryAvatar, RepositoryAvatarContext } from "./repository-avatar";

/** A public selection, never an authenticated provider or credential. */
export interface AccountCloneSelection {
	readonly account: SavedAccount;
	readonly repository: Repository;
}
const column = { display: "flex", flexDirection: "column", gap: spacing[1.5] };

const repositoryRowHeight = 52;
const repositoryRowGap = 2;
const repositoryRowStride = repositoryRowHeight + repositoryRowGap;

const rowText = {
	minWidth: 0,
	pointerEvents: "none",
	whiteSpace: "nowrap",
	textOverflow: "ellipsis",
} as const;

const visibilityLabels = {
	public: "Public",
	private: "Private",
	internal: "Internal",
};

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const hint = { ...typography.sm, color: appTokens.colors.textMuted };

	const inputStyle = {
		height: 30,
		...typography.md,
		borderWidth: 1,
		borderRadius: radius.md,
		borderColor: appTokens.colors.border,
		backgroundColor: "transparent",
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		color: appTokens.colors.text,
	};

	return { hint, inputStyle };
});

/** Bounded, cancellable browsing. Only public account metadata and repository identities enter the view. */
export function RepositoryAccountPicker({
	accounts,
	account,
	onSelect,
	onSettings,
	selection,
	searchRef,
}: {
	accounts: Accounts;
	account: SavedAccount;
	onSelect: (selection?: AccountCloneSelection) => void;
	onSettings: () => void;
	selection?: AccountCloneSelection;
	searchRef?: Ref<PublicInstance>;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { hint, inputStyle } = themedStyles[theme.appearance];

	const avatars = use(RepositoryAvatarContext);
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const [query, setQuery] = useState("");
	const [permissionOpen, setPermissionOpen] = useState(false);
	const [retry, setRetry] = useState(0);
	const [items, setItems] = useState<readonly Repository[]>([]);
	const [next, setNext] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [access, setAccess] = useState<boolean | null>(null);
	const request = useRef<AbortController | null>(null);

	const selected = selection?.repository;

	const displayed = useMemo(
		() =>
			selected && !items.some((item) => item.id === selected.id)
				? [selected, ...items]
				: items,
		[items, selected]
	);

	// Native viewport notifications schedule only visible artwork, without React scroll state.
	const preloadAvatars = useCallback((): void => {
		if (!avatars) return;

		const anchor = viewport.current
			? renderer.getListScrollTop?.(viewport.current.id)
			: undefined;

		const first = Math.max(0, (anchor?.[0] ?? 0) - 1);

		const count = anchor
			? Math.ceil(((anchor[1] ?? 0) + (anchor[2] ?? 0)) / repositoryRowStride) +
				3
			: 12;

		for (const item of displayed.slice(first, first + count)) {
			void avatars.load({ remote: item.browserUrl, avatarUrl: item.avatarUrl });
		}
	}, [avatars, displayed, renderer]);

	useEffect(() => {
		// The initial viewport can paint before native range notifications are registered.
		const timer = setTimeout(preloadAvatars, 0);

		return () => clearTimeout(timer);
	}, [preloadAvatars]);

	useEffect(() => {
		if (!account) return;

		const controller = new AbortController();

		request.current = controller;
		setItems([]);
		setNext(null);
		setLoading(true);
		setError(undefined);
		const timer = setTimeout(
			async () => {
				try {
					const [page, permission] = await Promise.all([
						accounts.repositories(account, query, {
							pageSize: 30,
							signal: controller.signal,
						}),
						accounts.repositoryAccess(account),
					]);

					if (!controller.signal.aborted) {
						setItems(page.items);
						setNext(page.next);
						setAccess(permission);
					}
				} catch (cause) {
					if (!controller.signal.aborted)
						setError(
							cause instanceof Error
								? cause.message
								: "Could not load repositories."
						);
				} finally {
					if (!controller.signal.aborted) {
						setLoading(false);
						request.current = null;
					}
				}
			},
			query.trim() ? 300 : 0
		);

		return () => {
			clearTimeout(timer);
			controller.abort();
			request.current?.abort();
		};
	}, [accounts, account, query, retry]);

	const more = async () => {
		if (!account || !next || request.current) return;

		const controller = new AbortController();

		request.current = controller;
		setLoading(true);
		setError(undefined);

		try {
			const page = await accounts.repositories(account, query, {
				pageSize: 30,
				cursor: next,
				signal: controller.signal,
			});

			if (!controller.signal.aborted) {
				setItems((previous) => {
					const ids = new Set(previous.map((item) => item.id));

					return [
						...previous,
						...page.items.filter((item) => !ids.has(item.id)),
					];
				});
				setNext(page.next);
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not load more repositories."
				);
		} finally {
			if (!controller.signal.aborted) {
				setLoading(false);
				request.current = null;
			}
		}
	};

	const resetSelection = () => {
		onSelect(undefined);
	};

	return (
		<div
			testId="clone-account-picker"
			style={{ ...column, flexGrow: 1, minHeight: 0, gap: spacing[3] }}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[2.5],
					flexShrink: 0,
				}}
			>
				<input
					ref={searchRef}
					testId="clone-search"
					tabIndex={0}
					autoFocus
					aria-label="Search accessible repositories"
					placeholder="Search repositories…"
					value={query}
					style={{ ...inputStyle, flexGrow: 1, minWidth: 0 }}
					onChange={(event) => {
						request.current?.abort();
						resetSelection();
						setQuery(event.value ?? "");
					}}
				/>
				<Popover open={permissionOpen} onOpenChange={setPermissionOpen}>
					<PopoverTrigger asChild>
						<Button
							testId="clone-permissions"
							tokens={appTokens}
							variant="ghost"
							size="sm"
							aria-label="Repository access information"
							style={{ gap: spacing[1.5] }}
						>
							<text style={{ ...hint, pointerEvents: "none" }}>
								{access === false
									? "Public access"
									: access === true
										? "Repository access"
										: "Account access"}
							</text>
							<svg
								source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M12 11v6m0-10v1" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>'
								style={{
									width: iconSize.sm,
									height: iconSize.sm,
									color: appTokens.colors.textMuted,
									pointerEvents: "none",
								}}
							/>
						</Button>
					</PopoverTrigger>
					<PopoverContent
						tokens={appTokens}
						width={300}
						align="end"
						aria-label="Repository access"
					>
						<div style={column}>
							<text style={hint}>
								{access === false
									? "Reconnect in Settings with repository access to see private repositories."
									: "Missing a private repository? Check token permissions or organization SSO in Settings."}
							</text>
							<text style={hint}>
								Search includes accessible public repositories.
							</text>
							<Button
								testId="clone-manage-access"
								tokens={appTokens}
								variant="secondary"
								size="sm"
								onPress={onSettings}
							>
								Manage access…
							</Button>
						</div>
					</PopoverContent>
				</Popover>
			</div>
			{displayed.length ? (
				<virtual-list
					ref={viewport}
					onVisibleRange={preloadAvatars}
					testId="clone-repositories"
					role="group"
					aria-label="Repositories"
					estimatedItemHeight={repositoryRowStride}
					overdraw={repositoryRowStride}
					style={{
						flexGrow: 1,
						minHeight: 0,
					}}
				>
					{displayed.map((item) => (
						<div
							key={item.id}
							style={{
								display: "flex",
								flexDirection: "column",
								height: repositoryRowStride,
								paddingBottom: repositoryRowGap,
							}}
						>
							<Button
								testId={`clone-repository-${item.id}`}
								tokens={appTokens}
								size="sm"
								variant={selected?.id === item.id ? "secondary" : "ghost"}
								aria-label={`${item.ref.owner}/${item.ref.name}`}
								aria-description={
									selected?.id === item.id ? "Selected repository" : undefined
								}
								aria-pressed={selected?.id === item.id}
								disabled={loading}
								onPress={() => onSelect({ account, repository: item })}
								style={{
									height: repositoryRowHeight,
									flexDirection: "row",
									alignItems: "center",
									justifyContent: "center",
									gap: spacing[2.5],
									paddingLeft: spacing[3],
									paddingRight: spacing[3],
								}}
							>
								<RepositoryAvatar
									deferred
									label={item.ref.owner}
									source={{
										remote: item.browserUrl,
										avatarUrl: item.avatarUrl,
									}}
									testId={`clone-avatar-${item.id}`}
								/>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: spacing[0.75],
										flexGrow: 1,
										minWidth: 0,
										pointerEvents: "none",
									}}
								>
									<text
										testId={`clone-repository-name-${item.id}`}
										style={{
											...rowText,
											...typography.md,
											color: appTokens.colors.text,
										}}
									>
										{`${item.ref.owner}/${item.ref.name}`}
									</text>
									<text
										testId={`clone-repository-description-${item.id}`}
										style={{ ...hint, ...rowText }}
									>
										{`${visibilityLabels[item.visibility]}${item.description ? ` · ${item.description}` : ""}`}
									</text>
								</div>
							</Button>
						</div>
					))}
					{loading ? (
						<text role="status" style={hint}>
							Loading repositories…
						</text>
					) : null}
					{next && !loading ? (
						<Button
							testId="clone-more"
							tokens={appTokens}
							size="sm"
							variant="ghost"
							onPress={() => {
								void more();
							}}
						>
							Load more
						</Button>
					) : null}
				</virtual-list>
			) : (
				<StateMessage
					testId={error ? "clone-browse-error" : "clone-browse-state"}
					role={error ? "alert" : "status"}
					artwork={
						error
							? "error"
							: loading
								? "loading"
								: query.trim()
									? "search"
									: "repository"
					}
					title={
						error
							? "Could not load repositories"
							: loading
								? "Loading repositories…"
								: query.trim()
									? "No repositories found."
									: "No repositories available for this account."
					}
					description={
						error ??
						(loading
							? undefined
							: "Try another search or check your account access.")
					}
				>
					{error ? (
						<Button
							testId="clone-retry"
							tokens={appTokens}
							size="sm"
							variant="secondary"
							onPress={() => {
								resetSelection();
								setRetry((value) => value + 1);
							}}
						>
							Retry
						</Button>
					) : null}
				</StateMessage>
			)}
			{error && displayed.length ? (
				<div style={{ ...column, flexShrink: 0 }}>
					<text
						testId="clone-browse-error"
						role="alert"
						style={{ ...hint, color: appTokens.colors.danger }}
					>
						{error}
					</text>
					<Button
						testId="clone-retry"
						tokens={appTokens}
						size="sm"
						variant="secondary"
						style={{ alignSelf: "flex-start" }}
						onPress={() => {
							resetSelection();
							setRetry((value) => value + 1);
						}}
					>
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}
