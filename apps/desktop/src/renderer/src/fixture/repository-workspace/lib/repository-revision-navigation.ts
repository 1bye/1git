import { scrollElementIntoViewport } from "@/fixture/repository-workspace/lib/scroll-element-into-viewport.js";

export type RepositoryRevisionNavigationGroup = "files" | "revisions";

const ITEM_SELECTOR = "[data-repository-revision-navigation-item]";
const VIEWPORT_SELECTOR = "[data-repository-revision-navigation-viewport]";

export const getRepositoryRevisionNavigationTarget = (
	items: readonly string[],
	currentItem: string | null,
	key: string
): string | null => {
	let offset = 0;

	if (key === "ArrowDown") {
		offset = 1;
	} else if (key === "ArrowUp") {
		offset = -1;
	}

	if (offset === 0 || items.length === 0) {
		return null;
	}

	const currentIndex = currentItem ? items.indexOf(currentItem) : -1;
	const fallbackIndex = offset > 0 ? -1 : items.length;

	const nextIndex = Math.max(
		0,
		Math.min(
			items.length - 1,
			(currentIndex < 0 ? fallbackIndex : currentIndex) + offset
		)
	);

	return items[nextIndex] ?? null;
};

export const getRepositoryRevisionNavigationGroupTarget = (
	group: RepositoryRevisionNavigationGroup,
	key: string
): RepositoryRevisionNavigationGroup | null => {
	if (group === "revisions" && key === "ArrowLeft") {
		return "files";
	}

	if (group === "files" && key === "ArrowRight") {
		return "revisions";
	}

	return null;
};

export const getRepositoryRevisionNavigationItemKey = (
	target: EventTarget | null
): string | null =>
	target instanceof Element
		? (target.closest<HTMLElement>(ITEM_SELECTOR)?.dataset
				.repositoryRevisionNavigationItem ?? null)
		: null;

export const focusRepositoryRevisionNavigationItem = (
	scope: ParentNode,
	itemKey?: string | null
): boolean => {
	const escapedKey = itemKey ? CSS.escape(itemKey) : null;

	const item =
		(escapedKey
			? scope.querySelector<HTMLElement>(
					`[data-repository-revision-navigation-item="${escapedKey}"]`
				)
			: null) ??
		scope.querySelector<HTMLElement>('[aria-current="true"]') ??
		scope.querySelector<HTMLElement>(ITEM_SELECTOR);

	if (!item) {
		return false;
	}

	item.focus({ preventScroll: true });
	const viewport = item.closest<HTMLElement>(VIEWPORT_SELECTOR);

	if (viewport) {
		scrollElementIntoViewport(viewport, item);
	}

	return true;
};

export const focusRepositoryRevisionNavigationGroup = (
	source: Element,
	group: RepositoryRevisionNavigationGroup
): boolean => {
	const workspace = source.closest('[data-name="RepositoryWorkspace"]');

	const targetGroup = workspace?.querySelector<HTMLElement>(
		`[data-repository-revision-navigation-group="${group}"]`
	);

	return targetGroup
		? focusRepositoryRevisionNavigationItem(targetGroup)
		: false;
};
