const demo = document.querySelector<HTMLElement>("[data-repository-demo]");

if (demo) {
	const navigation = Array.from(
		demo.querySelectorAll<HTMLButtonElement>("[data-view]")
	);

	const files = Array.from(
		demo.querySelectorAll<HTMLButtonElement>("[data-file]")
	);

	const theme = demo.querySelector<HTMLButtonElement>(".git-theme-toggle");

	const machineLabels = demo.querySelectorAll<HTMLElement>(
		"[data-machine-label]"
	);

	const machines =
		document.querySelectorAll<HTMLButtonElement>("[data-machine]");

	const selectTab = (
		tabs: HTMLButtonElement[],
		selected: HTMLButtonElement
	) => {
		for (const tab of tabs) {
			const active = tab === selected;
			const panelId = tab.getAttribute("aria-controls");
			const panel = panelId ? document.getElementById(panelId) : null;

			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;

			if (panel) panel.hidden = !active;
		}
	};

	for (const tabs of [navigation, files]) {
		for (const tab of tabs) {
			tab.addEventListener("click", () => selectTab(tabs, tab));
			tab.addEventListener("keydown", (event) => {
				const vertical = tabs === files;
				const previous = vertical ? "ArrowUp" : "ArrowLeft";
				const next = vertical ? "ArrowDown" : "ArrowRight";
				const index = tabs.indexOf(tab);
				let target: HTMLButtonElement | undefined;

				if (event.key === previous)
					target = tabs[(index - 1 + tabs.length) % tabs.length];
				else if (event.key === next) target = tabs[(index + 1) % tabs.length];
				else if (event.key === "Home") target = tabs[0];
				else if (event.key === "End") target = tabs.at(-1);

				if (!target || event.altKey || event.metaKey || event.ctrlKey) return;

				event.preventDefault();
				selectTab(tabs, target);
				target.focus();
			});
		}
	}

	theme?.addEventListener("click", () => {
		const light = demo.dataset.theme !== "light";

		demo.dataset.theme = light ? "light" : "dark";
		theme.setAttribute("aria-pressed", String(light));
		theme.setAttribute(
			"aria-label",
			light ? "Use dark preview theme" : "Use light preview theme"
		);
	});

	for (const button of machines) {
		button.addEventListener("click", () => {
			for (const item of machines)
				item.setAttribute("aria-pressed", String(item === button));

			for (const label of machineLabels)
				label.textContent = button.dataset.machine ?? "This Mac";
		});
	}
}
