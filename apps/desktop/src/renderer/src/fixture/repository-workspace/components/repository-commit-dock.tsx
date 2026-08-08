import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { Kbd } from "@1git/ui/components/kbd";
import { Textarea } from "@1git/ui/components/textarea";
import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	ChangeEvent,
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRef, useState } from "react";
import { useCommandLensTarget } from "@/fixture/command-lens/hooks/use-command-lens-target.js";
import { MAX_COMMIT_SUMMARY_LENGTH } from "@/fixture/repository-workspace/constants/repository-workspace.js";

interface RepositoryCommitDockProps {
	readonly branch: string | null;
	readonly isPending: boolean;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
	readonly stagedCount: number;
}

export function RepositoryCommitDock({
	branch,
	isPending,
	onCommit,
	stagedCount,
}: RepositoryCommitDockProps): ReactElement {
	const [description, setDescription] = useState("");
	const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
	const [summary, setSummary] = useState("");
	const formRef = useRef<HTMLFormElement>(null);
	const canCommit = stagedCount > 0 && summary.trim().length > 0 && !isPending;
	let actionLabel = `Commit ${stagedCount} ${
		stagedCount === 1 ? "file" : "files"
	} to ${branch ?? "HEAD"}`;
	if (isPending) {
		actionLabel = "Committing…";
	} else if (stagedCount === 0) {
		actionLabel = "Stage files to commit";
	} else if (summary.trim().length === 0) {
		actionLabel = "Add a summary";
	}
	const requestCommit = (): void => {
		formRef.current?.requestSubmit();
	};
	const commandLensTarget = useCommandLensTarget({
		commands: [
			{
				allowInEditable: true,
				key: "Enter",
				label: `Commit staged files to ${branch ?? "HEAD"}`,
				onInvoke: requestCommit,
			},
		],
		disabled: !canCommit,
		highlightOutset: 0,
		hintLayout: "floating",
		id: "repository-commit",
		placement: "right",
		radius: 6,
	});
	const updateSummary = (event: ChangeEvent<HTMLInputElement>): void => {
		setSummary(event.target.value);
	};
	const updateDescription = (event: ChangeEvent<HTMLTextAreaElement>): void => {
		setDescription(event.target.value);
	};
	const submitCommit = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		if (!canCommit) {
			return;
		}
		const didCommit = await onCommit(summary, description);
		if (didCommit) {
			setSummary("");
			setDescription("");
			setIsDescriptionOpen(false);
		}
	};
	const submitWithShortcut = (
		event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
	): void => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.form?.requestSubmit();
		}
	};

	return (
		<form
			aria-busy={isPending}
			className="group relative shrink-0 bg-transparent p-2.5"
			data-name="RepositoryCommitDock"
			onSubmit={submitCommit}
			ref={formRef}
		>
			<label className="sr-only" htmlFor="repository-commit-summary">
				Commit summary
			</label>
			<div className="flex items-center gap-1">
				<div className="relative min-w-0 flex-1">
					<Input
						className="h-8 bg-white/35 pr-12 text-[11px] shadow-none focus-visible:bg-white/60"
						disabled={isPending}
						id="repository-commit-summary"
						maxLength={MAX_COMMIT_SUMMARY_LENGTH}
						onChange={updateSummary}
						onKeyDown={submitWithShortcut}
						placeholder={
							stagedCount > 0
								? "Summary (required)"
								: "Stage files to create a commit"
						}
						required
						value={summary}
					/>
					<Kbd className="absolute top-1/2 right-1.5 h-5 min-w-0 -translate-y-1/2 gap-0.5 px-1.5 text-[9px] opacity-0 transition-opacity group-focus-within:opacity-100">
						<span>⌘</span>
						<span>↵</span>
					</Kbd>
				</div>
				<Button
					aria-controls="repository-commit-description"
					aria-expanded={isDescriptionOpen}
					aria-label={
						isDescriptionOpen
							? "Hide commit description"
							: "Show commit description"
					}
					className="size-8 shrink-0 text-editor-faint"
					disabled={isPending}
					onClick={() => setIsDescriptionOpen((isOpen) => !isOpen)}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<CaretRightIcon
						aria-hidden
						className={cn(
							"size-3.5 transition-transform duration-200",
							isDescriptionOpen && "rotate-90"
						)}
						weight="bold"
					/>
				</Button>
			</div>
			<div
				className={cn(
					"grid transition-[grid-template-rows,opacity] duration-200 ease-out",
					isDescriptionOpen
						? "grid-rows-[1fr] opacity-100"
						: "grid-rows-[0fr] opacity-0"
				)}
			>
				<div
					aria-hidden={isDescriptionOpen ? undefined : true}
					className="overflow-hidden"
					inert={isDescriptionOpen ? undefined : true}
				>
					<label className="sr-only" htmlFor="repository-commit-description">
						Commit description
					</label>
					<Textarea
						className="mt-1.5 min-h-16 resize-none border-0 bg-white/35 text-[11px] shadow-none focus-visible:border-transparent focus-visible:bg-white/60 focus-visible:ring-0"
						disabled={isPending}
						id="repository-commit-description"
						onChange={updateDescription}
						onKeyDown={submitWithShortcut}
						placeholder="Optional description"
						tabIndex={isDescriptionOpen ? 0 : -1}
						value={description}
					/>
				</div>
			</div>
			<Button
				aria-busy={isPending}
				aria-keyshortcuts={commandLensTarget.ariaKeyShortcuts}
				aria-label={actionLabel}
				className="mt-1.5 w-full"
				disabled={!canCommit}
				ref={commandLensTarget.ref}
				size="sm"
				type="submit"
				variant={canCommit || isPending ? "brand" : "secondary"}
			>
				{isPending ? (
					<SpinnerGapIcon
						aria-hidden
						className="size-3.5 animate-spin"
						weight="bold"
					/>
				) : null}
				{actionLabel}
			</Button>
		</form>
	);
}
