import { useEffect, useState } from "react";
import type { RepositoryOwner } from "../../../feature/workspace/lib/repository-owner.js";

interface RepositoryOwnerAvatarState {
	readonly dataUrl: string | null;
	readonly requestKey: string;
}

const GITHUB_HOST = "github.com";

export function useRepositoryOwnerAvatar(
	owner: RepositoryOwner | null
): string | null {
	const [avatar, setAvatar] = useState<RepositoryOwnerAvatarState | null>(null);
	const host = owner?.host.toLowerCase() ?? null;
	const name = owner?.name ?? null;
	const requestKey = host && name ? `${host}:${name.toLowerCase()}` : null;

	useEffect(() => {
		if (!(host === GITHUB_HOST && name && requestKey)) {
			return;
		}

		let isDisposed = false;
		const loadAvatar = async (): Promise<void> => {
			const result = await window.desktop.repositoryOwners.avatar({
				host,
				name,
			});
			if (!isDisposed) {
				setAvatar({
					dataUrl: result.status === "available" ? result.dataUrl : null,
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

	return avatar?.requestKey === requestKey ? avatar.dataUrl : null;
}
