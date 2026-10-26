import { setRefs } from "@gpuix/react/floating";
import { useRef, useState, useLayoutEffect, type Ref } from "react";
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
import { Keybinds } from "../keybinds/keybinds";
import { useKeybinds } from "../keybinds/keybind-context";

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
	anchorRef,
	onOpenChange,
}: {
	spaces: readonly WorkspaceSpace[];
	disabled?: boolean;
	activeId: string;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onManage: () => void;
	anchorRef?: Ref<PublicInstance>;
	onOpenChange?: (open: boolean) => void;
}) {
	const { tokens } = useAppTheme();
	const { overrides } = useKeybinds();
	const renderer = useGpuixRequired();
	const button = useRef<PublicInstance>(null);
	const tracking = useRef(false);
	const [open, setOpen] = useState(false);
	const active = spaces.find((space) => space.id === activeId);

	useLayoutEffect(() => {
		onOpenChange?.(open);
	}, [open, onOpenChange]);

	useLayoutEffect(() => () => onOpenChange?.(false), [onOpenChange]);

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
					ref={(instance) => setRefs(instance, button, anchorRef)}
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
					<SpaceSymbol icon={active.icon} color={active.color} />
				</Button>
			</TooltipTrigger>
			<TooltipContent
				tokens={tokens}
				side="right"
				align="center"
			>{`Spaces · ${active.name}\n${Keybinds.label("previous-space", overrides)} / ${Keybinds.label("next-space", overrides)} to switch spaces\nTwo-finger swipe on the rail`}</TooltipContent>
		</Tooltip>
	);
}
