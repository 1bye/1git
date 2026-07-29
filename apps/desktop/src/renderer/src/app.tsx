import { Badge } from "@1git/ui/components/badge";
import { Button } from "@1git/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@1git/ui/components/card";
import { Input } from "@1git/ui/components/input";
import { cn } from "@1git/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
	Activity,
	ArrowUpRight,
	BookOpen,
	Box,
	ChevronRight,
	Clock3,
	Command,
	GitBranch,
	Github,
	LayoutDashboard,
	Plus,
	Search,
	Settings,
	Sparkles,
} from "lucide-react";
import type { ChangeEvent, ReactElement } from "react";
import { useState } from "react";

type ViewId = "activity" | "overview" | "repositories";

interface NavigationItem {
	readonly icon: LucideIcon;
	readonly id: ViewId;
	readonly label: string;
}

interface Repository {
	readonly branch: string;
	readonly description: string;
	readonly language: string;
	readonly name: string;
	readonly updated: string;
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
	{ icon: LayoutDashboard, id: "overview", label: "Overview" },
	{ icon: Box, id: "repositories", label: "Repositories" },
	{ icon: Activity, id: "activity", label: "Activity" },
];

const REPOSITORIES: readonly Repository[] = [
	{
		branch: "main",
		description: "Desktop-first workspace for focused development.",
		language: "TypeScript",
		name: "1git",
		updated: "2 min ago",
	},
	{
		branch: "main",
		description: "Shared design primitives and application components.",
		language: "TypeScript",
		name: "design-system",
		updated: "Yesterday",
	},
	{
		branch: "develop",
		description: "Experiments, prototypes, and product directions.",
		language: "React",
		name: "playground",
		updated: "3 days ago",
	},
];

const ACTIVITY_ITEMS = [
	{
		description: "Added the Electron desktop workspace",
		label: "Project initialized",
		time: "Just now",
	},
	{
		description: "Connected Tailwind and shared shadcn components",
		label: "UI package ready",
		time: "4 min ago",
	},
	{
		description: "Updated repository tooling and type checks",
		label: "Workspace configured",
		time: "9 min ago",
	},
] as const;

const PAGE_COPY: Record<ViewId, { description: string; title: string }> = {
	activity: {
		description: "A clear timeline of work across your local projects.",
		title: "Activity",
	},
	overview: {
		description: "Everything important across your repositories, at a glance.",
		title: "Good afternoon",
	},
	repositories: {
		description: "Browse and continue work in your local repositories.",
		title: "Repositories",
	},
};

const Sidebar = ({
	activeView,
	onNavigate,
}: {
	readonly activeView: ViewId;
	readonly onNavigate: (view: ViewId) => void;
}): ReactElement => {
	const openRepositories = (): void => onNavigate("repositories");

	return (
		<aside className="relative flex h-full w-[280px] shrink-0 flex-col border-white/50 border-r bg-studio-glass-subtle backdrop-blur-2xl">
			<div aria-hidden className="h-12 shrink-0" data-desktop-drag />
			<div className="flex items-center gap-2.5 px-4 pb-5">
				<div className="flex size-8 items-center justify-center rounded-xl bg-editor-ink text-white shadow-sm">
					<GitBranch aria-hidden className="size-4" strokeWidth={2.2} />
				</div>
				<div>
					<p className="font-semibold text-[13px] text-editor-ink tracking-[-0.01em]">
						1git
					</p>
					<p className="text-[11px] text-editor-faint">Personal workspace</p>
				</div>
			</div>

			<nav aria-label="Main navigation" className="px-3">
				{NAVIGATION_ITEMS.map((item) => {
					const Icon = item.icon;
					const isActive = activeView === item.id;
					const handleNavigate = (): void => onNavigate(item.id);

					return (
						<button
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"mb-1 flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left font-medium text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/20",
								isActive
									? "bg-studio-glass-strong text-editor-ink shadow-surface-1"
									: "text-editor-muted hover:bg-studio-glass-hover hover:text-editor-ink"
							)}
							key={item.id}
							onClick={handleNavigate}
							type="button"
						>
							<Icon aria-hidden className="size-4" strokeWidth={1.8} />
							{item.label}
						</button>
					);
				})}
			</nav>

			<div className="mt-7 px-4">
				<div className="mb-2 flex items-center justify-between px-1">
					<p className="font-medium text-[11px] text-editor-faint uppercase tracking-[0.08em]">
						Recent
					</p>
					<button
						aria-label="Add repository"
						className="rounded-md p-1 text-editor-faint transition-colors hover:bg-studio-glass-hover hover:text-editor-ink"
						onClick={openRepositories}
						type="button"
					>
						<Plus aria-hidden className="size-3.5" />
					</button>
				</div>
				{REPOSITORIES.slice(0, 3).map((repository) => (
					<button
						className="group flex h-9 w-full items-center gap-2 rounded-lg px-1 text-left text-[12px] text-editor-muted outline-none transition-colors hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
						key={repository.name}
						onClick={openRepositories}
						type="button"
					>
						<span className="size-1.5 rounded-full bg-editor-faint/50 group-hover:bg-brand" />
						<span className="truncate">{repository.name}</span>
					</button>
				))}
			</div>

			<div className="mt-auto border-white/35 border-t p-3">
				<button
					className="flex h-11 w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors hover:bg-studio-glass-hover focus-visible:ring-2 focus-visible:ring-brand/20"
					type="button"
				>
					<span className="flex size-7 items-center justify-center rounded-full bg-brand font-semibold text-[11px] text-white">
						YH
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate font-medium text-[12px] text-editor-ink">
							Local workspace
						</span>
						<span className="block truncate text-[10px] text-editor-faint">
							Ready to build
						</span>
					</span>
					<Settings aria-hidden className="size-3.5 text-editor-faint" />
				</button>
			</div>
		</aside>
	);
};

