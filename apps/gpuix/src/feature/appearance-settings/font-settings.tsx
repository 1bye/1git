import { useEffect, useMemo, useState } from "react";
import { Button } from "@1git/gpuix-ui/button";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@1git/gpuix-ui/select";
import { useGpuixRequired } from "@gpuix/react";
import { useAppTheme } from "../../styles/theme";
import { settingsStyles } from "../settings/settings-layout";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import { spacing } from "@1git/design-tokens";
import { defaultTypography } from "./app-typography";
import { InstalledFonts } from "./installed-fonts";
import { TextSizeSlider } from "./text-size-slider";

const systemFont = "__system-font__";

function FontPicker({
	id,
	label,
	value,
	families,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	families: readonly string[];
	onChange?: (value: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;

	const items = useMemo(
		() => [
			{ value: systemFont, label: "System font" },
			...[...new Set([...families, ...(value ? [value] : [])])].map(
				(family) => ({ value: family, label: family })
			),
		],
		[families, value]
	);

	return (
		<SettingsGroupRow
			testId={`${id}-row`}
			label={label}
			trailing={
				<Select
					value={value || systemFont}
					items={items}
					disabled={!onChange}
					onValueChange={(next) => {
						if (next) onChange?.(next === systemFont ? "" : next);
					}}
				>
					<SelectTrigger
						testId={id}
						aria-label={label}
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
					<SelectContent tokens={tokens} testId={`${id}-options`}>
						{items.map((item) => (
							<SelectItem
								key={item.value}
								value={item.value}
								testId={`${id}-${item.value}`}
								tokens={tokens}
							>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		/>
	);
}

/** Installed-font pickers and a live, bounded text-size slider. */
export function FontSettings() {
	const styles = settingsStyles.get(useAppTheme());

	const {
		tokens,
		typography: preferences = defaultTypography,
		setTypography,
	} = useAppTheme();

	const renderer = useGpuixRequired();
	const [families, setFamilies] = useState<readonly string[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		try {
			setFamilies(InstalledFonts.list(renderer));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not load installed fonts."
			);
		}
	}, [renderer]);

	return (
		<SettingsGroup
			title="Text"
			action={
				<Button
					testId="appearance-reset-fonts"
					tokens={tokens}
					variant="secondary"
					size="sm"
					disabled={!setTypography}
					onPress={() => setTypography?.(defaultTypography)}
				>
					Reset
				</Button>
			}
		>
			<SettingsGroupRow
				label="Font size"
				trailing={
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: spacing[1],
						}}
					>
						<TextSizeSlider
							width={100}
							value={preferences.fontSize}
							onChange={
								setTypography
									? (fontSize) => setTypography({ ...preferences, fontSize })
									: undefined
							}
						/>
						<text
							testId="appearance-font-size-value"
							style={styles.description}
						>{`${preferences.fontSize} pt`}</text>
					</div>
				}
			/>

			<FontPicker
				id="appearance-ui-font"
				label="Interface font"
				value={preferences.fontFamily}
				families={families}
				onChange={
					setTypography
						? (fontFamily) => setTypography({ ...preferences, fontFamily })
						: undefined
				}
			/>
			<FontPicker
				id="appearance-code-font"
				label="Code font"
				value={preferences.codeFontFamily}
				families={families}
				onChange={
					setTypography
						? (codeFontFamily) =>
								setTypography({ ...preferences, codeFontFamily })
						: undefined
				}
			/>
			{error ? (
				<text role="status" style={{ ...styles.description }}>
					{error}
				</text>
			) : null}
		</SettingsGroup>
	);
}
