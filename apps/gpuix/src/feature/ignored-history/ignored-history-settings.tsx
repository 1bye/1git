import { isAbsolute, relative, sep } from "node:path";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { codeTypography, radius, spacing } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import {
	SettingsPage,
	SettingsPanel,
	SettingsSplit,
	settingsStyles,
} from "../settings/settings-layout";
import {
	SettingsGroup,
	SettingsGroupRow,
	SettingsGroupEmpty,
} from "../settings/settings-group";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import {
	IgnoredHistory,
	defaultIgnoredPreferences,
	type IgnoredRepository,
	type IgnoredPreferences,
	type IgnoredHistoryState,
} from "./ignored-history";
import type { IgnoredHistoryStatus } from "./use-ignored-histories";

type HistoryEditor = "path" | "limits";
type RunHistoryAction = (
	action: (signal: AbortSignal) => Promise<void>
) => Promise<boolean>;

/** Lets the Settings back chain dismiss an ignored-history draft before leaving. */
export interface IgnoredHistorySettingsHandle {
	cancelEditor: () => boolean;
}

function latestCapture(
	data: IgnoredHistoryState | undefined
): number | undefined {
	let latest = 0;

	for (const file of data?.files ?? [])
		for (const version of file.versions) {
			const at = Date.parse(version.at);

			if (Number.isFinite(at) && at > latest) latest = at;
		}

	return latest || undefined;
}

