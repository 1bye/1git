import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	type SelectProps,
} from "@1git/gpuix-ui/select";
import { Text } from "@1git/gpuix-ui/text";
import { densities, palettes, type UiTokens } from "@1git/gpuix-ui/tokens";
import { useState } from "react";

const paletteNames = ["dark", "light"] as const;
const densityNames = ["comfortable", "compact"] as const;
const buttonVariants = ["primary", "secondary", "ghost"] as const;
const textSizes = ["lg", "md", "sm"] as const;
const textWeights = ["regular", "medium", "semibold"] as const;
const textTones = ["default", "muted", "danger"] as const;

const branches = [
	{ value: "main", label: "Main branch" },
	{ value: "develop", label: "Development" },
	{ value: "archived", label: "Archived", disabled: true },
];

const styles = StyleSheet.create({
	root: ({ colors, layout }: UiTokens) => ({
		display: "flex",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		overflowY: "scroll",
		backgroundColor: colors.background,
		padding: layout.pagePadding,
		gap: layout.sectionGap,
	}),
	stack: ({ layout }: UiTokens) => ({
		display: "flex",
		flexDirection: "column",
		flexShrink: 0,
		gap: layout.contentGap,
	}),
	row: ({ layout }: UiTokens) => ({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		flexShrink: 0,
		gap: layout.contentGap,
	}),
	panels: ({ layout }: UiTokens) => ({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "start",
		flexShrink: 0,
		gap: layout.contentGap,
	}),
	panel: ({ colors, layout }: UiTokens) => ({
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		flexBasis: 260,
		minWidth: 240,
		padding: layout.controlPadding,
		gap: layout.contentGap,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 8,
		backgroundColor: colors.field,
	}),
});

type BranchSelectProps = Pick<
	SelectProps,
	"value" | "onValueChange" | "disabled"
> & {
	tokens: UiTokens;
	testId: string;
	label: string;
};

function BranchSelect({ tokens, testId, label, ...props }: BranchSelectProps) {
	return (
		<Select {...props} items={branches}>
			<SelectTrigger tokens={tokens} testId={testId} aria-label={label}>
				<SelectValue tokens={tokens} placeholder="Choose a branch" />
			</SelectTrigger>
			<SelectContent tokens={tokens} testId={`${testId}-content`}>
				{branches.map((branch) => (
					<SelectItem
						key={branch.value}
						tokens={tokens}
						value={branch.value}
						disabled={branch.disabled}
						testId={`${testId}-${branch.value}`}
					>
						{branch.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Standalone playground for every public control and independent token selections. */
export function ExampleApp() {
	const [palette, setPalette] = useState<keyof typeof palettes>("dark");
	const [density, setDensity] = useState<keyof typeof densities>("comfortable");
	const [presses, setPresses] = useState(0);
	const [branch, setBranch] = useState("main");

	const tokens: UiTokens = {
		colors: palettes[palette],
		layout: densities[density],
	};

	const onPress = () => setPresses((count) => count + 1);

	return (
		<div testId="playground" style={styles.root(tokens)}>
			<div style={styles.stack(tokens)}>
				<Text tokens={tokens} size="lg" weight="semibold">
					GPUIX UI
				</Text>
				<Text tokens={tokens} tone="muted">
					Component playground · live design tokens
				</Text>
			</div>
			<div style={styles.panels(tokens)}>
				<div style={styles.stack(tokens)}>
					<Text tokens={tokens} weight="medium">
						Palette
					</Text>
					<div style={styles.row(tokens)}>
						{paletteNames.map((name) => (
							<Button
								key={name}
								tokens={tokens}
								testId={`palette-${name}`}
								aria-label={`Use ${name} palette`}
								variant={palette === name ? "primary" : "secondary"}
								onPress={() => setPalette(name)}
							>
								{name}
							</Button>
						))}
					</div>
				</div>
				<div style={styles.stack(tokens)}>
					<Text tokens={tokens} weight="medium">
						Density
					</Text>
					<div style={styles.row(tokens)}>
						{densityNames.map((name) => (
							<Button
								key={name}
								tokens={tokens}
								testId={`density-${name}`}
								aria-label={`Use ${name} density`}
								variant={density === name ? "primary" : "secondary"}
								onPress={() => setDensity(name)}
							>
								{name}
							</Button>
						))}
					</div>
				</div>
			</div>
			<Text tokens={tokens} testId="token-selection" tone="muted" size="sm">
				Palette: {palette} · Density: {density} · Control height:{" "}
				{tokens.layout.controlHeight}px
			</Text>
			<div style={styles.panels(tokens)}>
				<div style={styles.panel(tokens)}>
					<Text tokens={tokens} weight="semibold">
						Button
					</Text>
					<Text tokens={tokens} tone="muted" size="sm">
						Variants · medium and small
					</Text>
					{buttonVariants.map((variant) => (
						<div key={variant} style={styles.row(tokens)}>
							<Button
								tokens={tokens}
								variant={variant}
								testId={`button-${variant}-md`}
								onPress={onPress}
							>
								{variant}
							</Button>
							<Button
								tokens={tokens}
								variant={variant}
								size="sm"
								testId={`button-${variant}-sm`}
								onPress={onPress}
							>
								{variant} sm
							</Button>
						</div>
					))}
					<div style={styles.row(tokens)}>
						<Button
							tokens={tokens}
							testId="button-disabled"
							disabled
							onPress={onPress}
						>
							Disabled
						</Button>
						<Button
							tokens={tokens}
							testId="reset-count"
							variant="ghost"
							onPress={() => setPresses(0)}
						>
							Reset count
						</Button>
					</div>
					<Text tokens={tokens} testId="press-count" tone="muted" size="sm">
						Activated {presses} times
					</Text>
				</div>
				<div style={styles.panel(tokens)}>
					<Text tokens={tokens} weight="semibold">
						Text
					</Text>
					{textSizes.map((size) => (
						<Text key={size} tokens={tokens} size={size}>
							Size: {size}
						</Text>
					))}
					{textWeights.map((weight) => (
						<Text key={weight} tokens={tokens} weight={weight}>
							Weight: {weight}
						</Text>
					))}
					{textTones.map((tone) => (
						<Text key={tone} tokens={tokens} tone={tone}>
							Tone: {tone}
						</Text>
					))}
				</div>
				<div style={styles.panel(tokens)}>
					<Text tokens={tokens} weight="semibold">
						Select
					</Text>
					<Text tokens={tokens} tone="muted" size="sm">
						Controlled
					</Text>
					<BranchSelect
						tokens={tokens}
						testId="branch-select"
						label="Branch"
						value={branch}
						onValueChange={setBranch}
					/>
					<Text tokens={tokens} testId="branch-selection" size="sm">
						Selected: {branch}
					</Text>
					<Text tokens={tokens} tone="muted" size="sm">
						Uncontrolled · placeholder
					</Text>
					<BranchSelect
						tokens={tokens}
						testId="uncontrolled-select"
						label="Optional branch"
					/>
					<Text tokens={tokens} tone="muted" size="sm">
						Disabled
					</Text>
					<BranchSelect
						tokens={tokens}
						testId="disabled-select"
						label="Unavailable branch"
						value="main"
						disabled
					/>
				</div>
			</div>
			<Text tokens={tokens} tone="muted" size="sm">
				Tab / Shift+Tab to focus · Enter / Space to activate · Arrow keys in
				Select · Escape to close
			</Text>
		</div>
	);
}
