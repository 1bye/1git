export const shouldOpenRepositoryInBackground = (
	eventMetaKey: boolean,
	heldMetaKey: boolean
): boolean => eventMetaKey || heldMetaKey;
