import {
	DropdownMenuItem,
	DropdownMenuShortcut,
} from "@1git/ui/components/dropdown-menu";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import type { ReactElement } from "react";
import type { OpenRepositoryOptions } from "@/feature/workspace/hooks/use-git-workspace.js";

interface RepositoryContextActionsProps {
	readonly onDismiss: () => void;
	readonly onOpen: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly onOpenForeground?: () => void;
	readonly repositoryPath: string;
}

export function RepositoryContextActions({
	onDismiss,
	onOpen,
	onOpenForeground,
	repositoryPath,
}: RepositoryContextActionsProps): ReactElement {
	const openRepository = async (): Promise<void> => {
		onDismiss();
		onOpenForeground?.();
		await onOpen(repositoryPath, { activate: true });
	};
	const openRepositoryInBackground = async (): Promise<void> => {
		onDismiss();
		await onOpen(repositoryPath, { activate: false });
	};

	return (
		<>
			<DropdownMenuItem
				className="gap-2.5 py-2"
				closeOnClick={false}
				onClick={openRepository}
			>
				<ArrowSquareOutIcon aria-hidden weight="duotone" />
				Open repository
			</DropdownMenuItem>
			<DropdownMenuItem
				className="gap-2.5 py-2"
				closeOnClick={false}
				onClick={openRepositoryInBackground}
			>
				<SidebarSimpleIcon aria-hidden weight="duotone" />
				Open in background
				<DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
			</DropdownMenuItem>
		</>
	);
}
