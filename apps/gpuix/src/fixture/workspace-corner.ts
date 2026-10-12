import { createContext, useContext } from "react";

/** The tab strip supplies geometry; AppShell owns the native corner animation. */
export const WorkspaceCornerContext = createContext<(radius: number) => void>(
	() => {}
);

export function useWorkspaceCorner(): (radius: number) => void {
	return useContext(WorkspaceCornerContext);
}
