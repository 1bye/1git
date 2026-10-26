import { useEffect, useRef, useState } from "react";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../repository-workspace/lib/repository-workspace-model";
import { useAi } from "./ai-provider";
import { CommitContext } from "./lib/commit-context";
import { AiSettingsStore } from "./lib/ai-settings-store";
import { aiProviderNames } from "./ai-provider-icons";

/** Composer-local generation. A completed, rechecked suggestion replaces the draft in one update. */
export function useAiCommit({
	state,
	onMessage,
	read = CommitContext.read,
}: {
	state: RepositoryWorkspaceState;
	onMessage: (message: string) => void;
	read?: typeof CommitContext.read;
}) {
	const ai = useAi();
	const preferences = ai?.preferences;
	const [confirming, setConfirming] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pending = useRef<AbortController | null>(null);
	const root = state.repository?.root;
	const head = state.repository?.head;

	const configured =
		!!preferences?.provider &&
		(AiSettingsStore.isCli(preferences.provider) || !!preferences.model) &&
		!ai?.error;

	const blocked =
		state.preview ||
		!root ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!!state.amend ||
		RepositoryWorkspaceModel.isBusy(state) ||
		!!RepositoryWorkspaceModel.commitBlockReason(state) ||
		!state.includedFileIds.length;

	const current = useRef({ state, preferences, blocked, onMessage });

	current.current = { state, preferences, blocked, onMessage };

	useEffect(() => {
		pending.current?.abort();
		pending.current = null;
		setProgress(null);
		setError(null);
		setConfirming(false);
	}, [
		root,
		head,
		state.includedFileIds,
		state.partialFiles,
		state.commitMessage,
		preferences,
		blocked,
	]);

	useEffect(
		() => () => {
			pending.current?.abort();
			pending.current = null;
		},
		[]
	);

	const run = async () => {
		if (pending.current || blocked || !configured || !ai || !preferences)
			return;

		const controller = new AbortController();
		const captured = current.current;

		const stillCurrent = () =>
			!controller.signal.aborted &&
			!current.current.blocked &&
			current.current.state.repository?.root ===
				captured.state.repository?.root &&
			current.current.state.repository?.head ===
				captured.state.repository?.head &&
			current.current.state.commitMessage === captured.state.commitMessage &&
			current.current.state.includedFileIds ===
				captured.state.includedFileIds &&
			current.current.state.partialFiles === captured.state.partialFiles &&
			current.current.preferences === captured.preferences;

		pending.current = controller;
		setConfirming(false);
		setError(null);
		setProgress("Reading changes…");

		try {
			const patch = await read(captured.state, controller.signal);

			if (!stillCurrent()) return;

			const message = await ai.service.generate(
				preferences,
				patch,
				controller.signal,
				(status) => {
					if (stillCurrent()) setProgress(status);
				}
			);

			if (!stillCurrent()) return;

			setProgress("Checking changes…");
			const latestPatch = await read(captured.state, controller.signal);

			if (!stillCurrent()) return;

			if (latestPatch !== patch)
				throw new Error(
					"Changes on disk have moved since generation. Review the selection and generate again."
				);

			current.current.onMessage(message);
		} catch (cause) {
			if (stillCurrent())
				setError(
					cause instanceof Error
						? cause.message
						: "AI generation failed. Your draft was left unchanged."
				);
		} finally {
			if (pending.current === controller) {
				pending.current = null;
				setProgress(null);
			}
		}
	};

	return {
		available: !!ai,
		canConfigure: !state.preview,
		configured,
		blocked,
		confirming,
		busy: progress !== null,
		progress,
		error,
		provider: preferences?.provider
			? aiProviderNames[preferences.provider]
			: "AI",
		model: preferences?.model || "CLI default",
		request() {
			if (pending.current || blocked || !configured) return;

			if (state.commitMessage.trim()) setConfirming(true);
			else void run();
		},
		confirm: () => void run(),
		dismiss: () => setConfirming(false),
		cancel() {
			pending.current?.abort();
			pending.current = null;
			setProgress(null);
		},
	};
}
