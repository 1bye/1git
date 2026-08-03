export const getNextRepositoryPickerId = (
	visibleIds: readonly string[],
	currentId: string | null
): string | null => {
	if (visibleIds.length === 0) {
		return null;
	}
	const currentIndex = currentId ? visibleIds.indexOf(currentId) : -1;
	if (currentIndex < 0) {
		return visibleIds[0] ?? null;
	}
	return visibleIds[(currentIndex + 1) % visibleIds.length] ?? null;
};

export const reconcileRepositoryPickerId = (
	previousVisibleIds: readonly string[],
	nextVisibleIds: readonly string[],
	preferredId: string | null
): string | null => {
	if (nextVisibleIds.length === 0) {
		return null;
	}
	if (preferredId && nextVisibleIds.includes(preferredId)) {
		return preferredId;
	}
	const previousIndex = preferredId
		? previousVisibleIds.indexOf(preferredId)
		: -1;
	if (previousIndex < 0) {
		return nextVisibleIds[0] ?? null;
	}
	return (
		nextVisibleIds[Math.min(previousIndex, nextVisibleIds.length - 1)] ?? null
	);
};
