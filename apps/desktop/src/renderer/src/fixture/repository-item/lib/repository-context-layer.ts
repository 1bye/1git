export interface RepositoryContextLayer {
	readonly isOpen: boolean;
	readonly repositoryPath: string;
}

export const updateRepositoryContextLayerOpen = (
	currentLayer: RepositoryContextLayer | null,
	repositoryPath: string,
	isOpen: boolean
): RepositoryContextLayer | null => {
	if (isOpen) {
		return { isOpen: true, repositoryPath };
	}

	return currentLayer?.repositoryPath === repositoryPath
		? { ...currentLayer, isOpen: false }
		: currentLayer;
};

export const updateRepositoryContextLayerPresence = (
	currentLayer: RepositoryContextLayer | null,
	repositoryPath: string,
	isPresent: boolean
): RepositoryContextLayer | null => {
	if (isPresent) {
		return currentLayer;
	}

	const shouldRemoveLayer =
		currentLayer?.repositoryPath === repositoryPath && !currentLayer.isOpen;

	return shouldRemoveLayer ? null : currentLayer;
};
