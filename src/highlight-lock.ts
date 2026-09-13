import { Keymap } from "obsidian";
import { GraphAdapter } from "./graph-adapter";
import type { GraphHighlightLockSettings } from "./settings";
import type { GraphLink, GraphNode, GraphPointerEvent, GraphView } from "./types";

/**
 * Color applied to previously-locked nodes/edges still on the trail (blue,
 * distinct from Obsidian's native purple hover/focus highlight so the two
 * never get confused).
 */
const TRAIL_TINT = 0x5c8ff5;

/**
 * Owns every interaction hook for ONE Graph View leaf: the Alt+Click patch,
 * the empty-space click handler, the Escape key handler, and the visual
 * trail of previously-locked nodes. All actual renderer access goes through
 * `GraphAdapter` — this class only implements the lock/trail state machine.
 *
 * Trail model: `path` is the ordered list of node ids the user has
 * Alt+Clicked through, oldest first. The LAST entry is the "current" lock —
 * it gets Obsidian's native highlight (via `getHighlightNode` override).
 * Every earlier entry, and the edges directly connecting consecutive path
 * entries, are tinted blue so the whole navigation trail stays visible even
 * though only the last node is the native "hover" target.
 *
 * - Alt+Click a node linked to the current lock -> path extends
 * - Alt+Click a node already on the path -> path truncates back to it
 * - Alt+Click an unrelated node -> path resets to just that node
 * - Esc / empty-space Alt+Click / clearLock() -> path empties entirely
 *
 * The trail-tint reassertion loop only iterates the (small, bounded) `path`
 * array every frame — never the full node/link list — so its cost does not
 * grow with vault size, unlike a naive "re-scan everything" approach.
 */
export class HighlightLockBinding {
	private adapter: GraphAdapter;
	private path: string[] = [];
	private settings: GraphHighlightLockSettings;
	private onLockChanged: (path: string[]) => void;

	private stagePointerDownHandler = (e: unknown) => this.handleStagePointerDown(e);
	private windowKeyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
	private attached = false;

	// Original tint of every PIXI object we've overridden, so it can be
	// restored exactly (native tint can vary: color groups, node type, etc.).
	private originalTint = new WeakMap<object, number>();
	// Node ids whose circle currently carries our tint override — tracked
	// separately from `path` because `path` may already be cleared/changed by
	// the time we need to know what to restore.
	private tintedNodeIds = new Set<string>();
	private rafId: number | null = null;

	constructor(
		view: GraphView,
		settings: GraphHighlightLockSettings,
		onLockChanged: (path: string[]) => void
	) {
		this.adapter = new GraphAdapter(view);
		this.settings = settings;
		this.onLockChanged = onLockChanged;
	}

	attach(): void {
		if (this.attached) return;
		this.attached = true;

		this.adapter.patchOnNodeClick((original, e, id, type) => {
			this.handleNodeClick(original, e, id, type);
		});
		this.adapter.patchGetHighlightNode(() => this.getCurrentLockedNode());

		const stage = this.adapter.getStage() as
			| { on: (event: string, fn: (e: unknown) => void) => void }
			| undefined;
		stage?.on("pointerdown", this.stagePointerDownHandler);

		window.addEventListener("keydown", this.windowKeyDownHandler);
	}

	detach(): void {
		if (!this.attached) return;
		this.attached = false;

		this.stopTrailLoop();
		this.restoreAllTints();

		const stage = this.adapter.getStage() as
			| { off: (event: string, fn: (e: unknown) => void) => void }
			| undefined;
		stage?.off("pointerdown", this.stagePointerDownHandler);
		window.removeEventListener("keydown", this.windowKeyDownHandler);

		this.adapter.unpatch();
	}

	getLockedNodeId(): string | null {
		return this.path.length ? this.path[this.path.length - 1] : null;
	}

	getLockPath(): string[] {
		return [...this.path];
	}

	/** Command Palette: "Clear highlight lock". */
	clearLock(): void {
		if (!this.path.length) return;
		this.setPath([]);
		this.adapter.clearNativeHighlight();
		this.adapter.requestRepaint();
	}

