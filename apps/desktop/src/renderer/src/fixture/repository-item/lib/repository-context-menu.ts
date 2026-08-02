export const isRepositoryContextMenuKey = (
	key: string,
	shiftKey: boolean
): boolean => key === "ContextMenu" || (shiftKey && key === "F10");

export const shouldOpenRepositoryInBackground = (
	eventMetaKey: boolean,
	heldMetaKey: boolean
): boolean => eventMetaKey || heldMetaKey;
