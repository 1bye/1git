export const GENERATED_DRAFT = "feat: polish repository workspace";
const INITIAL_COMMIT_MESSAGE = "feat(session) preserve compatible saved intent";

interface DemoCommit {
	message: string;
	caption: string;
}

type DraftPhase = "Reading changes…" | "Reviewing…" | "Writing message…";

/** In-memory composer interactions; no repository, account or AI service is accessed. */
export class CommitDraft {
	message = GENERATED_DRAFT;
	lastCommit: DemoCommit | null = {
		message: INITIAL_COMMIT_MESSAGE,
		caption: "Committed 21 minutes ago",
	};
	phase: DraftPhase | null = null;
	private amendDraft: string | null = null;
	private history: { previous: DemoCommit | null; message: string }[] = [
		{ previous: null, message: INITIAL_COMMIT_MESSAGE },
	];

	get amending(): boolean {
		return this.amendDraft !== null;
	}
	get canUndo(): boolean {
		return this.history.length > 0;
	}
	get canCommit(): boolean {
		return !this.phase && this.message.trim().length > 0;
	}

	startDraft(): void {
		this.phase = "Reading changes…";
	}
	setPhase(phase: DraftPhase): void {
		if (this.phase) this.phase = phase;
	}
	finishDraft(): void {
		if (!this.phase) return;

		this.message = GENERATED_DRAFT;
		this.phase = null;
	}
	cancelDraft(): void {
		this.phase = null;
	}

	commit(): boolean {
		if (!this.canCommit) return false;

		const message = this.message.trim();

		this.history.push({ previous: this.lastCommit, message });
		this.lastCommit = { message, caption: "Committed just now" };
		this.message = "";
		this.amendDraft = null;

		return true;
	}

	toggleAmend(): void {
		if (this.phase || !this.lastCommit) return;

		if (this.amendDraft !== null) {
			this.message = this.amendDraft;
			this.amendDraft = null;
		} else {
			this.amendDraft = this.message;
			this.message = this.lastCommit.message;
		}
	}

	undo(): boolean {
		if (this.phase) return false;

		const entry = this.history.pop();

		if (!entry) return false;

		this.lastCommit = entry.previous;
		this.message = entry.message;
		this.amendDraft = null;

		return true;
	}
}

/** Split the film's green conventional type without interpreting text as HTML. */
export function splitCommitType(message: string): {
	type: string;
	rest: string;
} {
	const type = /^feat(?=[:(!])/.exec(message)?.[0] ?? "";

	return { type, rest: message.slice(type.length) };
}
