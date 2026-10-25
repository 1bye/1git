import { useEffect, useMemo, useState } from "react";
import { spacing, typography, fontWeight } from "@1git/design-tokens";
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
	const { tokens } = useAppTheme();

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
		<div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
			<text style={{ ...typography.sm, color: tokens.colors.text }}>
				{label}
			</text>
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
					style={{ width: 280 }}
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
		</div>
	);
}

/** Installed-font pickers and a live, bounded text-size slider. */
export function FontSettings() {
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
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[2],
				maxWidth: 480,
			}}
		>
			<text
				role="heading"
				aria-level={2}
				style={{
					...typography.md,
					fontWeight: fontWeight.medium,
					color: tokens.colors.text,
				}}
			>
				Text
			</text>
			<text
				style={{ ...typography.sm, color: tokens.colors.text }}
			>{`Text font size: ${preferences.fontSize} pt`}</text>
			<TextSizeSlider
				value={preferences.fontSize}
				onChange={
					setTypography
						? (fontSize) => setTypography({ ...preferences, fontSize })
						: undefined
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
				<text
					role="status"
					style={{ ...typography.sm, color: tokens.colors.textMuted }}
				>
					{error}
				</text>
			) : null}
			<Button
				testId="appearance-reset-fonts"
				tokens={tokens}
				variant="ghost"
				style={{ alignSelf: "flex-start" }}
				disabled={!setTypography}
				onPress={() => setTypography?.(defaultTypography)}
			>
				Reset text settings
			</Button>
		</div>
	);
}
