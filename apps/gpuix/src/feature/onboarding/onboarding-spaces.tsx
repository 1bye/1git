import { basename } from "node:path";
import { Button } from "@1git/gpuix-ui/button";
import { radius, spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { SpaceSymbol } from "../spaces/space-symbol";
import type { WorkspaceSpace } from "../spaces/workspace-spaces";

/** One-click starter spaces; each is offered only while no space shares its name. */
const spacePresets = [
	{ name: "Work", icon: "work" },
	{ name: "Personal", icon: "home" },
] as const;

/** Placeholder tab widths, varied per space so a switch visibly changes the window. */
const placeholderTabs = [
	[88, 64, 112],
	[72, 120],
	[104, 56, 80],
	[64, 96, 72],
] as const;

const maxSpaces = 50;
const previewTabs = 3;

export type SpacePreset = (typeof spacePresets)[number];

/** Optional space setup with a static preview and management controls. */
export function OnboardingSpaces({
	spaces,
	activeId,
	disabled,
	onCreate,
	onCreatePreset,
	onEdit,
}: {
	spaces: readonly WorkspaceSpace[];
	activeId: string;
	disabled: boolean;
	onCreate: () => void;
	onCreatePreset: (preset: SpacePreset) => void;
	onEdit: (space: WorkspaceSpace) => void;
}) {
	const { tokens } = useAppTheme();
	const activeIndex = spaces.findIndex((space) => space.id === activeId);
	const active = spaces[activeIndex];
	const full = spaces.length >= maxSpaces;

	const presets = spacePresets.filter(
		(preset) =>
			!spaces.some(
				(space) => space.name.trim().toLowerCase() === preset.name.toLowerCase()
			)
	);

	const muted = {
		...typography.sm,
		color: tokens.colors.textMuted,
		whiteSpace: "normal" as const,
	};

	const tabs = active?.repositories.length
		? active.repositories.slice(0, previewTabs).map((path) => basename(path))
		: [];

	const placeholderWidths =
		placeholderTabs[Math.max(activeIndex, 0) % placeholderTabs.length] ??
		placeholderTabs[0];

	return (
		<div
			testId="onboarding-spaces"
			style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
		>
			<text style={muted}>
				Spaces keep separate sets of repositories and tabs, like Work and
				Personal.
			</text>
			<div
				testId="onboarding-space-illustration"
				role="group"
				aria-label="Space preview"
				style={{
					display: "flex",
					flexDirection: "row",
					minHeight: 112,
					flexShrink: 0,
					borderWidth: 1,
					borderColor: tokens.colors.border,
					borderRadius: radius.xl,
					overflow: "hidden",
				}}
			>
				<div
					testId="onboarding-practice-rail"
					aria-hidden
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						width: 56,
						flexShrink: 0,
						paddingTop: spacing[2],
						gap: spacing[1],
						backgroundColor: tokens.colors.surface,
						borderRightWidth: 1,
						borderColor: tokens.colors.border,
					}}
				>
					{spaces.slice(0, 4).map((space) => (
						<div
							key={space.id}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 36,
								height: 32,
								borderRadius: radius.lg,
								borderWidth: 1,
								borderColor:
									space.id === activeId ? tokens.colors.border : "transparent",
								backgroundColor:
									space.id === activeId ? tokens.colors.field : "transparent",
							}}
						>
							<SpaceSymbol icon={space.icon} />
						</div>
					))}
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flexGrow: 1,
						minWidth: 0,
						overflow: "hidden",
					}}
				>
					<div
						key={activeId}
						style={{
							position: "relative",
							display: "flex",
							flexDirection: "column",
							flexGrow: 1,
							padding: spacing[3],
							gap: spacing[2],
						}}
					>
						<div
							aria-hidden
							style={{ display: "flex", flexDirection: "row", gap: spacing[1] }}
						>
							{tabs.length
								? tabs.map((name) => (
										<text
											key={name}
											style={{
												...typography.sm,
												color: tokens.colors.textMuted,
												paddingLeft: spacing[2],
												paddingRight: spacing[2],
												paddingTop: spacing[1],
												paddingBottom: spacing[1],
												borderRadius: radius.md,
												backgroundColor: tokens.colors.surface,
												whiteSpace: "nowrap",
												textOverflow: "ellipsis",
												flexShrink: 1,
												minWidth: 0,
											}}
										>
											{name}
										</text>
									))
								: placeholderWidths.map((width, index) => (
										<div
											// oxlint-disable-next-line react/no-array-index-key -- static placeholder geometry
											key={index}
											style={{
												width,
												height: 20,
												flexShrink: 1,
												borderRadius: radius.md,
												backgroundColor: tokens.colors.surface,
											}}
										/>
									))}
						</div>
						<text
							testId="onboarding-space-preview"
							role="status"
							style={{
								...typography.md,
								color: tokens.colors.text,
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{active?.name ?? ""}
						</text>
						<text style={muted}>You’ll learn how to switch after setup.</text>
					</div>
				</div>
			</div>
			<div
				role="group"
				aria-label="Your spaces"
				style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}
			>
				{spaces.map((space) => (
					<Button
						key={space.id}
						tokens={tokens}
						size="sm"
						variant="ghost"
						testId={`onboarding-space-edit-${space.id}`}
						aria-label={`Edit ${space.name}`}
						aria-description="Change name and icon"
						disabled={disabled}
						style={{ justifyContent: "start", minWidth: 0 }}
						onPress={() => onEdit(space)}
					>
						<SpaceSymbol icon={space.icon} />
						<text
							style={{
								...typography.sm,
								color: tokens.colors.text,
								flexGrow: 1,
								flexShrink: 1,
								minWidth: 0,
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{space.name}
						</text>
						<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
							{space.id === activeId ? "Current · Edit…" : "Edit…"}
						</text>
					</Button>
				))}
			</div>
			<div
				role="group"
				aria-label="Add a space"
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					gap: spacing[2],
				}}
			>
				{presets.map((preset) => (
					<Button
						key={preset.name}
						tokens={tokens}
						size="sm"
						variant="secondary"
						testId={`onboarding-space-preset-${preset.icon}`}
						aria-label={`Add ${preset.name} space`}
						disabled={disabled || full}
						onPress={() => onCreatePreset(preset)}
					>
						<SpaceSymbol icon={preset.icon} />
						<text style={{ ...typography.sm, color: tokens.colors.text }}>
							{`+ ${preset.name}`}
						</text>
					</Button>
				))}
				<Button
					tokens={tokens}
					size="sm"
					variant={presets.length ? "ghost" : "secondary"}
					testId="onboarding-space-create"
					disabled={disabled || full}
					onPress={onCreate}
				>
					{presets.length ? "Custom…" : "New space…"}
				</Button>
			</div>
		</div>
	);
}
