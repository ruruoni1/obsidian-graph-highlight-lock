import type { GraphLink, GraphNode, GraphRenderer, GraphView } from "./types";

/**
 * GraphAdapter isolates every access to Obsidian/PIXI's private Graph View
 * renderer API. If Obsidian renames or restructures `renderer.*` in a future
 * version, this file is the only one that needs to change — `HighlightLock`
 * never touches `renderer` directly.
 *
 * One adapter instance is bound to one renderer (one Graph View leaf).
 */
export class GraphAdapter {
	private renderer: GraphRenderer;

	private originalOnNodeClick: GraphRenderer["onNodeClick"];
	private originalGetHighlightNode?: GraphRenderer["getHighlightNode"];
	private patched = false;

	constructor(view: GraphView) {
		if (!view.renderer) {
			throw new Error("GraphAdapter: view has no renderer yet");
		}
		this.renderer = view.renderer;
		this.originalOnNodeClick = this.renderer.onNodeClick;
		this.originalGetHighlightNode = this.renderer.getHighlightNode;
	}

	static isReady(view: GraphView): boolean {
		return !!view.renderer;
	}

	getNode(id: string): GraphNode | undefined {
		return this.renderer.nodeLookup?.[id];
	}

	getLinks(): GraphLink[] {
		return this.renderer.links ?? [];
	}

	getStage(): unknown {
		return this.renderer.px?.stage;
	}

	/** Reads the node currently under the native hover (before any override). */
	getNativeHighlightNode(): GraphNode | null {
		return this.renderer.highlightNode ?? null;
	}

	/**
	 * Override `onNodeClick` so the plugin can intercept Alt+Click while
	 * letting every other click fall through to the original handler
	 * unchanged (normal click, drag start, etc. are untouched).
	 */
	patchOnNodeClick(
		handler: (
			original: GraphRenderer["onNodeClick"],
			e: MouseEvent | null,
			id: string,
			type: string
		) => void
	): void {
		const original = this.originalOnNodeClick;
		this.renderer.onNodeClick = (e, id, type) => handler(original, e, id, type);
	}

	/**
	 * Override `getHighlightNode` so Obsidian's own render loop treats the
	 * locked node exactly like a hovered one: same highlight color, same
	 * neighbor/edge dimming, no custom drawing needed. Falls back to the
	 * native behavior when nothing is locked.
	 */
	patchGetHighlightNode(getLockedNode: () => GraphNode | null): void {
		const original = this.originalGetHighlightNode;
		this.renderer.getHighlightNode = () => {
			const locked = getLockedNode();
			if (locked) return locked;
			if (original) return original.call(this.renderer);
			return this.renderer.highlightNode ?? null;
		};
		this.patched = true;
	}

	/** Restores the original renderer methods. Must be called on detach. */
	unpatch(): void {
		if (!this.patched) return;
		this.renderer.onNodeClick = this.originalOnNodeClick;
		if (this.originalGetHighlightNode) {
			this.renderer.getHighlightNode = this.originalGetHighlightNode;
		} else {
			delete this.renderer.getHighlightNode;
		}
		this.patched = false;
	}

	/**
	 * Clears the native hover highlight and moves the last-known mouse
	 * position off-viewport so Obsidian's own hit-test can't immediately
	 * re-assign `highlightNode` to whatever is currently under the cursor.
	 */
	clearNativeHighlight(): void {
		this.renderer.highlightNode = null;
		this.renderer.mouseX = -1e9;
		this.renderer.mouseY = -1e9;
	}

	/** Flags Obsidian's render loop that a repaint is needed. */
	requestRepaint(): void {
		this.renderer.changed();
	}

	/**
	 * Makes `nodeId` look, to Obsidian's own node-connectivity check, as
	 * though it links to `currentId` — which is exactly the condition its
	 * per-node `render()` uses to decide "keep this node at full opacity".
	 * This steers the INPUT to that native decision instead of overwriting
	 * its OUTPUT every frame (which loses the race against that same
	 * `render()` call). No-ops — and returns `false` — if the node is
	 * already genuinely connected, so we never touch real adjacency data.
	 */
	markConnectedToCurrent(nodeId: string, currentId: string): boolean {
		const node = this.getNode(nodeId);
		if (!node?.reverse || !node.forward) return false;
		const alreadyConnected =
			Object.prototype.hasOwnProperty.call(node.forward, currentId) ||
			Object.prototype.hasOwnProperty.call(node.reverse, currentId);
		if (alreadyConnected) return false;
		node.reverse[currentId] = true;
		return true;
	}

	/** Removes a fake connection previously added by `markConnectedToCurrent`. */
	unmarkConnectedToCurrent(nodeId: string, currentId: string): void {
		const node = this.getNode(nodeId);
		if (node?.reverse) delete node.reverse[currentId];
	}

	/**
	 * Overrides `nodeId`'s own display color. `render()` always lerps
	 * `circle.tint` toward whatever `getFillColor()` returns, so replacing
	 * that per-instance method (never the shared class prototype) makes the
	 * native code itself converge — and stay — on our color, instead of us
	 * fighting its per-frame lerp back to the node's natural color.
	 */
	overrideFillColor(nodeId: string, rgb: number): void {
		const node = this.getNode(nodeId);
		if (!node || typeof node.getFillColor !== "function") return;
		if (!this.originalGetFillColor.has(nodeId)) {
			this.originalGetFillColor.set(nodeId, node.getFillColor.bind(node));
		}
		const original = this.originalGetFillColor.get(nodeId)!;
		node.getFillColor = () => ({ ...original(), rgb });
	}

	/** Restores `nodeId`'s original `getFillColor`, previously saved by `overrideFillColor`. */
	restoreFillColor(nodeId: string): void {
		const node = this.getNode(nodeId);
		const original = this.originalGetFillColor.get(nodeId);
		if (node && original) node.getFillColor = original;
		this.originalGetFillColor.delete(nodeId);
	}

	/**
	 * Wraps `link.render` (per-instance, never the shared prototype) so `after`
	 * always runs immediately following the native computation, guaranteeing
	 * our values are the last word — several of the properties `render()`
	 * touches (`line.height`, `arrow.visible`, `arrow.x/y/rotation`) are direct
	 * assignments with no lerp, so overriding them from a separately-scheduled
	 * loop only sticks if we happen to run after native's own call that frame;
	 * wrapping the call chain itself removes that race entirely.
	 */
	overrideLinkRender(link: GraphLink, after: () => void): void {
		if (typeof link.render !== "function") return;
		if (!this.originalLinkRender.has(link)) {
			this.originalLinkRender.set(link, link.render.bind(link));
		}
		const original = this.originalLinkRender.get(link)!;
		link.render = () => {
			original();
			after();
		};
	}

	/** Restores `link`'s original `render`, previously saved by `overrideLinkRender`. */
	restoreLinkRender(link: GraphLink): void {
		const original = this.originalLinkRender.get(link);
		if (original) link.render = original;
		this.originalLinkRender.delete(link);
	}

	private originalGetFillColor = new Map<string, () => { rgb: number; a: number }>();
	private originalLinkRender = new WeakMap<GraphLink, () => void>();
}
