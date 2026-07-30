import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { Textarea } from "@1git/ui/components/textarea";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useState } from "react";

interface CommitFormProps {
	readonly branch: string | null;
	readonly canCommit: boolean;
	readonly isPending: boolean;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
}

export const CommitForm = ({
	branch,
	canCommit,
	isPending,
	onCommit,
}: CommitFormProps): ReactElement => {
	const [summary, setSummary] = useState("");
	const [description, setDescription] = useState("");
	const handleSummaryChange = (event: ChangeEvent<HTMLInputElement>): void => {
		setSummary(event.target.value);
	};
	const handleDescriptionChange = (
		event: ChangeEvent<HTMLTextAreaElement>
	): void => {
		setDescription(event.target.value);
	};
	const submitCommit = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		const didCommit = await onCommit(summary, description);
		if (didCommit) {
			setSummary("");
			setDescription("");
		}
	};

	return (
		<form
			className="shrink-0 border-editor-hairline border-t bg-studio-glass-subtle p-3"
			data-name="CommitForm"
			onSubmit={submitCommit}
		>
			<div className="flex items-center gap-2">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-editor-ink text-white">
					<GitCommitIcon aria-hidden className="size-3.5" weight="bold" />
				</span>
				<label className="sr-only" htmlFor="commit-summary">
					Commit summary
				</label>
				<Input
					className="h-8 bg-studio-glass-strong text-xs"
					disabled={isPending}
					id="commit-summary"
					maxLength={120}
					onChange={handleSummaryChange}
					placeholder="Summary (required)"
					value={summary}
				/>
			</div>
			<label className="sr-only" htmlFor="commit-description">
				Commit description
			</label>
			<Textarea
				className="mt-2 min-h-[72px] bg-studio-glass-strong text-xs"
				disabled={isPending}
				id="commit-description"
				onChange={handleDescriptionChange}
				placeholder="Description"
				value={description}
			/>
			<Button
				className="mt-2 w-full"
				disabled={!(canCommit && summary.trim()) || isPending}
				size="sm"
				type="submit"
				variant="brand"
			>
				{isPending ? (
					<SpinnerGapIcon
						aria-hidden
						className="size-3.5 animate-spin"
						weight="bold"
					/>
				) : (
					<GitCommitIcon aria-hidden className="size-3.5" weight="bold" />
				)}
				Commit to {branch ?? "current branch"}
			</Button>
		</form>
	);
};
