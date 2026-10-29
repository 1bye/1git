import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@1git/gpuix-ui/select";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { useAppTheme } from "../../styles/theme";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import {
	defaultGrainSettings,
	grainPatterns,
	grainStrengths,
	GrainPreferences,
} from "./grain-settings";

/** Immediate, keyboard-accessible grain choices; disabling grain retains the selected style. */
export function GrainControls() {
	const {
		tokens,
		showGrain = true,
		setShowGrain,
		grainSettings = defaultGrainSettings,
		setGrainSettings,
	} = useAppTheme();

	return (
		<SettingsGroup title="Grain texture">
			<SettingsGroupRow
				label="Show grain"
				description="Add a subtle noise texture to window chrome."
				trailing={
					<Checkbox
						testId="appearance-grain"
						aria-label="Grain texture"
						checked={showGrain}
						onCheckedChange={(enabled) => setShowGrain?.(enabled)}
						disabled={!setShowGrain}
						tokens={tokens}
					/>
				}
			/>
			{(
				[
					{ key: "pattern", label: "Pattern", items: grainPatterns },
					{ key: "strength", label: "Strength", items: grainStrengths },
				] as const
			).map(({ key, label, items }) => (
				<SettingsGroupRow
					key={key}
					label={label}
					trailing={
						<Select
							value={grainSettings[key]}
							items={items}
							disabled={!showGrain || !setGrainSettings}
							onValueChange={(value) => {
								if (value)
									setGrainSettings?.(
										GrainPreferences.parse({ ...grainSettings, [key]: value })
									);
							}}
						>
							<SelectTrigger
								testId={`appearance-grain-${key}`}
								aria-label={`Grain ${label.toLowerCase()}`}
								tokens={tokens}
								style={{ width: 140 }}
							>
								<SelectValue tokens={tokens} />
								<svg
									aria-hidden
									source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
									style={{
										width: 12,
										height: 12,
										color: tokens.colors.textMuted,
										pointerEvents: "none",
									}}
								/>
							</SelectTrigger>
							<SelectContent
								tokens={tokens}
								testId={`appearance-grain-${key}-options`}
							>
								{items.map((item) => (
									<SelectItem
										key={item.value}
										value={item.value}
										testId={`appearance-grain-${key}-${item.value}`}
										tokens={tokens}
									>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					}
				/>
			))}
		</SettingsGroup>
	);
}
