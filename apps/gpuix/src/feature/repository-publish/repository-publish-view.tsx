import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { useEffect, useRef, useState } from "react";
import { spacing, typography, radius, fontWeight } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@1git/gpuix-ui/select";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import type { GitResult, SyncResult } from "@1git/git";
import type { Owner } from "@1git/hosting/contracts";
import type { Accounts } from "../accounts/lib/accounts";
import { AccountStore } from "../accounts/lib/account-store";
import { accountProviderIcons } from "../accounts/account-provider-icons";
import { ChoiceTile } from "../../fixture/choice-tile";
import { StateArtwork } from "../../fixture/state-artwork";

import {
	RepositoryPublish,
	type PublishRepositoryRequest,
	type PublishedRepository,
} from "./repository-publish";

const column = { display: "flex", flexDirection: "column", gap: spacing[2] };

const row = {
	display: "flex",
	flexDirection: "row",
	alignItems: "center",
	gap: spacing[2],
};

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const muted = { ...typography.sm, color: appTokens.colors.textMuted };

	const fieldStyle = {
		height: appTokens.layout.controlHeight,
		...typography.md,
		color: appTokens.colors.text,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: appTokens.colors.border,
		backgroundColor: "transparent",
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
	};

	return { muted, fieldStyle };
});

