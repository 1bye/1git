import { lightColors, radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useState } from "react";
import { appTokens } from "../../../styles/tokens";
import type { DiffSettings } from "../lib/repository-diff";

const settingsIcon =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h2m4 0h6M2 11h6m4 0h2"/><circle cx="6" cy="5" r="2"/><circle cx="10" cy="11" r="2"/></svg>';

/** Compact text-preview controls; native popover owns dismissal and focus restoration. */
export function RepositoryDiffSettings({
	settings,
	onChange,
}: {
	settings: DiffSettings;
	onChange: (settings: DiffSettings) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger
						testId="diff-settings"
						aria-label="Diff settings"
						tokens={appTokens}
						size="sm"
						variant="ghost"
						style={{ width: 28, height: 28, padding: 0 }}
					>
						<svg
							testId="diff-settings-icon"
							source={settingsIcon}
							style={{
								width: 16,
								height: 16,
								color: lightColors.editorMuted,
								pointerEvents: "none",
							}}
						/>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent
					tokens={appTokens}
					testId="diff-settings-tooltip"
					side="bottom"
				>
					Diff settings
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				testId="diff-settings-panel"
				aria-label="Diff settings"
				side="bottom"
				align="end"
				width={270}
				tokens={appTokens}
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
				>
					<text style={{ ...typography.sm, color: lightColors.editorInk }}>
						Diff layout
					</text>
					<div
						role="group"
						aria-label="Diff layout"
						style={{
							display: "flex",
							flexDirection: "row",
							gap: spacing[1],
							padding: spacing[1],
							borderRadius: radius.md,
							backgroundColor: lightColors.editorSunken,
						}}
					>
						{(["unified", "split"] as const).map((mode) => (
							<Button
								key={mode}
								testId={`diff-mode-${mode}`}
								tokens={appTokens}
								size="sm"
								variant="ghost"
								aria-label={`${mode === "unified" ? "Unified" : "Split"}${settings.mode === mode ? ", selected" : ""}`}
								style={{
									flexGrow: 1,
									backgroundColor:
										settings.mode === mode
											? lightColors.editorSurface
											: "transparent",
								}}
								onPress={() => onChange({ ...settings, mode })}
							>
								{mode === "unified" ? "Unified" : "Split"}
							</Button>
						))}
					</div>
					{settings.mode === "split" ? (
						<>
							<text style={{ ...typography.sm, color: lightColors.editorInk }}>
								Split layout
							</text>
							<div
								role="group"
								aria-label="Split layout"
								style={{
									display: "flex",
									flexDirection: "row",
									gap: spacing[1],
									padding: spacing[1],
									borderRadius: radius.md,
									backgroundColor: lightColors.editorSunken,
								}}
							>
								{(["fixed", "content-sized"] as const).map((splitLayout) => (
									<Button
										key={splitLayout}
										testId={`diff-split-${splitLayout}`}
										tokens={appTokens}
										size="sm"
										variant="ghost"
										aria-label={`${splitLayout === "fixed" ? "Fixed 50/50" : "Content-sized"}${settings.splitLayout === splitLayout ? ", selected" : ""}`}
										style={{
											flexGrow: 1,
											backgroundColor:
												settings.splitLayout === splitLayout
													? lightColors.editorSurface
													: "transparent",
										}}
										onPress={() => onChange({ ...settings, splitLayout })}
									>
										{splitLayout === "fixed" ? "Fixed 50/50" : "Content-sized"}
									</Button>
								))}
							</div>
						</>
					) : null}
					<Checkbox
						testId="diff-hide-whitespace"
						label="Hide whitespace changes"
						checked={settings.ignoreWhitespace}
						onCheckedChange={(ignoreWhitespace) =>
							onChange({ ...settings, ignoreWhitespace })
						}
						tokens={appTokens}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
