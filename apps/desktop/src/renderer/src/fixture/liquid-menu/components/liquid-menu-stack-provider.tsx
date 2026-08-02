import type { ReactElement, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import {
	LiquidMenuStackContext,
	type LiquidMenuStackContextValue,
} from "@/fixture/liquid-menu/hooks/use-liquid-menu-stack.js";
import {
	addLiquidMenuLayer,
	removeLiquidMenuLayer,
} from "@/fixture/liquid-menu/lib/liquid-menu-stack.js";

interface LiquidMenuStackProviderProps {
	readonly children: ReactNode;
}

export function LiquidMenuStackProvider({
	children,
}: LiquidMenuStackProviderProps): ReactElement {
	const [layerIds, setLayerIds] = useState<readonly string[]>([]);
	const showLayer = useCallback((layerId: string): void => {
		setLayerIds((currentLayerIds) =>
			addLiquidMenuLayer(currentLayerIds, layerId)
		);
	}, []);
	const hideLayer = useCallback((layerId: string): void => {
		setLayerIds((currentLayerIds) =>
			removeLiquidMenuLayer(currentLayerIds, layerId)
		);
	}, []);
	const context = useMemo<LiquidMenuStackContextValue>(
		() => ({
			hideLayer,
			layerIds,
			showLayer,
		}),
		[hideLayer, layerIds, showLayer]
	);

	return (
		<LiquidMenuStackContext value={context}>{children}</LiquidMenuStackContext>
	);
}