/** Immediate repository preferences, with private drafts for path and limit changes. */
export function IgnoredHistorySettings({
	ref,
	repository,
	history,
	status,
	disabled = false,
	onRefresh,
	onBusy,
	onOpen,
}: {
	ref?: Ref<IgnoredHistorySettingsHandle>;
	repository: IgnoredRepository;
	history: IgnoredHistory;
	status?: IgnoredHistoryStatus;
	disabled?: boolean;
	onRefresh: () => Promise<void>;
	onBusy: (busy: boolean) => void;
	onOpen?: () => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const renderer = useGpuixRequired();
	const [snapshot, setSnapshot] = useState(status?.data);
	const [editing, setEditing] = useState<HistoryEditor | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string>();
	const [error, setError] = useState<string>();
	const pending = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const busyCallback = useRef(onBusy);

	busyCallback.current = onBusy;
	const returnFocus = useRef<number | null>(null);
	const panel = useRef<PublicInstance | null>(null);
	const addButton = useRef<PublicInstance | null>(null);
	const preferences = snapshot?.preferences ?? defaultIgnoredPreferences;
	const locked = busy || disabled;
	const listLocked = locked || editing !== null;
	const local = isAbsolute(repository.root);
	const capturedAt = latestCapture(snapshot);

	useEffect(() => {
		if (status?.data) setSnapshot(status.data);
	}, [status?.data]);
	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			pending.current?.abort();
			busyCallback.current(false);
		};
	}, []);
	const cancelEditor = useCallback(() => {
		if (!editing) return false;

		if (!pending.current) {
			setEditing(null);
			setError(undefined);
		}

		return true;
	}, [editing]);

	useImperativeHandle(ref, () => ({ cancelEditor }), [cancelEditor]);
	useEffect(() => {
		const timer = setTimeout(() => {
			if (editing && panel.current)
				renderer.focusNextWithin?.(panel.current.id);
			else if (!editing && returnFocus.current !== null) {
				const target = returnFocus.current;

				returnFocus.current = null;

				if (renderer.getElementBounds?.(target))
					renderer.focusElement?.(target);
				else if (addButton.current)
					renderer.focusElement?.(addButton.current.id);
			}
		}, 0);

		return () => clearTimeout(timer);
	}, [editing, renderer]);

	const run: RunHistoryAction = async (action) => {
		if (pending.current || disabled || !local) return false;

		const controller = new AbortController();

		pending.current = controller;
		setBusy(true);
		busyCallback.current(true);
		setError(undefined);
		setNotice(undefined);

		try {
			await action(controller.signal);

			return mounted.current && !controller.signal.aborted;
		} catch (cause) {
			if (mounted.current && !controller.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Ignored history could not be updated."
				);

			return false;
		} finally {
			pending.current = null;

			if (mounted.current) {
				setBusy(false);
				busyCallback.current(false);
			}
		}
	};

	const save = async (next: IgnoredPreferences) => {
		const saved = await run(async (signal) => {
			const result = await history.configure(repository, next, signal);

			if (!mounted.current || signal.aborted) return;

			setSnapshot(result);
			await onRefresh();

			if (mounted.current && !signal.aborted)
				setNotice(
					next.enabled
						? "Monitoring updated. Initial versions are safely saved."
						: "Monitoring disabled. Saved history is retained."
				);
		});

		if (saved) setEditing(null);

		return saved;
	};

	const edit = (kind: HistoryEditor) => {
		if (listLocked) return;

		returnFocus.current = renderer.getFocusedElementId?.() ?? null;
		setError(undefined);
		setNotice(undefined);
		setEditing(kind);
	};

	return (
		<SettingsSplit
			testId="ignored-history-settings"
			list={
				<SettingsPage
					testId="ignored-history-settings-page"
					scrollTestId="ignored-history-settings-scroll"
					title="Ignored file history"
					description="Encrypted local versions of selected Git-ignored files and folders."
				>
					<div
						testId="ignored-history-settings-form"
						style={{ ...styles.column, gap: 0 }}
					>
						{!local ? (
							<text style={styles.description}>
								Available for local repositories. SSH repositories are not
								monitored.
							</text>
						) : (
							<>
								<SettingsGroup title="Capture">
									<SettingsGroupRow
										label="Enable history for this repository"
										description="Capture runs while this repository is open. Turning history off keeps saved versions."
										trailing={
											<Checkbox
												testId="ignored-history-enabled"
												aria-label="Enable history for this repository"
												checked={preferences.enabled}
												disabled={listLocked}
												tokens={tokens}
												onCheckedChange={(enabled) => {
													void save({ ...preferences, enabled });
												}}
											/>
										}
									/>
								</SettingsGroup>
								<SettingsGroup
									title="Status"
									action={
										<Button
											testId="ignored-history-open"
											tokens={tokens}
											size="sm"
											variant="secondary"
											disabled={listLocked || !onOpen}
											onPress={onOpen}
										>
											Browse history
										</Button>
									}
								>
									<SettingsGroupRow
										label={`${snapshot?.files.length ?? 0} protected ${snapshot?.files.length === 1 ? "file" : "files"}`}
										description={`${((snapshot?.bytes ?? 0) / 1024 ** 2).toFixed(1)} MiB stored`}
									/>
									{capturedAt ? (
										<SettingsGroupRow
											label="Last capture"
											description={new Date(capturedAt).toLocaleString()}
										/>
									) : null}
								</SettingsGroup>
								<SettingsGroup
									title="Protected paths"
									meta={`${preferences.paths.length} paths`}
									action={
										<Button
											ref={addButton}
											testId="ignored-history-add-path"
											tokens={tokens}
											size="sm"
											variant="secondary"
											disabled={listLocked}
											onPress={() => edit("path")}
										>
											Add path…
										</Button>
									}
								>
									{preferences.paths.length ? (
										preferences.paths.map((path) => (
											<SettingsGroupRow
												key={path}
												testId={`ignored-history-path-${encodeURIComponent(path)}`}
												leading={<WorkspaceTabIcon name="shield" />}
												label={
													<text
														style={{
															...styles.label,
															fontFamily: codeTypography.fontFamily,
														}}
													>
														{path}
													</text>
												}
												trailing={
													<Button
														testId={`ignored-history-remove-${encodeURIComponent(path)}`}
														aria-label={`Remove ${path} from protected paths`}
														tokens={tokens}
														size="sm"
														variant="ghost"
														disabled={listLocked}
														textStyle={{ color: tokens.colors.danger }}
														onPress={() => {
															void save({
																...preferences,
																paths: preferences.paths.filter(
																	(item) => item !== path
																),
															});
														}}
													>
														Remove
													</Button>
												}
											/>
										))
									) : (
										<SettingsGroupEmpty>
											Add an ignored file or folder, such as .env or
											private-config/.
										</SettingsGroupEmpty>
									)}
								</SettingsGroup>
								<SettingsGroup
									title="History limits"
									action={
										<Button
											testId="ignored-history-edit-limits"
											tokens={tokens}
											size="sm"
											variant="secondary"
											disabled={listLocked}
											onPress={() => edit("limits")}
										>
											Edit
										</Button>
									}
								>
									<SettingsGroupRow
										label="Storage budget"
										trailing={
											<text
												style={styles.label}
											>{`${preferences.budgetBytes / 1024 ** 2} MiB`}</text>
										}
									/>
									<SettingsGroupRow
										label="Versions per file"
										trailing={
											<text style={styles.label}>
												{String(preferences.maxVersions)}
											</text>
										}
									/>
								</SettingsGroup>
								<text style={styles.description}>
									Stored only on this device, outside Git and AI context. Linked
									worktrees share settings and keep separate histories. Accepted
									baselines are kept separately. Use dedicated backup tools for
									live databases.
								</text>
								{snapshot?.skipped.length ? (
									<text
										style={styles.description}
									>{`${snapshot.skipped.length} paths skipped`}</text>
								) : null}
							</>
						)}
						{notice ? (
							<text role="status" style={styles.description}>
								{notice}
							</text>
						) : null}
						{!editing && (error || status?.error) ? (
							<text
								testId="ignored-history-error"
								role="alert"
								style={styles.error}
							>
								{error ?? status?.error}
							</text>
						) : null}
					</div>
				</SettingsPage>
			}
			panel={
				editing ? (
					<IgnoredHistoryEditor
						key={editing}
						ref={panel}
						kind={editing}
						repository={repository}
						preferences={preferences}
						locked={locked}
						error={error}
						run={run}
						onSave={save}
						onCancel={() => {
							if (pending.current) pending.current.abort();
							else cancelEditor();
						}}
					/>
				) : null
			}
		/>
	);
}

