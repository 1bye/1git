import { useCallback, useEffect, useState } from "react";
import type { AppAppearance, AppAppearancePreference } from "./tokens";

/** Observe the OS only while automatic appearance is selected; window overrides cannot feed back into it. */
export function useSystemAppearance(
	renderer: object,
	preference: AppAppearancePreference
): AppAppearance {
	const read = useCallback(
		(): AppAppearance =>
			"getSystemAppearance" in renderer &&
			typeof renderer.getSystemAppearance === "function" &&
			renderer.getSystemAppearance() === "dark"
				? "dark"
				: "light",
		[renderer]
	);

	const [appearance, setAppearance] = useState(read);

	useEffect(() => {
		if (preference !== "system") return;

		const update = () => setAppearance(read());

		update();
		const timer = setInterval(update, 1000);

		return () => clearInterval(timer);
	}, [read, preference]);

	return appearance;
}
