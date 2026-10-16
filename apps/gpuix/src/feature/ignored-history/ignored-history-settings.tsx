import { isAbsolute, relative, sep } from "node:path";
import { useEffect, useRef, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import {
	IgnoredHistory,
	defaultIgnoredPreferences,
	type IgnoredRepository,
} from "./ignored-history";
import type { IgnoredHistoryStatus } from "./use-ignored-histories";

/** Repository-only opt-in, explicit recursive selections and bounded history storage. */
export function IgnoredHistorySettings({
	repository,
	history,
	status,
	disabled,
	onRefresh,
	onBusy,
}: {
	repository: IgnoredRepository;
	history: IgnoredHistory;
	status?: IgnoredHistoryStatus;
	disabled?: boolean;
	onRefresh: () => Promise<void>;
	onBusy: (busy: boolean) => void;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const preferences = status?.data?.preferences ?? defaultIgnoredPreferences;
	const savedPaths = preferences.paths.join("\n");
	const [paths, setPaths] = useState(savedPaths);
	const [enabled, setEnabled] = useState(preferences.enabled);

	const [budget, setBudget] = useState(
		String(preferences.budgetBytes / 1024 ** 2)
	);

	const [versions, setVersions] = useState(String(preferences.maxVersions));
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string>();
	const [error, setError] = useState<string>();
	const pending = useRef<AbortController | null>(null);

	useEffect(() => {
		setPaths(savedPaths);
		setEnabled(preferences.enabled);
		setBudget(String(preferences.budgetBytes / 1024 ** 2));
		setVersions(String(preferences.maxVersions));
	}, [
		savedPaths,
		preferences.enabled,
		preferences.budgetBytes,
		preferences.maxVersions,
	]);
	useEffect(() => () => pending.current?.abort(), []);

	const perform = async (action: () => Promise<void>) => {
		if (pending.current || disabled) return;

		const controller = new AbortController();

		pending.current = controller;
		setBusy(true);
		onBusy(true);
		setError(undefined);
		setNotice(undefined);

		try {
			await action();
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Ignored history could not be updated."
				);
		} finally {
			pending.current = null;
			setBusy(false);
			onBusy(false);
		}
	};

	const textStyle = { ...typography.md, color: tokens.colors.text };

	const fieldStyle = {
		...textStyle,
		minHeight: 32,
		padding: spacing[2],
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: 6,
		backgroundColor: "transparent",
	} as const;

	return (
		<div
			testId="ignored-history-settings"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
				padding: spacing[4],
				gap: spacing[3],
			}}
		>
			<text
				role="heading"
				aria-level={1}
				style={{ ...typography.lg, color: tokens.colors.text }}
			>
				Ignored file history
			</text>
			{!isAbsolute(repository.root) ? (
				<text style={textStyle}>
					Encrypted ignored-file history is currently available for local
					repositories. SSH repositories are not monitored.
				</text>
			) : (
				<>
					<text style={{ ...typography.md, color: tokens.colors.textMuted }}>
						Keep encrypted local versions of selected Git-ignored files and
						folders. History starts when you enable it and is captured while
						this repository is open in 1git. Contents are never added to commits
						or AI context.
					</text>
					<Checkbox
						testId="ignored-history-enabled"
						checked={enabled}
						onCheckedChange={setEnabled}
						disabled={busy || disabled}
						label="Enable ignored file history for this repository"
						tokens={tokens}
					/>
					<text style={textStyle}>
						Files and folders, relative to this repository (one per line)
					</text>
					<textarea
						testId="ignored-history-paths"
						aria-label="Monitored ignored files and folders"
						value={paths}
						placeholder={".env\nprivate-config"}
						onChange={(event) => {
							if (!busy && !disabled) setPaths(event.value ?? "");
						}}
						aria-disabled={busy || disabled}
						style={{ ...fieldStyle, height: 120, flexShrink: 0, maxWidth: 520 }}
					/>
					<Button
						testId="ignored-history-browse"
						tokens={tokens}
						variant="secondary"
						disabled={busy || disabled}
						style={{ alignSelf: "flex-start" }}
						onPress={() => {
							void perform(async () => {
								if (!renderer.promptForPaths)
									throw new Error(
										"Enter a relative path above; the file picker is unavailable."
									);

								const chosen = await renderer.promptForPaths({
									directories: true,
									files: true,
									multiple: true,
									prompt: "Monitor ignored files or folders",
								});

								if (!chosen) return;

								const additions = chosen.map((path) => {
									const value = relative(repository.root, path);

									if (
										!value ||
										isAbsolute(value) ||
										value === ".." ||
										value.startsWith(`..${sep}`)
									)
										throw new Error(
											"Choose files or folders inside this repository."
										);

									return value.split(sep).join("/");
								});

								setPaths((current) =>
									[
										...new Set([
											...current.split("\n").filter(Boolean),
											...additions,
										]),
									].join("\n")
								);
							});
						}}
					>
						Browse…
					</Button>
					<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
						Folders include future ignored files recursively. Tracked files, Git
						metadata, symbolic links and hard links are excluded. Live databases
						may require their own backup tools for a consistent snapshot.
					</text>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							gap: spacing[3],
							alignItems: "center",
						}}
					>
						<text style={textStyle}>Storage budget (MiB)</text>
						<input
							testId="ignored-history-budget"
							aria-label="History storage budget in MiB"
							value={budget}
							onChange={(event) => {
								if (!busy && !disabled) setBudget(event.value ?? "");
							}}
							aria-disabled={busy || disabled}
							style={{ ...fieldStyle, width: 96 }}
						/>
						<text style={textStyle}>Versions per file</text>
						<input
							testId="ignored-history-versions"
							aria-label="Retained versions per file"
							value={versions}
							onChange={(event) => {
								if (!busy && !disabled) setVersions(event.value ?? "");
							}}
							aria-disabled={busy || disabled}
							style={{ ...fieldStyle, width: 64 }}
						/>
					</div>
					<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
						The accepted baseline is retained separately. Disabling monitoring
						keeps saved history. Settings are shared by linked worktrees; their
						file histories stay separate.
					</text>
					<Button
						testId="ignored-history-save"
						tokens={tokens}
						disabled={busy || disabled}
						style={{ alignSelf: "flex-start" }}
						onPress={() => {
							void perform(async () => {
								await history.configure(
									repository,
									{
										enabled,
										paths: paths
											.split("\n")
											.map((path) => path.trim())
											.filter(Boolean),
										budgetBytes: Number(budget) * 1024 ** 2,
										maxVersions: Number(versions),
									},
									pending.current?.signal
								);
								await onRefresh();
								setNotice(
									enabled
										? "Monitoring enabled. Initial versions are safely saved."
										: "Monitoring disabled. Saved history is retained."
								);
							});
						}}
					>
						{busy ? "Saving initial versions…" : "Save monitoring settings"}
					</Button>
					{busy ? (
						<Button
							testId="ignored-history-cancel"
							tokens={tokens}
							variant="ghost"
							style={{ alignSelf: "flex-start" }}
							onPress={() => pending.current?.abort()}
						>
							Cancel capture
						</Button>
					) : null}
					{status?.data ? (
						<text
							role="status"
							style={{ ...typography.sm, color: tokens.colors.textMuted }}
						>{`${status.data.files.length} protected files · ${(status.data.bytes / 1024 ** 2).toFixed(1)} MiB stored${status.data.skipped.length ? ` · ${status.data.skipped.length} paths skipped` : ""}`}</text>
					) : null}
					{notice ? (
						<text role="status" style={textStyle}>
							{notice}
						</text>
					) : null}
				</>
			)}
			{error || status?.error ? (
				<text
					role="alert"
					style={{ ...typography.md, color: tokens.colors.danger }}
				>
					{error ?? status?.error}
				</text>
			) : null}
		</div>
	);
}
