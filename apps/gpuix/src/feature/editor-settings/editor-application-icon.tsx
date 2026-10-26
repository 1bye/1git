import { useEffect, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
import { ApplicationIcons } from "./application-icons";
import { radius, spacing } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { settingsStyles } from "../settings/settings-layout";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import type { EditorApplication } from "./external-editors";

// Bundled glyphs remain available when a native icon cannot be read.
const glyphs: Readonly<Record<string, { paths: string; color?: string }>> = {
	"zed.app": { paths: '<path d="M4 5h16L4 19h16M4 10V5m16 9v5"/>' },
	"visual studio code.app": {
		paths:
			'<path d="m16 3 5 2v14l-5 2V3Zm0 3L3 16l-2-2L16 6Zm0 12L3 8 1 10l15 8Z"/>',
		color: "#2499e5",
	},
	"visual studio code - insiders.app": {
		paths:
			'<path d="m16 3 5 2v14l-5 2V3Zm0 3L3 16l-2-2L16 6Zm0 12L3 8 1 10l15 8Z"/>',
		color: "#22a886",
	},
	"cursor.app": { paths: '<path d="m5 3 15 10-8 1-4 7Z"/>' },
	"vscodium.app": {
		paths: '<path d="M8 4 2 12l6 8m8-16 6 8-6 8m-3-17-2 18"/>',
		color: "#36a3ac",
	},
	"sublime text.app": {
		paths: '<path d="m20 4-16 5 16 6-16 5M4 9V5l16-2m0 12v4L4 22"/>',
		color: "#df923d",
	},
	"nova.app": {
		paths: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
		color: "#a478ef",
	},
	"bbedit.app": {
		paths:
			'<path d="M4 3v18h7a5 5 0 0 0 0-10H4m0-8h6a4 4 0 0 1 0 8m6-6 5 3-5 3m0 3 5 3-5 3"/>',
		color: "#528bff",
	},
	"textmate.app": {
		paths:
			'<circle cx="12" cy="7" r="4"/><circle cx="17" cy="12" r="4"/><circle cx="12" cy="17" r="4"/><circle cx="7" cy="12" r="4"/>',
		color: "#ab73c9",
	},
};

/** Real installed application icons, with bundled glyphs and monograms as fallbacks. */
export function EditorApplicationIcon({
	application,
	testId,
}: {
	application?: EditorApplication;
	testId?: string;
}) {
	const theme = useAppTheme();
	const renderer = useGpuixRequired();
	const path = application?.available ? application.path : undefined;
	const revision = application?.iconRevision;

	const [icon, setIcon] = useState<{
		path: string;
		revision?: string;
		source: string;
	}>();

	useEffect(() => {
		const source = path
			? ApplicationIcons.load(renderer, path, revision)
			: undefined;

		setIcon(path && source ? { path, revision, source } : undefined);
	}, [renderer, path, revision]);
	const source =
		icon?.path === path && icon?.revision === revision
			? icon?.source
			: undefined;

	const glyph = application
		? glyphs[application.path.split("/").at(-1)?.toLowerCase() ?? ""]
		: undefined;

	return (
		<div
			testId={testId}
			aria-hidden
			style={{
				width: 28,
				height: 28,
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: source ? undefined : theme.tokens.colors.surface,
				borderRadius: radius.lg,
				padding: source ? 0 : spacing[1],
				pointerEvents: "none",
			}}
		>
			{source ? (
				<img
					testId={testId ? `${testId}-image` : undefined}
					src={source}
					alt=""
					objectFit="contain"
					style={{ width: 28, height: 28, pointerEvents: "none" }}
				/>
			) : !application ? (
				<WorkspaceTabIcon name="pencil" size={18} />
			) : glyph ? (
				<svg
					source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph.paths}</svg>`}
					style={{
						width: 20,
						height: 20,
						color: glyph.color ?? theme.tokens.colors.text,
					}}
				/>
			) : (
				<text style={settingsStyles.get(theme).sectionTitle}>
					{Array.from(application.name.trim())[0]?.toUpperCase() ?? "?"}
				</text>
			)}
		</div>
	);
}