function IgnoredHistoryEditor({
	ref,
	kind,
	repository,
	preferences,
	locked,
	error,
	run,
	onSave,
	onCancel,
}: {
	ref: Ref<PublicInstance>;
	kind: HistoryEditor;
	repository: IgnoredRepository;
	preferences: IgnoredPreferences;
	locked: boolean;
	error?: string;
	run: RunHistoryAction;
	onSave: (value: IgnoredPreferences) => Promise<boolean>;
	onCancel: () => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const renderer = useGpuixRequired();
	const [paths, setPaths] = useState("");

	const [budget, setBudget] = useState(
		String(preferences.budgetBytes / 1024 ** 2)
	);

	const [versions, setVersions] = useState(String(preferences.maxVersions));

	const fieldStyle = {
		...styles.label,
		height: tokens.layout.controlHeight,
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: radius.md,
		backgroundColor: tokens.colors.field,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		flexShrink: 0,
	} as const;

	const browse = () =>
		void run(async (signal) => {
			if (!renderer.promptForPaths)
				throw new Error(
					"Enter a relative path; the file picker is unavailable."
				);

			const chosen = await renderer.promptForPaths({
				directories: true,
				files: true,
				multiple: true,
				prompt: "Monitor ignored files or folders",
			});

			if (!chosen || signal.aborted) return;

			const additions = chosen.map((path) => {
				const value = relative(repository.root, path);

				if (
					!value ||
					isAbsolute(value) ||
					value === ".." ||
					value.startsWith(`..${sep}`)
				)
					throw new Error("Choose files or folders inside this repository.");

				return value.split(sep).join("/");
			});

			setPaths((current) =>
				[
					...new Set([...current.split("\n").filter(Boolean), ...additions]),
				].join("\n")
			);
		});

	return (
		<SettingsPanel
			ref={ref}
			testId="ignored-history-editor"
			scrollTestId="ignored-history-editor-scroll"
			footerTestId="ignored-history-editor-footer"
			title={kind === "path" ? "Add protected path" : "History limits"}
			label={kind === "path" ? "Add protected path" : "Edit history limits"}
			body={
				kind === "path" ? (
					<>
						<div style={styles.header}>
							<text style={styles.label}>Repository-relative path</text>
							<Button
								testId="ignored-history-browse"
								tokens={tokens}
								variant="secondary"
								size="sm"
								disabled={locked}
								onPress={browse}
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
							minRows={3}
							maxRows={6}
							style={{ fontFamily: codeTypography.fontFamily }}
						/>
						<text style={styles.description}>
							One repository-relative path per line. Folders include future
							ignored files. Tracked files, Git metadata and links are excluded.
						</text>
					</>
				) : (
					<>
						<text style={styles.label}>Storage budget (MiB)</text>
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
						<text style={styles.label}>Versions per file</text>
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
						<text style={styles.description}>
							Use 1–102400 MiB and 2–100 versions per file. Accepted baselines
							are kept separately.
						</text>
					</>
				)
			}
			footer={
				<>
					{error ? (
						<text
							testId="ignored-history-error"
							role="alert"
							style={styles.error}
						>
							{error}
						</text>
					) : null}
					<div style={{ ...styles.header, justifyContent: "space-between" }}>
						<Button
							testId="ignored-history-cancel"
							tokens={tokens}
							size="sm"
							variant="secondary"
							onPress={onCancel}
						>
							Cancel
						</Button>
						<Button
							testId={
								kind === "path"
									? "ignored-history-add"
									: "ignored-history-save-limits"
							}
							tokens={tokens}
							size="sm"
							disabled={locked || (kind === "path" && !paths.trim())}
							onPress={() => {
								void onSave(
									kind === "path"
										? {
												...preferences,
												paths: [
													...new Set([
														...preferences.paths,
														...paths
															.split("\n")
															.map((path) => path.trim())
															.filter(Boolean),
													]),
												],
											}
										: {
												...preferences,
												budgetBytes: Number(budget) * 1024 ** 2,
												maxVersions: Number(versions),
											}
								);
							}}
						>
							{kind === "path" ? "Add" : "Save"}
						</Button>
					</div>
				</>
			}
		/>
	);
}
