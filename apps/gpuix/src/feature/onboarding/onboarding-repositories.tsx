import { useState } from "react";
import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import type { useRepositoryDiscovery } from "../repository-discovery/use-repository-discovery";

import { RepositoryWelcomeList } from "../repository-workspace/components/repository-welcome-list";

const emptyPaths: ReadonlySet<string> = new Set();

/** Local discovery suggestions use the normal opening flow without saving unopened paths. */
export function OnboardingRepositories({
	discovery,
	busy,
	onOpen,
}: {
	discovery: ReturnType<typeof useRepositoryDiscovery>;
	busy: boolean;
	onOpen: (path: string) => void;
}) {
	const { tokens } = useAppTheme();
	const [query, setQuery] = useState("");
	const [searchFocused, setSearchFocused] = useState(false);
	const { paths, status, error } = discovery;
	const scanning = status === "scanning";
	const normalizedQuery = query.trim().toLowerCase();

	const matches = normalizedQuery
		? paths.filter((path) => path.toLowerCase().includes(normalizedQuery))
		: paths;

	const noMatches = normalizedQuery.length > 0 && matches.length === 0;
	const muted = { ...typography.sm, color: tokens.colors.textMuted };
	let message: string | undefined;

	if (error) message = error;
	else if (noMatches) message = "No repositories match your search.";
	else if (status === "stopped")
		message = "Search stopped. You can open any repository already found.";
	else if (!paths.length)
		message = "No repositories found. Use Open from disk to browse for one.";

	return (
		<div
			testId="onboarding-discovery"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[2],
				flexGrow: 1,
				flexBasis: 0,
				minHeight: 0,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					flexShrink: 0,
				}}
			>
				<text
					role="heading"
					aria-level={2}
					style={{ ...typography.sm, fontWeight: fontWeight.medium }}
				>
					{`Repositories on this Mac (${matches.length})`}
				</text>
				<Button
					testId="onboarding-discovery-scan"
					tokens={tokens}
					variant="ghost"
					size="sm"
					disabled={busy}
					aria-label={
						scanning ? "Stop searching for repositories" : "Scan again"
					}
					aria-description={scanning ? "Searching your home folder" : undefined}
					onPress={() => (scanning ? discovery.stop() : discovery.rescan())}
				>
					{scanning ? "Searching… · Stop" : "Scan again"}
				</Button>
			</div>
			<input
				testId="onboarding-repository-search"
				aria-label="Search repositories by name or path"
				placeholder="Search repositories…"
				tabIndex={0}
				value={query}
				onChange={(event) => setQuery(event.value ?? "")}
				onFocus={() => setSearchFocused(true)}
				onBlur={() => setSearchFocused(false)}
				style={{
					...typography.md,
					height: 34,
					flexShrink: 0,
					paddingLeft: spacing[3],
					paddingRight: spacing[3],
					color: tokens.colors.text,
					backgroundColor: tokens.colors.field,
					borderWidth: 1,
					borderColor: searchFocused
						? tokens.colors.focusRing
						: tokens.colors.border,
					borderRadius: radius.md,
				}}
			/>
			{message && (!scanning || noMatches) ? (
				<text
					testId="onboarding-discovery-status"
					role={error ? "alert" : "status"}
					style={{ ...muted, whiteSpace: "normal", flexShrink: 0 }}
				>
					{message}
				</text>
			) : null}
			{matches.length ? (
				<div
					testId="onboarding-discovery-list"
					role="group"
					aria-label="Repositories found on this Mac"
					style={{
						display: "flex",
						flexDirection: "column",
						flexGrow: 1,
						flexBasis: 0,
						minHeight: 0,
					}}
				>
					<RepositoryWelcomeList
						key={normalizedQuery}
						testIdPrefix="onboarding-"
						paths={matches}
						saved={emptyPaths}
						starred={emptyPaths}
						busy={busy}
						onOpen={onOpen}
						layout="list"
					/>
				</div>
			) : null}
		</div>
	);
}
