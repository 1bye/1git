import { isAbsolute, relative, sep } from "node:path";
import { useEffect, useRef, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Textarea } from "@1git/gpuix-ui/textarea";
import {
	codeTypography,
	fontWeight,
	radius,
	spacing,
	typography,
} from "@1git/design-tokens";
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
	const muted = { ...typography.sm, color: tokens.colors.textMuted };
	const label = { ...textStyle, fontWeight: fontWeight.medium };
	const locked = busy || disabled;

	const column = {
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		flexShrink: 0,
		gap: spacing[2],
	} as const;

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[3],
	} as const;

	const section = {
		...column,
		paddingTop: spacing[4],
		borderTopWidth: 1,
		borderColor: tokens.colors.border,
	};

	const fieldStyle = {
		...textStyle,
		height: tokens.layout.controlHeight,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: radius.md,
		backgroundColor: tokens.colors.field,
		flexShrink: 0,
		opacity: locked ? 0.5 : 1,
	} as const;

	return (
		<div
			testId="ignored-history-settings"
			style={{
				...column,
				flexGrow: 1,
				flexShrink: 1,
				minHeight: 0,
				overflowY: "scroll",
				padding: spacing[4],
			}}
		>
			<div
				testId="ignored-history-settings-form"
				style={{ ...column, width: "100%", maxWidth: 480, gap: spacing[4] }}
			>
				<div style={{ ...column, gap: spacing[1] }}>
					<text
						role="heading"
						aria-level={1}
						style={{ ...label, ...typography.lg }}
					>
						Ignored file history
					</text>
					<text style={muted}>
						Encrypted local versions of selected Git-ignored files and folders.
					</text>
				</div>
				{!isAbsolute(repository.root) ? (
					<text style={muted}>
						Available for local repositories. SSH repositories are not
						monitored.
					</text>
				) : (
					<>
						<div style={{ ...column, gap: spacing[1] }}>
							<Checkbox
								testId="ignored-history-enabled"
								checked={enabled}
								onCheckedChange={setEnabled}
								disabled={locked}
								label="Enable history for this repository"
								tokens={tokens}
								style={{ alignSelf: "flex-start", paddingLeft: 0 }}
							/>
							<text style={muted}>
								Capture starts when enabled and runs while this repository is
								open.
							</text>
						</div>
						<div style={section}>
							<div style={{ ...row, justifyContent: "space-between" }}>
								<text role="heading" aria-level={2} style={label}>
									Files and folders
								</text>
								<Button
									testId="ignored-history-browse"
									tokens={tokens}
									variant="secondary"
									size="sm"
									disabled={locked}
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
							</div>
							<Textarea
								testId="ignored-history-paths"
								aria-label="Monitored ignored files and folders"
								aria-description="Repository-relative paths, one per line. Folders include future ignored files recursively."
								value={paths}
								placeholder={".env\nprivate-config/"}
								onValueChange={(value) => {
									if (!locked) setPaths(value);
								}}
								readOnly={locked}
								aria-disabled={locked}
								tabIndex={locked ? undefined : 0}
								tokens={tokens}
								minRows={4}
								maxRows={6}
								style={{
									fontFamily: codeTypography.fontFamily,
									opacity: locked ? 0.5 : 1,
								}}
							/>
							<text style={muted}>
								One repository-relative path per line. Folders include future
								ignored files. Tracked files, Git metadata and links are
								excluded.
							</text>
						</div>
						<div style={section}>
							<text role="heading" aria-level={2} style={label}>
								History limits
							</text>
							<div
								style={{ ...row, alignItems: "flex-start", gap: spacing[4] }}
							>
								<div
									style={{
										...column,
										flexGrow: 1,
										flexBasis: 0,
										gap: spacing[1.5],
									}}
								>
									<text style={muted}>Storage budget (MiB)</text>
									<input
										testId="ignored-history-budget"
										aria-label="History storage budget in MiB"
										value={budget}
										onChange={(event) => {
											if (!locked) setBudget(event.value ?? "");
										}}
										readOnly={locked}
										aria-disabled={locked}
										tabIndex={locked ? undefined : 0}
										style={fieldStyle}
									/>
								</div>
								<div
									style={{
										...column,
										flexGrow: 1,
										flexBasis: 0,
										gap: spacing[1.5],
									}}
								>
									<text style={muted}>Versions per file</text>
									<input
										testId="ignored-history-versions"
										aria-label="Retained versions per file"
										value={versions}
										onChange={(event) => {
											if (!locked) setVersions(event.value ?? "");
										}}
										readOnly={locked}
										aria-disabled={locked}
										tabIndex={locked ? undefined : 0}
										style={fieldStyle}
									/>
								</div>
							</div>
							<text style={muted}>
								Accepted baselines are kept separately. Turning history off
								keeps saved versions.
							</text>
						</div>
						<div style={section}>
							<div
								style={{
									...row,
									justifyContent: "space-between",
									flexWrap: "wrap",
								}}
							>
								<div style={{ ...row, gap: spacing[2] }}>
									<Button
										testId="ignored-history-save"
										tokens={tokens}
										disabled={locked}
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
										{busy ? "Saving versions…" : "Save changes"}
									</Button>
									{busy ? (
										<Button
											testId="ignored-history-cancel"
											tokens={tokens}
											variant="ghost"
											onPress={() => pending.current?.abort()}
										>
											Cancel
										</Button>
									) : null}
								</div>
								{status?.data ? (
									<text role="status" style={muted}>
										{`${status.data.files.length} protected ${status.data.files.length === 1 ? "file" : "files"} · ${(status.data.bytes / 1024 ** 2).toFixed(1)} MiB stored${status.data.skipped.length ? ` · ${status.data.skipped.length} paths skipped` : ""}`}
									</text>
								) : null}
							</div>
							{notice ? (
								<text role="status" style={muted}>
									{notice}
								</text>
							) : null}
							<text style={muted}>
								Stored only on this device, outside Git and AI context. Linked
								worktrees share settings and keep separate histories. Use
								dedicated backup tools for live databases.
							</text>
						</div>
					</>
				)}
				{error || status?.error ? (
					<text role="alert" style={{ ...muted, color: tokens.colors.danger }}>
						{error ?? status?.error}
					</text>
				) : null}
			</div>
		</div>
	);
}
