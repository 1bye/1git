import { useAppTheme } from "../../../styles/theme";
import {
	createContext,
	use,
	useCallback,
	useEffect,
	useSyncExternalStore,
} from "react";
import { controlSize, radius, typography } from "@1git/design-tokens";
import {
	RepositoryAvatars,
	type RepositoryAvatarSource,
} from "../lib/repository-avatars";

/** Shared cache supplied at the window boundary; isolated components default to initials without I/O. */
export const RepositoryAvatarContext = createContext<RepositoryAvatars | null>(
	null
);

/** Fixed-size decorative thumbnail. Labels remain accessible while artwork loads or fails. */
export function RepositoryAvatar({
	label,
	source,
	size = controlSize.md,
	testId,
	deferred = false,
}: {
	label: string;
	source?: RepositoryAvatarSource;
	size?: number;
	testId?: string;
	/** Virtual lists start requests from their visible-range callback, not every mounted row. */
	deferred?: boolean;
}) {
	const theme = useAppTheme();
	const { colors: appColors } = theme;

	const avatars = use(RepositoryAvatarContext);
	const path = source && "path" in source ? source.path : undefined;
	const remote = source && "remote" in source ? source.remote : undefined;
	const avatarUrl = source && "remote" in source ? source.avatarUrl : undefined;
	const key = path ? `path:${path}` : remote ? `remote:${remote}` : "";

	const subscribe = useCallback(
		(listener: () => void) => avatars?.subscribe(key, listener) ?? (() => {}),
		[avatars, key]
	);

	const snapshot = useCallback(
		() => avatars?.read(key) ?? null,
		[avatars, key]
	);

	const src = useSyncExternalStore(subscribe, snapshot);

	useEffect(() => {
		if (!avatars || deferred) return;

		if (path) void avatars.load({ path });
		else if (remote) void avatars.load({ remote, avatarUrl });
	}, [avatars, deferred, path, remote, avatarUrl]);

	return (
		<div
			testId={testId}
			aria-hidden
			style={{
				position: "relative",
				width: size,
				height: size,
				flexShrink: 0,
				borderRadius: Math.min(radius.md, size / 4),
				overflow: "hidden",
				pointerEvents: "none",
				backgroundColor: appColors.editorSunken2,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{src ? (
				<img
					testId={testId ? `${testId}-image` : undefined}
					src={src}
					alt=""
					objectFit="cover"
					style={{
						width: size,
						height: size,
						borderRadius: Math.min(radius.md, size / 4),
						pointerEvents: "none",
					}}
				/>
			) : (
				<text
					testId={testId ? `${testId}-initial` : undefined}
					style={{
						// Initials scale with arbitrary thumbnail sizes, including tiny tabs.
						fontSize: Math.max(typography["2xs"].fontSize, size * 0.4),
						color: appColors.editorMuted,
						pointerEvents: "none",
					}}
				>
					{label.trim()[0]?.toUpperCase() ?? "?"}
				</text>
			)}
		</div>
	);
}
