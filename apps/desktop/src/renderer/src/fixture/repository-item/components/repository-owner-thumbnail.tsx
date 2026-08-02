import { cn } from "@1git/ui/lib/utils";
import type { ReactElement } from "react";
import { useState } from "react";
import type { RepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import { useRepositoryOwnerAvatar } from "@/fixture/repository-item/hooks/use-repository-owner-avatar.js";

interface RepositoryOwnerThumbnailProps {
	readonly label: string;
	readonly owner: RepositoryOwner | null;
	readonly size: "md" | "sm";
	readonly title: string;
}

const OWNER_THUMBNAIL_TONES = [
	"bg-sky-100 text-sky-700",
	"bg-violet-100 text-violet-700",
	"bg-emerald-100 text-emerald-700",
	"bg-amber-100 text-amber-800",
	"bg-rose-100 text-rose-700",
] as const;

const THUMBNAIL_SIZE_CLASS_NAMES = {
	md: "size-5 text-[10px]",
	sm: "size-4 text-[9px]",
} as const;

const THUMBNAIL_SIZE_PIXELS = {
	md: 20,
	sm: 14,
} as const;

const getThumbnailTone = (label: string): string => {
	let toneIndex = 0;
	for (const character of label) {
		toneIndex =
			(toneIndex + (character.codePointAt(0) ?? 0)) %
			OWNER_THUMBNAIL_TONES.length;
	}
	return OWNER_THUMBNAIL_TONES[toneIndex] ?? OWNER_THUMBNAIL_TONES[0];
};

export function RepositoryOwnerThumbnail({
	label,
	owner,
	size,
	title,
}: RepositoryOwnerThumbnailProps): ReactElement {
	const avatarDataUrl = useRepositoryOwnerAvatar(owner);
	const [failedDataUrl, setFailedDataUrl] = useState<string | null>(null);
	const initial = label.trim().charAt(0).toLocaleUpperCase() || "•";
	const showAvatar = avatarDataUrl !== null && avatarDataUrl !== failedDataUrl;
	const hideInvalidAvatar = (): void => {
		setFailedDataUrl(avatarDataUrl);
	};
	const sizeClassName = THUMBNAIL_SIZE_CLASS_NAMES[size];

	if (showAvatar) {
		return (
			<img
				alt=""
				aria-hidden
				className={cn("shrink-0 rounded-full object-cover", sizeClassName)}
				data-name="RepositoryOwnerThumbnail"
				decoding="async"
				draggable={false}
				height={THUMBNAIL_SIZE_PIXELS[size]}
				onError={hideInvalidAvatar}
				src={avatarDataUrl}
				title={title}
				width={THUMBNAIL_SIZE_PIXELS[size]}
			/>
		);
	}

	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full font-semibold",
				sizeClassName,
				getThumbnailTone(label)
			)}
			data-name="RepositoryOwnerThumbnail"
			title={title}
		>
			{initial}
		</span>
	);
}
