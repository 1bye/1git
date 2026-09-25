import { useEffect, useState } from "react";

import type { RepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import {
	loadRepositoryOwnerAvatarByIdentity,
	peekRepositoryOwnerAvatar,
	repositoryOwnerAvatarKey,
} from "@/fixture/repository-item/lib/repository-owner-avatar-cache.js";

interface RepositoryOwnerAvatarState {
	readonly dataUrl: string | null;
	readonly requestKey: string;
}

export function useRepositoryOwnerAvatar(
	owner: RepositoryOwner | null
): string | null {
	const host = owner?.host.toLowerCase() ?? null;
	const name = owner?.name ?? null;
	const requestKey = repositoryOwnerAvatarKey(owner);

	const [avatar, setAvatar] = useState<RepositoryOwnerAvatarState | null>(
		() => {
			const cached = peekRepositoryOwnerAvatar(owner);

			return requestKey && cached !== undefined
				? { dataUrl: cached, requestKey }
				: null;
		}
	);

	useEffect(() => {
		if (!(host && name && requestKey)) {
			return;
		}

		let isDisposed = false;

		const loadAvatar = async (): Promise<void> => {
			const dataUrl = await loadRepositoryOwnerAvatarByIdentity(host, name);

			if (!isDisposed) {
				setAvatar({
					dataUrl,
					requestKey,
				});
			}
		};

		loadAvatar().catch(() => {
			if (!isDisposed) {
				setAvatar({ dataUrl: null, requestKey });
			}
		});

		return () => {
			isDisposed = true;
		};
	}, [host, name, requestKey]);

	if (avatar?.requestKey === requestKey) {
		return avatar.dataUrl;
	}

	return peekRepositoryOwnerAvatar(owner) ?? null;
}
