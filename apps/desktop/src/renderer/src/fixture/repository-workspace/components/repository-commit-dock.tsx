import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
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
import { useEffect, useRef, useState } from "react";

import { useCommandLensTarget } from "@/feature/command-lens/hooks/use-command-lens-target.js";
import type { RepositoryCommitIdentity } from "@/feature/workspace/lib/repository-commit-identity.js";

const MAX_COMMIT_SUMMARY_LENGTH = 120;

interface CommitActionLabelInput {
	readonly branch: string | null;
	readonly hasCommitIdentityRequirement: boolean;
	readonly isPending: boolean;
	readonly stagedCount: number;
	readonly summary: string;
}

const commitActionLabel = ({
	branch,
	hasCommitIdentityRequirement,
	isPending,
	stagedCount,
	summary,
}: CommitActionLabelInput): string => {
	if (isPending) {
		return "Committing…";
	}
	if (hasCommitIdentityRequirement) {
		return "Save identity and commit";
	}
	if (stagedCount === 0) {
		return "Stage files to commit";
	}
	if (summary.trim().length === 0) {
		return "Add a summary";
	}
	return `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"} to ${branch ?? "HEAD"}`;
};

interface RepositoryCommitIdentityFieldsProps {
	readonly email: string;
	readonly isPending: boolean;
	readonly name: string;
	readonly onEmailChange: (event: ChangeEvent<HTMLInputElement>) => void;
	readonly onNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
	readonly onShortcut: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

function RepositoryCommitIdentityFields({
	email,
	isPending,
	name,
	onEmailChange,
	onNameChange,
	onShortcut,
}: RepositoryCommitIdentityFieldsProps): ReactElement {
	return (
		<fieldset
			aria-describedby="repository-commit-identity-help"
			className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-lg bg-white/20 p-1.5"
			disabled={isPending}
		>
			<legend className="sr-only">Commit identity</legend>
			<p
				className="col-span-2 px-0.5 text-[9px] text-editor-muted leading-3.5"
				id="repository-commit-identity-help"
			>
				Set the author saved for this repository.
			</p>
			<label className="sr-only" htmlFor="repository-commit-author-name">
				Author name
			</label>
			<Input
				autoComplete="name"
				autoFocus
				className="h-7 bg-white/35 px-2 text-[10px] shadow-none focus-visible:bg-white/60"
				id="repository-commit-author-name"
				onChange={onNameChange}
				onKeyDown={onShortcut}
				placeholder="Name"
				required
				value={name}
			/>
			<label className="sr-only" htmlFor="repository-commit-author-email">
				Author email
			</label>
			<Input
				autoComplete="email"
				className="h-7 bg-white/35 px-2 text-[10px] shadow-none focus-visible:bg-white/60"
				id="repository-commit-author-email"
				onChange={onEmailChange}
				onKeyDown={onShortcut}
				placeholder="Email"
				required
				type="email"
				value={email}
			/>
		</fieldset>
	);
}

interface RepositoryCommitDockProps {
	readonly branch: string | null;
	readonly commitIdentity: RepositoryCommitIdentity | null;
	readonly isPending: boolean;
	readonly onCommit: (
		summary: string,
		description: string,
		identity?: RepositoryCommitIdentity
	) => Promise<boolean>;
	readonly stagedCount: number;
}

export function RepositoryCommitDock({
	branch,
	commitIdentity,
	isPending,
	onCommit,
	stagedCount,
}: RepositoryCommitDockProps): ReactElement {
	const [description, setDescription] = useState("");
	const [email, setEmail] = useState(commitIdentity?.email ?? "");
	const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
	const [name, setName] = useState(commitIdentity?.name ?? "");
	const [summary, setSummary] = useState("");
	const formRef = useRef<HTMLFormElement>(null);
	useEffect(() => {
		if (commitIdentity) {
			setEmail(commitIdentity.email);
			setName(commitIdentity.name);
		}
	}, [commitIdentity]);
	const hasRequiredIdentity =
		commitIdentity === null ||
		(name.trim().length > 0 && email.trim().length > 0);
	const canCommit =
		stagedCount > 0 &&
		summary.trim().length > 0 &&
		hasRequiredIdentity &&
		!isPending;
	const actionLabel = commitActionLabel({
		branch,
		hasCommitIdentityRequirement: commitIdentity !== null,
		isPending,
		stagedCount,
		summary,
	});
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
	const updateEmail = (event: ChangeEvent<HTMLInputElement>): void => {
		setEmail(event.target.value);
	};
	const updateName = (event: ChangeEvent<HTMLInputElement>): void => {
		setName(event.target.value);
	};
	const submitCommit = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		if (!canCommit) {
			return;
		}
		const didCommit = await onCommit(
			summary,
			description,
			commitIdentity ? { email: email.trim(), name: name.trim() } : undefined
		);
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
			className="group relative shrink-0 bg-transparent p-2 pt-1 pb-0.5"
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
				</div>
				<Button
					aria-controls="repository-commit-description"
					aria-expanded={isDescriptionOpen}
					aria-label={
						isDescriptionOpen
							? "Hide commit description"
							: "Show commit description"
					}
					className="w-8 shrink-0 bg-white/35 text-editor-faint"
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
			{commitIdentity ? (
				<RepositoryCommitIdentityFields
					email={email}
					isPending={isPending}
					name={name}
					onEmailChange={updateEmail}
					onNameChange={updateName}
					onShortcut={submitWithShortcut}
				/>
			) : null}
			<Button
				aria-busy={isPending}
				aria-keyshortcuts={commandLensTarget.ariaKeyShortcuts}
				aria-label={actionLabel}
				className="mt-0.5 w-full"
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
