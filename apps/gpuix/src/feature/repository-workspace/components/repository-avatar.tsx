import {
	createContext,
	use,
	useCallback,
	useEffect,
	useSyncExternalStore,
} from "react";
import { lightColors } from "@1git/design-tokens";
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
	size = 28,
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
				borderRadius: Math.min(6, size / 4),
				overflow: "hidden",
				pointerEvents: "none",
				backgroundColor: lightColors.editorSunken2,
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
						borderRadius: Math.min(6, size / 4),
						pointerEvents: "none",
					}}
				/>
			) : (
				<text
					testId={testId ? `${testId}-initial` : undefined}
					style={{
						fontSize: Math.max(9, size * 0.4),
						color: lightColors.editorMuted,
						pointerEvents: "none",
					}}
				>
					{label.trim()[0]?.toUpperCase() ?? "?"}
				</text>
			)}
		</div>
	);
}
