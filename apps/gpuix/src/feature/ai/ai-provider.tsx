import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { useGpuixRequired } from "@gpuix/react";
import { NativeCredentials } from "../accounts/lib/native-credentials";
import { AiIntegration } from "./lib/ai-integration";
import {
	AiSettingsStore,
	emptyAiConfiguration,
	type AiConfiguration,
	type AiPreferences,
} from "./lib/ai-settings-store";

const Context = createContext<{
	service: AiIntegration;
	preferences: AiPreferences;
	configuration: AiConfiguration;
	error: string | null;
	setDefault: (id: string | null) => void;
	reload: () => void;
} | null>(null);

/** One native window owns AI preferences and refresh coordination; startup performs no network or vault reads. */
export function AiProvider({
	children,
	service: supplied,
}: {
	children: ReactNode;
	service?: AiIntegration;
}) {
	const renderer = useGpuixRequired();

	const [service] = useState(
		() =>
			supplied ??
			new AiIntegration(new AiSettingsStore(), new NativeCredentials(renderer))
	);

	const [loaded, setLoaded] = useState(() => {
		try {
			return {
				configuration: service.store.load(),
				error: null as string | null,
			};
		} catch (error) {
			return {
				configuration: emptyAiConfiguration,
				error:
					error instanceof Error
						? error.message
						: "Could not load AI settings.",
			};
		}
	});

	const preferences = useMemo(
		() => AiSettingsStore.selected(loaded.configuration),
		[loaded.configuration]
	);

	return (
		<Context
			value={{
				service,
				...loaded,
				preferences,
				setDefault: (id) => {
					if (loaded.error) throw new Error(loaded.error);

					service.setDefault(id);
					setLoaded({ configuration: service.store.load(), error: null });
				},
				reload: () =>
					setLoaded({ configuration: service.store.load(), error: null }),
			}}
		>
			{children}
		</Context>
	);
}

/** Optional for standalone workspace fixtures; only the application boundary constructs the integration. */
export function useAi() {
	return use(Context);
}
