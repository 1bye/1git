import { LIQUID_MENU_MOTION } from "@/fixture/liquid-menu/constants/liquid-menu.js";

export interface LiquidMenuLayerZIndices {
	readonly backdrop: number;
	readonly content: number;
	readonly selection: number;
	readonly surface: number;
}

interface LiquidMenuBackdropOpacityOptions {
	readonly hasLayerBelow: boolean;
	readonly isTopLayer: boolean;
	readonly opacity?: number;
	readonly progress: number;
}

const LIQUID_MENU_BASE_BACKDROP_Z_INDEX = 41;
const LIQUID_MENU_LAYER_STRIDE = 4;

const clampProgress = (progress: number): number =>
	Math.max(0, Math.min(1, progress));

export const addLiquidMenuLayer = (
	layerIds: readonly string[],
	layerId: string
): readonly string[] => {
	const currentIndex = layerIds.indexOf(layerId);

	if (currentIndex < 0) {
		return [...layerIds, layerId];
	}

	if (currentIndex === layerIds.length - 1) {
		return layerIds;
	}

	return [
		...layerIds.slice(0, currentIndex),
		...layerIds.slice(currentIndex + 1),
		layerId,
	];
};

export const removeLiquidMenuLayer = (
	layerIds: readonly string[],
	layerId: string
): readonly string[] => {
	const nextLayerIds = layerIds.filter((candidate) => candidate !== layerId);

	return nextLayerIds.length === layerIds.length ? layerIds : nextLayerIds;
};

export const getLiquidMenuLayerZIndices = (
	layerIndex: number
): LiquidMenuLayerZIndices => {
	const normalizedLayerIndex = Math.max(0, layerIndex);

	const backdrop =
		LIQUID_MENU_BASE_BACKDROP_Z_INDEX +
		normalizedLayerIndex * LIQUID_MENU_LAYER_STRIDE;

	return {
		backdrop,
		content: backdrop + 3,
		selection: backdrop + 1,
		surface: backdrop + 2,
	};
};

export const getLiquidMenuBackdropOpacity = ({
	hasLayerBelow,
	isTopLayer,
	opacity = LIQUID_MENU_MOTION.backdropOpacity,
	progress,
}: LiquidMenuBackdropOpacityOptions): number => {
	if (!isTopLayer) {
		return 0;
	}

	const visibleProgress = hasLayerBelow ? 1 : clampProgress(progress);

	return opacity * visibleProgress;
};
