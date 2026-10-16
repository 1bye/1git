import { useRef, useState } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { controlSize, radius } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import {
	NativeFileMenu,
	type NativeMenuItem,
} from "../repository-workspace/lib/native-file-menu";
import type { WorkspaceSpace } from "./workspace-spaces";
import { SpaceSymbol } from "./space-symbol";
import { spaceIconPresets } from "./space-icons";

type SpaceChoice =
	| { kind: "select"; id: string }
	| { kind: "create" }
	| { kind: "manage" };
/** Uses the same AppKit grouped menu as Settings; occupies one rail button only after spaces are created. */
export function SpaceSwitcher({
	spaces,
	disabled = false,
	activeId,
	onSelect,
	onCreate,
	onManage,
}: {
	spaces: readonly WorkspaceSpace[];
	disabled?: boolean;
	activeId: string;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onManage: () => void;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const button = useRef<PublicInstance>(null);
	const tracking = useRef(false);
	const [open, setOpen] = useState(false);
	const active = spaces.find((space) => space.id === activeId);

	if (!active || spaces.length < 2) return null;

	const show = async () => {
		if (disabled || tracking.current || !button.current) return;

		const trigger = button.current;
		const bounds = renderer.getElementBounds?.(trigger.id);

		if (!bounds) return;

		tracking.current = true;
		setOpen(true);

		try {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			const items: NativeMenuItem<SpaceChoice>[] = spaces.map((space) => ({
				label: `${space.id === activeId ? "✓ " : ""}${spaceIconPresets.find((preset) => preset.id === space.icon)?.symbol ?? space.icon}  ${space.name}`,
				enabled: true,
				value: { kind: "select", id: space.id },
			}));

			items.push(
				{ separator: true },
				{
					label: "New space…",
					enabled: spaces.length < 50,
					value: { kind: "create" },
				},
				{ label: "Manage spaces…", enabled: true, value: { kind: "manage" } }
			);
			const choice = NativeFileMenu.showItems(
				renderer,
				items,
				bounds.x + bounds.width,
				bounds.y
			);

			renderer.focusElement?.(trigger.id);

			if (choice?.kind === "select") onSelect(choice.id);
			else if (choice?.kind === "create") onCreate();
			else if (choice?.kind === "manage") onManage();
		} catch {
			onManage();
		} finally {
			tracking.current = false;
			setOpen(false);
		}
	};

	return (
		<Tooltip open={open ? false : undefined}>
			<TooltipTrigger asChild>
				<Button
					ref={button}
					disabled={disabled}
					tokens={tokens}
					variant={open ? "secondary" : "ghost"}
					testId="rail-spaces"
					aria-label={`Spaces: ${active.name}`}
					aria-expanded={open}
					onPress={() => {
						void show();
					}}
					style={{
						width: controlSize.rail,
						height: controlSize.rail,
						borderRadius: radius.lg,
						paddingLeft: 0,
						paddingRight: 0,
					}}
				>
					<SpaceSymbol icon={active.icon} />
				</Button>
			</TooltipTrigger>
			<TooltipContent
				tokens={tokens}
				side="right"
				align="center"
			>{`Spaces · ${active.name}`}</TooltipContent>
		</Tooltip>
	);
}