const RepositoryRow = ({
	repository,
}: {
	readonly repository: Repository;
}): ReactElement => (
	<button
		className="group flex w-full items-center gap-4 border-editor-hairline border-b px-1 py-4 text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-brand/20"
		type="button"
	>
		<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-editor-sunken text-editor-muted transition-colors group-hover:bg-brand-soft group-hover:text-brand">
			<Github aria-hidden className="size-5" strokeWidth={1.7} />
		</div>
		<div className="min-w-0 flex-1">
			<div className="flex items-center gap-2">
				<p className="truncate font-semibold text-[13px] text-editor-ink">
					{repository.name}
				</p>
				<Badge variant="secondary">{repository.language}</Badge>
			</div>
			<p className="mt-1 truncate text-[12px] text-editor-faint">
				{repository.description}
			</p>
		</div>
		<div className="hidden shrink-0 items-center gap-1.5 text-[11px] text-editor-faint sm:flex">
			<GitBranch aria-hidden className="size-3.5" />
			{repository.branch}
		</div>
		<div className="w-20 shrink-0 text-right text-[11px] text-editor-faint">
			{repository.updated}
		</div>
		<ChevronRight
			aria-hidden
			className="size-4 shrink-0 text-editor-faint transition-transform group-hover:translate-x-0.5 group-hover:text-editor-muted"
		/>
	</button>
);

const Overview = ({
	onNavigate,
}: {
	readonly onNavigate: (view: ViewId) => void;
}): ReactElement => {
	const openRepositories = (): void => onNavigate("repositories");

	return (
		<div className="space-y-8">
			<section aria-labelledby="workspace-summary">
				<h2 className="sr-only" id="workspace-summary">
					Workspace summary
				</h2>
				<div className="grid gap-4 sm:grid-cols-3">
					<Card>
						<CardHeader>
							<CardDescription>Repositories</CardDescription>
							<CardTitle className="text-2xl">12</CardTitle>
							<CardAction>
								<Box className="size-4 text-editor-faint" />
							</CardAction>
						</CardHeader>
						<CardContent className="pt-3 text-[11px] text-editor-faint">
							3 active this week
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardDescription>Open branches</CardDescription>
							<CardTitle className="text-2xl">8</CardTitle>
							<CardAction>
								<GitBranch className="size-4 text-editor-faint" />
							</CardAction>
						</CardHeader>
						<CardContent className="pt-3 text-[11px] text-editor-faint">
							Across 5 repositories
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardDescription>Focus time</CardDescription>
							<CardTitle className="text-2xl">4.6h</CardTitle>
							<CardAction>
								<Clock3 className="size-4 text-editor-faint" />
							</CardAction>
						</CardHeader>
						<CardContent className="pt-3 text-[11px] text-brand">
							12% more than yesterday
						</CardContent>
					</Card>
				</div>
			</section>

			<section aria-labelledby="recent-repositories">
				<div className="mb-3 flex items-end justify-between">
					<div>
						<h2
							className="font-semibold text-[15px] text-editor-ink"
							id="recent-repositories"
						>
							Recent repositories
						</h2>
						<p className="mt-1 text-[12px] text-editor-faint">
							Pick up where you left off.
						</p>
					</div>
					<Button onClick={openRepositories} size="sm" variant="ghost">
						View all
						<ArrowUpRight aria-hidden className="size-3.5" />
					</Button>
				</div>
				<Card className="px-4">
					{REPOSITORIES.map((repository) => (
						<RepositoryRow key={repository.name} repository={repository} />
					))}
				</Card>
			</section>

			<Card className="overflow-hidden border-brand/10 bg-brand-softer">
				<CardContent className="flex items-center gap-4 py-5">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand shadow-surface-1">
						<Sparkles aria-hidden className="size-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="font-semibold text-[13px] text-editor-ink">
							Your desktop workspace is ready
						</p>
						<p className="mt-1 text-[12px] text-editor-muted">
							Electron, React, Tailwind, and the shared UI package are
							connected.
						</p>
					</div>
					<Button size="sm" variant="brand">
						Open guide
						<BookOpen aria-hidden className="size-3.5" />
					</Button>
				</CardContent>
			</Card>
		</div>
	);
};

