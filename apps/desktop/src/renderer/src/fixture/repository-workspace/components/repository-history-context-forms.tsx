import type { CommitInfo, ResetMode } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { Textarea } from "@1git/ui/components/textarea";
import { cn } from "@1git/ui/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useState } from "react";

const RESET_MODE_DETAILS: Readonly<
	Record<ResetMode, { readonly description: string; readonly label: string }>
> = {
	hard: {
		description: "Discard later commits and every uncommitted change.",
		label: "Hard",
	},
	mixed: {
		description: "Keep later changes in the working tree, unstaged.",
		label: "Mixed",
	},
	soft: {
		description: "Keep later changes staged and ready to commit.",
		label: "Soft",
	},
};

const stopMenuNavigation = (
	event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
): void => {
	if (event.key !== "Escape") {
		event.stopPropagation();
	}
};

function HistoryMenuBack({
	label,
	onBack,
}: {
	readonly label: string;
	readonly onBack: () => void;
}): ReactElement {
	return (
		<>
			<DropdownMenuItem
				className="gap-2.5 py-2"
				closeOnClick={false}
				onClick={onBack}
			>
				<ArrowLeftIcon aria-hidden weight="bold" />
				{label}
			</DropdownMenuItem>
			<DropdownMenuSeparator />
		</>
	);
}

function HistoryActionStatus({
	children,
}: {
	readonly children: string;
}): ReactElement {
	return (
		<p
			aria-live="polite"
			className="px-2 py-1.5 text-[10px] text-destructive leading-4"
			role="status"
		>
			{children}
		</p>
	);
}

interface AmendCommitFormProps {
	readonly commit: CommitInfo;
	readonly isPending: boolean;
	readonly onAmend: (summary: string, description: string) => Promise<boolean>;
	readonly onBack: () => void;
}

export function AmendCommitForm({
	commit,
	isPending,
	onAmend,
	onBack,
}: AmendCommitFormProps): ReactElement {
	const [summary, setSummary] = useState(commit.summary);
	const [description, setDescription] = useState(commit.body);
	const [actionError, setActionError] = useState<string | null>(null);

	const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		setActionError(null);

		if (!(await onAmend(summary, description))) {
			setActionError("The commit could not be amended.");
		}
	};

	return (
		<>
			<HistoryMenuBack label="Amend commit" onBack={onBack} />
			<form className="space-y-2 p-1" onSubmit={submit}>
				<Input
					aria-label="Commit summary"
					autoFocus
					className="h-8 bg-editor-sunken text-xs shadow-none"
					disabled={isPending}
					maxLength={120}
					onChange={(event) => setSummary(event.target.value)}
					onKeyDown={stopMenuNavigation}
					placeholder="Summary"
					value={summary}
				/>
				<Textarea
					aria-label="Commit description"
					className="min-h-20 border-0 bg-editor-sunken text-xs shadow-none focus-visible:ring-editor-muted/15"
					disabled={isPending}
					onChange={(event) => setDescription(event.target.value)}
					onKeyDown={stopMenuNavigation}
					placeholder="Description"
					value={description}
				/>
				<div className="flex justify-end gap-1.5 pt-1">
					<Button
						disabled={isPending}
						onClick={onBack}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={isPending || !summary.trim()}
						size="sm"
						type="submit"
					>
						{isPending ? (
							<SpinnerGapIcon aria-hidden className="animate-spin" />
						) : null}
						Amend
					</Button>
				</div>
			</form>
			{actionError ? (
				<HistoryActionStatus>{actionError}</HistoryActionStatus>
			) : null}
		</>
	);
}

interface CreateBranchAtCommitFormProps {
	readonly commit: CommitInfo;
	readonly isPending: boolean;
	readonly onBack: () => void;
	readonly onCreate: (name: string) => Promise<boolean>;
}