	/** Command Palette: "Toggle lock" — locks the currently hovered node, or clears an existing lock. */
	toggleLock(): void {
		if (this.path.length) {
			this.clearLock();
			return;
		}
		const hovered = this.adapter.getNativeHighlightNode();
		if (hovered) this.lockNode(hovered.id);
	}

	/** Command Palette: "Lock hovered node". */
	lockHoveredNode(): void {
		const hovered = this.adapter.getNativeHighlightNode();
		if (hovered) this.lockNode(hovered.id);
	}

	private getCurrentLockedNode(): GraphNode | null {
		const id = this.getLockedNodeId();
		if (!id) return null;
		return this.adapter.getNode(id) ?? null;
	}

	/**
	 * Applies the trail rules described in the class doc comment, then
	 * repaints and notifies the UI (marker text).
	 */
	private lockNode(id: string): void {
		const existingIndex = this.path.indexOf(id);
		let nextPath: string[];
		if (existingIndex !== -1) {
			// Re-clicking a node already on the trail: walk back to it.
			nextPath = this.path.slice(0, existingIndex + 1);
		} else if (this.path.length > 0 && this.areLinked(this.path[this.path.length - 1], id)) {
			// Clicking a neighbour of the current lock: extend the trail.
			nextPath = [...this.path, id];
		} else {
			// Unrelated node (or nothing locked yet): start a fresh trail.
			nextPath = [id];
		}
		this.setPath(nextPath);
		this.adapter.requestRepaint();
	}

	private setPath(nextPath: string[]): void {
		this.path = nextPath;
		this.syncTrailLoop();
		this.onLockChanged(this.getLockPath());
	}

	private isLockModifierEvent(e: unknown): boolean {
		const evt = e as GraphPointerEvent | null;
		if (!evt || evt.button !== 0) return false;
		return Keymap.isModifier(
			evt as unknown as MouseEvent,
			this.settings.lockModifier
		);
	}

	/**
	 * Intercepts every node click. Only Left Click + the configured modifier
	 * is handled here; every other click (plain click to open a note, etc.)
	 * falls through to Obsidian's original handler untouched.
	 */
	private handleNodeClick(
		original: (e: MouseEvent | null, id: string, type: string) => void,
		e: MouseEvent | null,
		id: string,
		type: string
	): void {
		if (e && this.isLockModifierEvent(e)) {
			this.lockNode(id);
			return;
		}
		original?.(e, id, type);
	}

	/**
	 * Handles Alt+Click on empty graph space (unlock). Node clicks are already
	 * fully handled by `onNodeClick` above; this only fires the unlock branch
	 * when, at pointerdown time, no node is under the native highlight.
	 */
	private handleStagePointerDown(e: unknown): void {
		if (!this.isLockModifierEvent(e)) return;
		if (!this.path.length) return;
		if (this.adapter.getNativeHighlightNode()) return; // pointer is over a node
		this.clearLock();
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (e.key !== "Escape") return;
		if (!this.path.length) return;
		this.clearLock();
	}

	// === Trail adjacency ===

	private endpointId(endpoint: string | GraphNode | undefined): string {
		if (typeof endpoint === "string") return endpoint;
		return endpoint?.id ?? "";
	}

	private areLinked(a: string, b: string): boolean {
		for (const link of this.adapter.getLinks()) {
			const s = this.endpointId(link.source);
			const t = this.endpointId(link.target);
			if ((s === a && t === b) || (s === b && t === a)) return true;
		}
		return false;
	}

	// === Trail visuals (bounded to `path`, never the full graph) ===

	/** Starts/stops the tint-reassertion loop based on whether a trail exists. */
	private syncTrailLoop(): void {
		const hasTrail = this.path.length >= 2;
		if (hasTrail && this.rafId === null) {
			this.startTrailLoop();
		} else if (!hasTrail) {
			this.stopTrailLoop();
			this.restoreAllTints();
		}
	}

