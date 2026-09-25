import type { FileContent, GitResult } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { ImageBrokenIcon } from "@phosphor-icons/react/dist/csr/ImageBroken";
import { type ReactElement, useEffect, useState } from "react";

import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import {
	getRepositoryImageMimeType,
	getRepositoryImagePreviewSources,
} from "@/fixture/repository-workspace/lib/repository-diff-preview.js";

import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface RepositoryImageDiffProps {
	readonly entry: RepositoryDiffFileEntry;
	readonly onOpenFile: (path: string) => Promise<void>;
	readonly sessionId: RepositorySessionId;
}

interface ImagePreviewState {
	readonly after: string | null;
	readonly before: string | null;
	readonly error: string | null;
	readonly isLoading: boolean;
}

interface ImagePreviewRequest {
	readonly entry: RepositoryDiffFileEntry;
	readonly mimeType: string;
	readonly sessionId: RepositorySessionId;
}

const EMPTY_PREVIEW_STATE: ImagePreviewState = {
	after: null,
	before: null,
	error: null,
	isLoading: true,
};

const imageDataUrl = (
	result: GitResult<FileContent>,
	mimeType: string
): string | null =>
	result.ok && result.value.encoding === "base64"
		? `data:${mimeType};base64,${result.value.content}`
		: null;

const loadImagePreview = async ({
	entry,
	mimeType,
	sessionId,
}: ImagePreviewRequest): Promise<ImagePreviewState> => {
	const sources = getRepositoryImagePreviewSources(
		entry.file,
		entry.target,
		entry.change
	);
	const [before, after] = await Promise.all([
		sources.before
			? window.desktop.git.repository.fileContent(sessionId, {
					path: entry.file?.prevName ?? entry.path,
					source: sources.before,
				})
			: null,
		sources.after
			? window.desktop.git.repository.fileContent(sessionId, {
					path: entry.path,
					source: sources.after,
				})
			: null,
	]);
	const failure = [before, after].find((result) => result && !result.ok);
	let error: string | null = null;
	if (failure && !failure.ok) {
		error =
			failure.error.code === "output-too-large"
				? "This image is too large to preview."
				: failure.error.message;
	}
	return {
		after: after ? imageDataUrl(after, mimeType) : null,
		before: before ? imageDataUrl(before, mimeType) : null,
		error,
		isLoading: false,
	};
};

export function RepositoryImageDiff({
	entry,
	onOpenFile,
	sessionId,
}: RepositoryImageDiffProps): ReactElement {
	const [state, setState] = useState<ImagePreviewState>(EMPTY_PREVIEW_STATE);
	const mimeType = getRepositoryImageMimeType(entry.path);

	useEffect(() => {
		if (!mimeType) {
			setState({
				...EMPTY_PREVIEW_STATE,
				error: "This image format cannot be previewed.",
				isLoading: false,
			});
			return;
		}
		let isCurrent = true;
		const load = async (): Promise<void> => {
			const nextState = await loadImagePreview({
				entry,
				mimeType,
				sessionId,
			});
			if (!isCurrent) {
				return;
			}
			setState(nextState);
		};
		setState(EMPTY_PREVIEW_STATE);
		load().catch((cause: unknown) => {
			if (isCurrent) {
				setState({
					...EMPTY_PREVIEW_STATE,
					error:
						cause instanceof Error ? cause.message : "Image preview failed.",
					isLoading: false,
				});
			}
		});
		return () => {
			isCurrent = false;
		};
	}, [entry, mimeType, sessionId]);

	if (state.isLoading) {
		return (
			<p
				className="px-4 py-10 text-center text-editor-faint text-xss"
				role="status"
			>
				Loading image preview
			</p>
		);
	}
	const images = [
		state.before ? { label: "Before", source: state.before } : null,
		state.after ? { label: "After", source: state.after } : null,
	].filter((image): image is { label: string; source: string } =>
		Boolean(image)
	);

	return (
		<div className="px-5 py-5">
			{images.length > 0 ? (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
					{images.map((image) => (
						<figure className="min-w-0" key={image.label}>
							<div className="flex min-h-52 items-center justify-center overflow-hidden rounded-xl bg-[length:16px_16px] bg-[linear-gradient(45deg,#f1f3f5_25%,transparent_25%),linear-gradient(-45deg,#f1f3f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f3f5_75%),linear-gradient(-45deg,transparent_75%,#f1f3f5_75%)] bg-[position:0_0,0_8px,8px_-8px,-8px_0] p-3">
								<img
									alt={`${image.label} version of ${entry.path}`}
									className="max-h-[460px] max-w-full object-contain"
									height={460}
									src={image.source}
									width={640}
								/>
							</div>
							<figcaption className="mt-2 text-center font-medium text-editor-muted text-xss">
								{image.label}
							</figcaption>
						</figure>
					))}
				</div>
			) : (
				<div className="py-5 text-center">
					<ImageBrokenIcon
						aria-hidden
						className="mx-auto size-6 text-editor-faint"
					/>
					<p className="mt-2 text-editor-faint text-xss">
						{state.error ?? "No image content is available."}
					</p>
				</div>
			)}
			<div className="mt-3 flex justify-center">
				<Button
					onClick={() => onOpenFile(entry.path)}
					size="sm"
					variant="ghost"
				>
					Open in Zed
				</Button>
			</div>
		</div>
	);
}