export function CreateBranchAtCommitForm({
	commit,
	isPending,
	onBack,
	onCreate,
}: CreateBranchAtCommitFormProps): ReactElement {
	const [branchName, setBranchName] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);

	const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		setActionError(null);

		if (!(await onCreate(branchName))) {
			setActionError("The branch could not be created.");
		}
	};

	return (
		<>
			<HistoryMenuBack label="Create branch here" onBack={onBack} />
			<form className="space-y-2 p-1" onSubmit={submit}>
				<p className="px-1 text-[10px] text-editor-faint leading-4">
					Create and switch at {commit.oid.slice(0, 7)}.
				</p>
				<Input
					aria-label="New branch name"
					autoComplete="off"
					autoFocus
					className="h-8 bg-editor-sunken text-xs shadow-none"
					disabled={isPending}
					onChange={(event) => setBranchName(event.target.value)}
					onKeyDown={stopMenuNavigation}
					placeholder="feature/my-change"
					required
					value={branchName}
				/>
				<div className="flex justify-end gap-1.5">
					<Button
						disabled={isPending}
						onClick={onBack}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={isPending || !branchName.trim()}
						size="sm"
						type="submit"
						variant="brand"
					>
						Create and switch
					</Button>
				</div>
			</form>
			{actionError ? (
				<HistoryActionStatus>{actionError}</HistoryActionStatus>
			) : null}
		</>
	);
}

interface ResetCommitFormProps {
	readonly branch: string | null;
	readonly commit: CommitInfo;
	readonly isPending: boolean;
	readonly onBack: () => void;
	readonly onReset: (mode: ResetMode) => Promise<boolean>;
}

export function ResetCommitForm({
	branch,
	commit,
	isPending,
	onBack,
	onReset,
}: ResetCommitFormProps): ReactElement {
	const [mode, setMode] = useState<ResetMode>("mixed");
	const [actionError, setActionError] = useState<string | null>(null);

	const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		setActionError(null);

		if (!(await onReset(mode))) {
			setActionError("The branch could not be reset.");
		}
	};

	const selectedMode = RESET_MODE_DETAILS[mode];

	return (
		<>
			<HistoryMenuBack label="Reset branch" onBack={onBack} />
			<form className="space-y-2 p-1" onSubmit={submit}>
				<p className="px-1 text-[10px] text-editor-faint leading-4">
					Move {branch ?? "the current branch"} to {commit.oid.slice(0, 7)}.
				</p>
				<fieldset className="grid grid-cols-3 gap-1 rounded-lg border-0 bg-editor-sunken p-1">
					<legend className="sr-only">Reset mode</legend>
					{(["soft", "mixed", "hard"] as const).map((candidate) => (
						<button
							aria-pressed={mode === candidate}
							className={cn(
								"rounded-md px-2 py-1.5 font-medium text-[10px] text-editor-muted outline-none transition-colors hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-editor-muted/20",
								mode === candidate && "bg-editor-surface text-editor-ink"
							)}
							disabled={isPending}
							key={candidate}
							onClick={() => setMode(candidate)}
							type="button"
						>
							{RESET_MODE_DETAILS[candidate].label}
						</button>
					))}
				</fieldset>
				<p className="min-h-8 px-1 text-[10px] text-editor-faint leading-4">
					{selectedMode.description}
				</p>
				<div className="flex justify-end gap-1.5">
					<Button
						disabled={isPending}
						onClick={onBack}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						aria-label={`Reset ${branch ?? "the current branch"} to ${commit.oid.slice(0, 7)} using ${mode} mode`}
						disabled={isPending}
						size="sm"
						type="submit"
						variant={mode === "hard" ? "destructive" : "default"}
					>
						{isPending ? (
							<SpinnerGapIcon aria-hidden className="animate-spin" />
						) : null}
						Reset
					</Button>
				</div>
			</form>
			{actionError ? (
				<HistoryActionStatus>{actionError}</HistoryActionStatus>
			) : null}
		</>
	);
}