const Repositories = ({ query }: { readonly query: string }): ReactElement => {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const visibleRepositories = REPOSITORIES.filter((repository) =>
		`${repository.name} ${repository.description} ${repository.language}`
			.toLocaleLowerCase()
			.includes(normalizedQuery)
	);

	return (
		<section aria-label="Repository list">
			<Card className="px-4">
				{visibleRepositories.length > 0 ? (
					visibleRepositories.map((repository) => (
						<RepositoryRow key={repository.name} repository={repository} />
					))
				) : (
					<div className="py-16 text-center">
						<Search aria-hidden className="mx-auto size-5 text-editor-faint" />
						<p className="mt-3 font-medium text-[13px] text-editor-ink">
							No repositories found
						</p>
						<p className="mt-1 text-[12px] text-editor-faint">
							Try a different search.
						</p>
					</div>
				)}
			</Card>
		</section>
	);
};

const ActivityView = (): ReactElement => (
	<section aria-label="Recent activity">
		<Card>
			<CardContent className="py-1">
				{ACTIVITY_ITEMS.map((item, index) => (
					<div
						className="relative flex gap-4 border-editor-hairline border-b py-5 last:border-b-0"
						key={item.label}
					>
						<div className="relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-editor-sunken text-editor-muted">
							<Activity aria-hidden className="size-3.5" />
						</div>
						{index < ACTIVITY_ITEMS.length - 1 ? (
							<div
								aria-hidden
								className="absolute top-12 bottom-[-20px] left-4 w-px bg-editor-hairline"
							/>
						) : null}
						<div className="min-w-0 flex-1">
							<div className="flex items-center justify-between gap-4">
								<p className="font-medium text-[13px] text-editor-ink">
									{item.label}
								</p>
								<span className="shrink-0 text-[11px] text-editor-faint">
									{item.time}
								</span>
							</div>
							<p className="mt-1 text-[12px] text-editor-muted">
								{item.description}
							</p>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	</section>
);

export const App = (): ReactElement => {
	const [activeView, setActiveView] = useState<ViewId>("overview");
	const [query, setQuery] = useState("");
	const pageCopy = PAGE_COPY[activeView];
	const handleQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
		setQuery(event.target.value);
	};
	const openRepositories = (): void => setActiveView("repositories");

	return (
		<div className="light flex h-full min-h-0 overflow-hidden text-editor-ink">
			<Sidebar activeView={activeView} onNavigate={setActiveView} />
			<div className="relative min-w-0 flex-1 bg-editor-surface">
				<header className="relative flex h-14 items-center justify-end border-editor-hairline border-b px-6">
					<div
						aria-hidden
						className="absolute inset-y-0 right-[360px] left-0"
						data-desktop-drag
					/>
					<div className="relative flex items-center gap-2">
						<div className="relative hidden w-56 sm:block">
							<Search
								aria-hidden
								className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-editor-faint"
							/>
							<Input
								aria-label="Search repositories"
								className="h-8 bg-editor-sunken pl-8 text-xs"
								onChange={handleQueryChange}
								placeholder="Search"
								value={query}
							/>
						</div>
						<Button aria-label="Command menu" size="icon-sm" variant="ghost">
							<Command aria-hidden className="size-4" />
						</Button>
					</div>
				</header>

				<main className="h-[calc(100%-3.5rem)] overflow-y-auto overscroll-contain px-8 py-9 lg:px-12">
					<div className="mx-auto w-full max-w-5xl">
						<header className="mb-8 flex items-end justify-between gap-6">
							<div>
								<h1 className="font-semibold text-2xl tracking-[-0.025em]">
									{pageCopy.title}
								</h1>
								<p className="mt-1.5 text-[13px] text-editor-muted">
									{pageCopy.description}
								</p>
							</div>
							<Button onClick={openRepositories} variant="brand">
								<Plus aria-hidden className="size-4" />
								New repository
							</Button>
						</header>

						{activeView === "overview" ? (
							<Overview onNavigate={setActiveView} />
						) : null}
						{activeView === "repositories" ? (
							<Repositories query={query} />
						) : null}
						{activeView === "activity" ? <ActivityView /> : null}
					</div>
				</main>
			</div>
		</div>
	);
};
