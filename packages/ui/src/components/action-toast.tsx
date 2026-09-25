import { Button } from "@1git/ui/components/button";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

interface ActionToastOptions {
	readonly action: {
		readonly label: ReactNode;
		readonly onClick: () => void;
	};
	readonly detail?: ReactNode;
	readonly duration?: number;
	readonly id?: number | string;
	readonly message: ReactNode;
	readonly onAutoClose?: () => void;
	readonly onDismiss?: () => void;
}

export const showActionToast = ({
	action,
	detail,
	duration,
	id,
	message,
	onAutoClose,
	onDismiss,
}: ActionToastOptions): number | string =>
	toast.custom(
		(toastId) => {
			const dismissToast = (): void => {
				toast.dismiss(toastId);
			};

			const runAction = (): void => {
				action.onClick();
				dismissToast();
			};

			return (
				<div className="flex max-w-[360px] items-center gap-1.5 rounded-2xl bg-editor-ink p-1.5 pl-3 text-white">
					<p className="min-w-0 flex-1 truncate text-xs">
						{message}
						{detail === undefined ? null : (
							<>
								{" "}
								<span className="font-medium">{detail}</span>
							</>
						)}
					</p>
					<Button
						className="text-white hover:bg-white/12 hover:text-white"
						onClick={runAction}
						size="sm"
						variant="ghost"
					>
						{action.label}
					</Button>
					<Button
						aria-label="Dismiss notification"
						className="text-white/70 hover:bg-white/12 hover:text-white"
						onClick={dismissToast}
						size="icon-sm"
						variant="ghost"
					>
						<XIcon aria-hidden className="size-3.5" />
					</Button>
				</div>
			);
		},
		{
			duration,
			id,
			onAutoClose: () => onAutoClose?.(),
			onDismiss: () => onDismiss?.(),
			unstyled: true,
		}
	);
