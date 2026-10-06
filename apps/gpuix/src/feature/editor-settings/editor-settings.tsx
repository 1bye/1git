import { fontWeight, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";
import { appTokens } from "../../styles/tokens";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { ExternalEditors } from "./external-editors";

/** Immediately saved app-wide editor choices; the native picker never launches the selected app. */
export function EditorSettings({
	editors: supplied,
	onBusy,
}: {
	editors?: ExternalEditors;
	onBusy: (busy: boolean) => void;
}) {
	const renderer = useGpuixRequired();
	const [editors] = useState(() => supplied ?? new ExternalEditors());

	const [options, setOptions] =
		useState<Awaited<ReturnType<ExternalEditors["options"]>>>();

	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const mounted = useRef(false);

	useEffect(() => {
		mounted.current = true;
		void (async () => {
			try {
				const next = await editors.options();

				if (mounted.current) setOptions(next);
			} catch (cause) {
				if (mounted.current)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not load editor settings."
					);
			}
		})();

		return () => {
			mounted.current = false;
		};
	}, [editors]);

	const choose = async (path: string | null | undefined) => {
		if (pending.current || !options) return;

		pending.current = true;
		setBusy(true);
		onBusy(true);
		setError(undefined);

		try {
			if (path === undefined) {
				if (!renderer.promptForPaths)
					throw new Error("Application selection is unavailable.");

				const paths = await renderer.promptForPaths({
					files: true,
					directories: false,
					multiple: false,
					prompt: "Choose editor application",
				});

				if (!mounted.current || !paths?.[0]) return;

				path = paths[0];
			}

			const application = await editors.save(path);

			if (mounted.current)
				setOptions((previous) => {
					const applications = (previous?.applications ?? [])
						.filter((item) => item.available || item.path === application?.path)
						.map((item) =>
							application && application.path === item.path ? application : item
						);

					if (
						application &&
						!applications.some((item) => item.path === application.path)
					)
						applications.push(application);

					return { selected: application?.path ?? null, applications };
				});
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not save the editor preference."
				);
		} finally {
			pending.current = false;
			onBusy(false);

			if (mounted.current) setBusy(false);
		}
	};

	const choices = [
		{ path: null, name: "System default", available: true },
		...(options?.applications ?? []),
	];

	return (
		<div
			testId="editor-settings"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					maxWidth: 512,
					padding: spacing[4],
					gap: spacing[3],
					flexShrink: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						gap: spacing[3],
					}}
				>
					<text
						role="heading"
						aria-level={1}
						style={{
							...typography.lg,
							fontWeight: fontWeight.medium,
							color: appTokens.colors.text,
						}}
					>
						External editor
					</text>
					<Button
						testId="editor-choose-application"
						tokens={appTokens}
						variant="secondary"
						size="sm"
						disabled={busy || !options}
						onPress={() => {
							void choose(undefined);
						}}
					>
						Choose application…
					</Button>
				</div>
				<text style={{ ...typography.sm, color: appTokens.colors.textMuted }}>
					Used for Open in Editor.
				</text>
				<div
					role="group"
					aria-label="External editor"
					style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}
				>
					{choices.map((application, index) => (
						<Button
							key={application.path ?? "system"}
							testId={`editor-choice-${index}`}
							aria-label={application.name}
							aria-description={
								options?.selected === application.path
									? "Selected editor"
									: undefined
							}
							tokens={appTokens}
							variant={
								options?.selected === application.path ? "secondary" : "ghost"
							}
							size="sm"
							disabled={busy || !options || !application.available}
							onPress={() => {
								void choose(application.path);
							}}
							style={{ justifyContent: "flex-start" }}
						>
							<text
								style={{
									...typography.md,
									color: appTokens.colors.text,
									flexGrow: 1,
									minWidth: 0,
									whiteSpace: "nowrap",
									textOverflow: "ellipsis",
									pointerEvents: "none",
								}}
							>
								{application.name}
							</text>
							{!application.available ? (
								<text
									style={{
										...typography.xs,
										color: appTokens.colors.textMuted,
									}}
								>
									Unavailable
								</text>
							) : null}
							{options?.selected === application.path ? (
								<WorkspaceTabIcon
									name="check"
									color={appTokens.colors.accent}
								/>
							) : null}
						</Button>
					))}
				</div>
				{error ? (
					<text
						testId="editor-settings-error"
						role="alert"
						style={{ ...typography.sm, color: appTokens.colors.danger }}
					>
						{error}
					</text>
				) : null}
			</div>
		</div>
	);
}
