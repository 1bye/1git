import { CommitDraft, splitCommitType } from "./commit-draft";

/** Bind real controls to a disposable local draft, retaining edits when generation is stopped. */
export function initCommitComposers(): void {
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	const still = () =>
		reduced.matches ||
		document.documentElement.hasAttribute("data-motion-paused");

	for (const demo of document.querySelectorAll<HTMLElement>("[data-ai-demo]")) {
		const message = demo.querySelector<HTMLTextAreaElement>(
			"[data-commit-message]"
		);

		const highlight = demo.querySelector<HTMLElement>(
			"[data-message-highlight]"
		);

		const messageType = demo.querySelector<HTMLElement>("[data-message-type]");
		const messageRest = demo.querySelector<HTMLElement>("[data-message-rest]");
		const generate = demo.querySelector<HTMLButtonElement>("[data-ai-replay]");
		const stop = demo.querySelector<HTMLButtonElement>("[data-ai-stop]");
		const commit = demo.querySelector<HTMLButtonElement>("[data-demo-commit]");
		const label = demo.querySelector<HTMLElement>("[data-commit-label]");
		const spinner = demo.querySelector<HTMLElement>("[data-ai-spinner]");
		const amend = demo.querySelector<HTMLButtonElement>("[data-demo-amend]");
		const undo = demo.querySelector<HTMLButtonElement>("[data-demo-undo]");
		const caption = demo.querySelector<HTMLElement>("[data-last-caption]");
		const lastType = demo.querySelector<HTMLElement>("[data-last-type]");
		const subject = demo.querySelector<HTMLElement>("[data-last-subject]");
		const status = demo.querySelector<HTMLElement>("[data-ai-status]");

		if (
			!message ||
			!highlight ||
			!messageType ||
			!messageRest ||
			!generate ||
			!stop ||
			!commit ||
			!label ||
			!spinner ||
			!amend ||
			!undo ||
			!caption ||
			!lastType ||
			!subject ||
			!status
		)
			continue;

		const draft = new CommitDraft();

		demo.setAttribute("data-composer-ready", "");
		const timers = new Set<number>();

		const announce = (text: string) => {
			status.textContent = text;
		};

		const later = (callback: () => void, delayMs: number) => {
			const timer = window.setTimeout(() => {
				timers.delete(timer);
				callback();
			}, delayMs);

			timers.add(timer);
		};

		const clearTimers = () => {
			for (const timer of timers) clearTimeout(timer);

			timers.clear();

			for (const ring of commit.querySelectorAll(".demo-ring")) ring.remove();
		};

		const render = () => {
			const busy = draft.phase !== null;
			const typed = splitCommitType(draft.message);

			const previous = splitCommitType(
				draft.lastCommit?.message.split("\n")[0] ?? ""
			);

			if (message.value !== draft.message) {
				message.value = draft.message;
				message.scrollTop = 0;
			}

			message.readOnly = busy;
			message.setAttribute("aria-busy", String(busy));
			highlight.toggleAttribute("data-empty", !draft.message);
			messageType.textContent = typed.type;
			messageRest.textContent = draft.message ? typed.rest : "Commit message…";
			highlight.scrollTop = message.scrollTop;
			generate.disabled = busy;
			stop.hidden = !busy;
			spinner.hidden = !busy;
			commit.disabled = !draft.canCommit;
			label.textContent =
				draft.phase ?? `${draft.amending ? "Amend" : "Commit"} 162 files`;
			amend.disabled = busy || !draft.lastCommit;
			amend.setAttribute("aria-pressed", String(draft.amending));
			undo.disabled = busy || !draft.canUndo;
			caption.textContent = draft.lastCommit?.caption ?? "Commit undone";
			lastType.textContent = previous.type;
			lastType.hidden = !previous.type;
			subject.textContent = draft.lastCommit
				? previous.rest.replace(/^:\s*/, "")
				: "Message returned to draft";
			demo.dataset.aiState = busy ? "busy" : "result";
			demo.classList.toggle("is-working", busy && !still());
		};

		const cancel = () => {
			clearTimers();

			if (draft.phase) announce("Generation stopped. Your draft is unchanged.");

			draft.cancelDraft();
			render();
		};

		const doCommit = () => {
			if (!draft.commit()) return;

			render();
			announce("Demo commit created. Undo returns its message to the editor.");

			if (still()) return;

			for (const delayMs of [0, 120])
				later(() => {
					const ring = document.createElement("span");

					ring.className = "demo-ring";
					commit.append(ring);
					later(() => ring.remove(), 700);
				}, delayMs);
		};

		demo.addEventListener("focusin", () =>
			demo.setAttribute("data-engaged", "")
		);
		demo.addEventListener("pointerdown", () =>
			demo.setAttribute("data-engaged", "")
		);
		message.addEventListener("input", () => {
			draft.message = message.value;
			render();
		});
		message.addEventListener("scroll", () => {
			highlight.scrollTop = message.scrollTop;
		});
		message.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				doCommit();
			}
		});
		generate.addEventListener("click", () => {
			clearTimers();
			draft.startDraft();

			if (still()) {
				draft.finishDraft();
				render();
				announce("Draft ready. You can edit it before committing.");

				return;
			}

			render();
			announce("Reading changes…");

			for (const [phase, delayMs] of [
				["Reviewing…", 450],
				["Writing message…", 950],
			] as const)
				later(() => {
					draft.setPhase(phase);
					render();
					announce(phase);
				}, delayMs);

			later(() => {
				draft.finishDraft();
				render();
				announce("Draft ready. You can edit it before committing.");
			}, 1500);
		});
		stop.addEventListener("click", () => {
			cancel();
			generate.focus({ preventScroll: true });
		});
		commit.addEventListener("click", doCommit);
		amend.addEventListener("click", () => {
			draft.toggleAmend();
			render();
			message.focus({ preventScroll: true });
			announce(
				draft.amending
					? "Editing the previous commit. Click Amend again to restore your draft."
					: "Original draft restored."
			);
		});
		undo.addEventListener("click", () => {
			if (draft.undo()) {
				render();
				announce("Demo commit undone. Its message is ready to edit.");
				message.focus({ preventScroll: true });
			}
		});
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) cancel();
		});
		document.addEventListener("motionchange", () => {
			if (still()) cancel();
		});
		reduced.addEventListener("change", () => {
			if (reduced.matches) cancel();
		});
		render();
	}
}