	private startTrailLoop(): void {
		const loop = () => {
			if (this.rafId === null) return; // stopped between schedule and run
			this.applyTrailTints();
			// Obsidian only redraws the canvas on its own triggers (click,
			// hover, an active force-layout tick). Setting alpha/tint alone
			// does not repaint WebGL, so force an immediate draw with our
			// values every frame the trail loop is running.
			this.adapter.forceRender();
			this.rafId = requestAnimationFrame(loop);
		};
		this.rafId = requestAnimationFrame(loop);
	}

	private stopTrailLoop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	/**
	 * Re-applies the trail tint to every node/edge on the path except the
	 * current (last) lock, which keeps Obsidian's native highlight color.
	 * Obsidian's own render loop rewrites `tint` every frame, so this must be
	 * reasserted every frame too — but only over `path` (bounded), never the
	 * full node/link list.
	 *
	 * It also forces `alpha` back to 1 on those same objects: Obsidian's
	 * native focus-dim effect (active whenever a node is highlighted) fades
	 * every node that isn't a direct neighbour of the CURRENT lock down to
	 * ~0.2 alpha, regardless of tint — which is exactly what made earlier
	 * trail nodes look faded once the lock moved past their neighbours.
	 */
	private applyTrailTints(): void {
		const trailIds = new Set(this.path.slice(0, -1));
		for (const id of trailIds) {
			const node = this.adapter.getNode(id);
			if (node?.circle) {
				this.tint(node.circle, TRAIL_TINT);
				this.forceOpaque(node.circle);
				this.forceOpaque(node.text);
				this.tintedNodeIds.add(id);
			}
		}
		for (let i = 0; i < this.path.length - 1; i++) {
			this.tintLinkBetween(this.path[i], this.path[i + 1]);
		}
	}

	private tintLinkBetween(a: string, b: string): void {
		for (const link of this.adapter.getLinks()) {
			const s = this.endpointId(link.source);
			const t = this.endpointId(link.target);
			if ((s === a && t === b) || (s === b && t === a)) {
				if (link.line) {
					this.tint(link.line, TRAIL_TINT);
					this.forceOpaque(link.line);
				}
				if (link.arrow) {
					this.tint(link.arrow, TRAIL_TINT);
					this.forceOpaque(link.arrow);
				}
			}
		}
	}

	private tint(obj: { tint?: number }, color: number): void {
		if (typeof obj.tint !== "number") return;
		if (!this.originalTint.has(obj)) this.originalTint.set(obj, obj.tint);
		obj.tint = color;
	}

	/**
	 * Overrides Obsidian's per-frame dim so a trail object stays fully
	 * visible. Nothing needs restoring on unlock: once this stops being
	 * called for an object, the native render loop takes back over on the
	 * very next frame.
	 */
	private forceOpaque(obj?: { alpha?: number }): void {
		if (obj && typeof obj.alpha === "number") obj.alpha = 1;
	}

	/** Restores every tint this instance has overridden (called on clear/detach). */
	private restoreAllTints(): void {
		for (const node of this.iterateKnownNodes()) {
			if (node.circle) this.restoreTint(node.circle);
		}
		this.tintedNodeIds.clear();
		for (const link of this.adapter.getLinks()) {
			this.restoreLinkTint(link);
		}
	}

	private restoreLinkTint(link: GraphLink): void {
		if (link.line) this.restoreTint(link.line);
		if (link.arrow) this.restoreTint(link.arrow);
	}

	private restoreTint(obj: { tint?: number }): void {
		const original = this.originalTint.get(obj);
		if (original !== undefined) {
			obj.tint = original;
			this.originalTint.delete(obj);
		}
	}

	/** Only the (small) set of nodes we may have tinted — never the full node list. */
	private iterateKnownNodes(): GraphNode[] {
		const nodes: GraphNode[] = [];
		for (const id of this.tintedNodeIds) {
			const node = this.adapter.getNode(id);
			if (node) nodes.push(node);
		}
		return nodes;
	}
}
