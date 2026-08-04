import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { Kbd } from "@1git/ui/components/kbd";
import { Textarea } from "@1git/ui/components/textarea";
import { cn } from "@1git/ui/lib/utils";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	ChangeEvent,
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useState } from "react";
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
	const canCommit = stagedCount > 0 && summary.trim().length > 0 && !isPending;
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
			className="group relative shrink-0 bg-editor-surface/94 p-2.5 backdrop-blur-xl"
			data-name="RepositoryCommitDock"
			onSubmit={submitCommit}
		>
			<label className="sr-only" htmlFor="repository-commit-summary">
				Commit summary
			</label>
			<Input
				className="h-8 bg-editor-sunken text-[11px] shadow-none"
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
						className="mt-1.5 min-h-16 resize-none bg-editor-sunken text-[11px] shadow-none"
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
			<div className="mt-1.5 flex items-center">
				<Button
					aria-expanded={isDescriptionOpen}
					className="-ml-2 h-7 px-2 text-[10px] text-editor-muted"
					onClick={() => setIsDescriptionOpen((isOpen) => !isOpen)}
					size="sm"
					type="button"
					variant="ghost"
				>
					<PlusIcon
						aria-hidden
						className={cn(
							"size-3.5 transition-transform duration-200",
							isDescriptionOpen && "rotate-45"
						)}
						weight="bold"
					/>
					Description
				</Button>
				<div className="ml-auto flex items-center text-[9px] text-editor-faint opacity-0 transition-opacity group-focus-within:opacity-100">
					<Kbd className="h-5 min-w-0 gap-0.5 px-1.5 text-[9px]">
						<span>⌘</span>
						<span>↵</span>
					</Kbd>
				</div>
			</div>
			<Button
				aria-busy={isPending}
				aria-label={`Commit ${stagedCount} staged ${
					stagedCount === 1 ? "file" : "files"
				} to ${branch ?? "HEAD"}`}
				className="mt-1.5 w-full"
				disabled={!canCommit}
				size="sm"
				type="submit"
			>
				{isPending ? (
					<SpinnerGapIcon
						aria-hidden
						className="size-3.5 animate-spin"
						weight="bold"
					/>
				) : null}
				Commit to {branch ?? "HEAD"}
				<span className="sr-only">files</span>
			</Button>
		</form>
	);
}