function PublishField({
	label,
	id,
	value,
	disabled,
	onChange,
}: {
	label: string;
	id: string;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const theme = useAppTheme();
	const { muted, fieldStyle } = themedStyles.get(theme);

	return (
		<div style={column}>
			<text style={muted}>{label}</text>
			<input
				testId={id}
				aria-label={label}
				value={value}
				readOnly={disabled}
				aria-disabled={disabled}
				style={fieldStyle}
				onChange={(event) => {
					if (!disabled) onChange(event.value ?? "");
				}}
			/>
		</div>
	);
}

/** Right-side publishing form. Public receipts survive dismissal; provider/Git writes stay with the window owner. */
export function RepositoryPublishView({
	accounts,
	name: repositoryName,
	active,
	disabled,
	created,
	uncertain,
	blockedReason,
	preferredAccountKey,
	onSubmit,
	onClose,
	onCancel,
	onSettings,
}: {
	accounts: Accounts;
	name: string;
	active: boolean;
	disabled: boolean;
	created?: PublishedRepository;
	uncertain: boolean;
	blockedReason?: string;
	preferredAccountKey?: string;
	onSubmit: (
		request: PublishRepositoryRequest
	) => Promise<GitResult<SyncResult> | undefined>;
	onClose: () => void;
	onCancel: () => void;
	onSettings: () => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { muted } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const panel = useRef<PublicInstance>(null);
	const mounted = useRef(true);
	const working = useRef(false);
	const ownerRequest = useRef<AbortController | null>(null);

	const [catalog, setCatalog] = useState(() => {
		try {
			return { saved: accounts.load(), error: "" };
		} catch {
			return {
				saved: [],
				error: "Could not load connected accounts. Check Settings.",
			};
		}
	});

	const [accountKey, setAccountKey] = useState(
		() =>
			created?.accountKey ??
			(catalog.saved.some(
				(item) => AccountStore.key(item) === preferredAccountKey
			)
				? preferredAccountKey
				: undefined) ??
			(catalog.saved[0] ? AccountStore.key(catalog.saved[0]) : "")
	);

	const [name, setName] = useState(created?.ref.name ?? repositoryName);
	const [description, setDescription] = useState("");

	const [visibility, setVisibility] = useState<"private" | "public">(
		created?.visibility ?? "private"
	);

	const [owners, setOwners] = useState<readonly Owner[]>([]);
	const [ownerKey, setOwnerKey] = useState("");
	const [next, setNext] = useState<string | null>(null);
	const [loadingOwners, setLoadingOwners] = useState(false);
	const [ownerVersion, setOwnerVersion] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const account = catalog.saved.find(
		(item) => AccountStore.key(item) === accountKey
	);

	const owner = owners.find((item) => item.id === ownerKey);
	const locked = disabled || busy;
	const draftLocked = locked || !!created || uncertain;

	const canSubmit =
		!!account &&
		(!!owner || !!created) &&
		RepositoryPublish.validName(name.trim()) &&
		description.length <= 350 &&
		!locked &&
		!uncertain &&
		!blockedReason &&
		!loadingOwners;

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			ownerRequest.current?.abort();
		};
	}, []);

	useEffect(() => {
		if (!active) return;

		try {
			setCatalog({ saved: accounts.load(), error: "" });
		} catch {
			setCatalog({
				saved: [],
				error: "Could not load connected accounts. Check Settings.",
			});
		}

		if (panel.current) renderer.focusElement?.(panel.current.id);
	}, [active, accounts, renderer]);

	useEffect(() => {
		if (!active || !account || created || uncertain) return;

		const controller = new AbortController();

		ownerRequest.current?.abort();
		ownerRequest.current = controller;
		setLoadingOwners(true);
		setOwners([]);
		setOwnerKey("");
		setNext(null);
		setError("");

		async function load() {
			if (!account) return;

			try {
				const page = await accounts.owners(account, {
					signal: controller.signal,
					pageSize: 100,
				});

				if (controller.signal.aborted) return;

				setOwners(page.items);
				setNext(page.next);
				setOwnerKey(
					(
						page.items.find(
							(item) => item.kind === "user" && item.path === account.username
						) ?? page.items[0]
					)?.id ?? ""
				);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not load repository owners."
					);
			} finally {
				if (!controller.signal.aborted) setLoadingOwners(false);
			}
		}

		void load();

		return () => controller.abort();
	}, [accounts, account, active, created, uncertain, ownerVersion]);

	async function loadMore() {
		if (!account || !next || loadingOwners || locked) return;

		const controller = new AbortController();

		ownerRequest.current?.abort();
		ownerRequest.current = controller;
		setLoadingOwners(true);

		try {
			const page = await accounts.owners(account, {
				cursor: next,
				signal: controller.signal,
				pageSize: 100,
			});

			if (!mounted.current || controller.signal.aborted) return;

			setOwners((previous) => [
				...previous,
				...page.items.filter(
					(item) => !previous.some((entry) => entry.id === item.id)
				),
			]);
			setNext(page.next);
		} catch (cause) {
			if (mounted.current && !controller.signal.aborted)
				setError(
					cause instanceof Error ? cause.message : "Could not load more owners."
				);
		} finally {
			if (mounted.current && !controller.signal.aborted)
				setLoadingOwners(false);
		}
	}

	async function submit() {
		if (!canSubmit || !account || working.current) return;

		const destination =
			owner ??
			(created
				? {
						id: "",
						path: created.ref.owner,
						kind: "user" as const,
						canCreateRepository: null,
					}
				: undefined);

		if (!destination) return;

		working.current = true;
		ownerRequest.current?.abort();
		setBusy(true);
		setError("");

		try {
			const result = await onSubmit({
				account,
				owner: destination,
				name: name.trim(),
				description: description.trim(),
				visibility,
				created,
			});

			if (!mounted.current) return;

			if (result?.ok) onClose();
			else
				setError(
					result
						? result.error.message
						: "Wait for the current Git operation or refresh before publishing."
				);
		} catch {
			if (mounted.current)
				setError(
					"Could not confirm publishing. Check the remote before retrying."
				);
		} finally {
			working.current = false;

			if (mounted.current) setBusy(false);
		}
	}

	return (
		<div
			ref={panel}
			testId="publish-repository-view"
			role="region"
			aria-label="Publish repository"
			tabIndex={-1}
			aria-hidden={!active || undefined}
			onKeyDown={(event) => {
				if (event.key === "escape" && !working.current) onClose();
			}}
			style={{
				...column,
				gap: 0,
				flexGrow: 1,
				minHeight: 0,
				...(active
					? {}
					: {
							position: "absolute",
							visibility: "hidden",
							pointerEvents: "none",
						}),
			}}
		>
			<text
				role="heading"
				aria-level={1}
				style={{
					...typography.lg,
					fontWeight: fontWeight.medium,
					color: appTokens.colors.text,
					padding: spacing[4],
				}}
			>
				Publish repository
			</text>
			<div
				testId="publish-repository-scroll"
				style={{
					...column,
					flexGrow: 1,
					minHeight: 0,
					overflowY: "scroll",
					paddingLeft: spacing[4],
					paddingRight: spacing[4],
					paddingBottom: spacing[4],
				}}
			>
				<div
					style={{ ...column, maxWidth: 480, width: "100%", gap: spacing[3] }}
				>
					<div role="group" aria-label="Publishing account" style={column}>
						{catalog.saved.map((item, index) =>
							index % 2 === 0 ? (
								<div key={AccountStore.key(item)} style={row}>
									{catalog.saved.slice(index, index + 2).map((entry) => (
										<ChoiceTile
											key={AccountStore.key(entry)}
											testId={`publish-account-${entry.id}`}
											label={entry.username}
											detail={new URL(entry.webUrl).host}
											source={accountProviderIcons[entry.provider]}
											disabled={draftLocked}
											selected={AccountStore.key(entry) === accountKey}
											onPress={() => {
												setAccountKey(AccountStore.key(entry));
												setError("");
											}}
										/>
									))}
								</div>
							) : null
						)}
					</div>
					{!catalog.saved.length ? (
						<>
							<StateArtwork name="accounts" />
							<Button
								tokens={appTokens}
								variant="secondary"
								onPress={onSettings}
							>
								Connect an account
							</Button>
						</>
					) : null}
					{created ? (
						<text
							testId="publish-created"
							style={muted}
						>{`Created ${created.ref.owner}/${created.ref.name}. Retry connects the existing repository and uploads this branch.`}</text>
					) : (
						<>
							<div style={column}>
								<text style={muted}>Owner</text>
								<Select
									value={ownerKey}
									items={owners.map((item) => ({
										value: item.id,
										label: item.path,
									}))}
									disabled={draftLocked || loadingOwners}
									onValueChange={(value) => {
										if (value && !draftLocked) setOwnerKey(value);
									}}
								>
									<SelectTrigger
										testId="publish-owner"
										aria-label="Repository owner"
										tokens={appTokens}
										style={{ width: "100%" }}
									>
										<SelectValue
											placeholder={
												loadingOwners ? "Loading owners…" : "Choose owner"
											}
											tokens={appTokens}
										/>
									</SelectTrigger>
									<SelectContent tokens={appTokens}>
										{owners.map((item) => (
											<SelectItem
												key={item.id}
												value={item.id}
												tokens={appTokens}
												disabled={item.canCreateRepository === false}
											>
												{item.path}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{next ? (
									<Button
										testId="publish-more-owners"
										tokens={appTokens}
										variant="ghost"
										size="sm"
										disabled={locked || loadingOwners}
										onPress={() => {
											void loadMore();
										}}
									>
										More owners…
									</Button>
								) : null}
								{error && !owners.length && !loadingOwners ? (
									<Button
										testId="publish-retry-owners"
										tokens={appTokens}
										variant="ghost"
										size="sm"
										disabled={draftLocked}
										onPress={() => setOwnerVersion((previous) => previous + 1)}
									>
										Retry
									</Button>
								) : null}
							</div>
						</>
					)}
					<PublishField
						id="publish-name"
						label="Repository name"
						value={name}
						disabled={draftLocked}
						onChange={setName}
					/>
					<PublishField
						id="publish-description"
						label="Description (optional)"
						value={description}
						disabled={draftLocked}
						onChange={setDescription}
					/>
					<div style={column}>
						<text style={muted}>Visibility</text>
						<div role="group" aria-label="Repository visibility" style={row}>
							{(["private", "public"] as const).map((value) => (
								<Button
									key={value}
									testId={`publish-visibility-${value}`}
									aria-pressed={visibility === value}
									tokens={appTokens}
									variant={visibility === value ? "secondary" : "ghost"}
									disabled={draftLocked}
									onPress={() => setVisibility(value)}
								>
									{value === "private" ? "Private" : "Public"}
								</Button>
							))}
						</div>
					</div>
					<text style={muted}>
						{visibility === "public"
							? "Committed history will be public. Uncommitted files stay on your computer."
							: "Only committed history is uploaded. Uncommitted files stay on your computer."}
					</text>
				</div>
			</div>
			<div
				style={{
					...column,
					flexShrink: 0,
					padding: spacing[4],
					borderTopWidth: 1,
					borderColor: appTokens.colors.border,
				}}
			>
				{blockedReason ? (
					<text testId="publish-repository-blocked" style={muted}>
						{blockedReason}
					</text>
				) : null}
				{catalog.error || error || uncertain ? (
					<text
						testId="publish-repository-error"
						role="alert"
						style={{ ...muted, color: appTokens.colors.danger }}
					>
						{uncertain
							? "Creation could not be confirmed. Check the provider website, then connect the existing repository in Remotes. Creation will not be repeated automatically."
							: catalog.error || error}
					</text>
				) : null}
				<div style={{ ...row, justifyContent: "flex-end" }}>
					<Button
						testId="publish-repository-cancel"
						tokens={appTokens}
						variant="ghost"
						disabled={disabled && !busy}
						onPress={() => {
							if (busy) onCancel();
							else onClose();
						}}
					>
						{busy ? "Stop" : "Cancel"}
					</Button>
					<Button
						testId="publish-repository-submit"
						tokens={appTokens}
						disabled={!canSubmit}
						onPress={() => {
							void submit();
						}}
					>
						{busy
							? "Publishing…"
							: created
								? "Retry push"
								: "Publish repository"}
					</Button>
				</div>
			</div>
		</div>
	);
}
