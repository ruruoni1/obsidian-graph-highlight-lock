import { Keymap } from "obsidian";
import { GraphAdapter } from "./graph-adapter";
import type { GraphHighlightLockSettings } from "./settings";
import type { GraphNode, GraphPointerEvent, GraphView } from "./types";

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
 * entries, are recolored so the whole navigation trail stays visible even
 * though only the last node is the native "hover" target.
 *
 * - Alt+Click a node linked to the current lock -> path extends
 * - Alt+Click a node already on the path -> path truncates back to it
 * - Alt+Click an unrelated node -> path resets to just that node
 * - Esc / empty-space Alt+Click / clearLock() -> path empties entirely
 *
 * Trail nodes are kept visible WITHOUT any per-frame loop: Obsidian's own
 * `node.render()` decides each node's opacity by lerping toward 1 when it is
 * genuinely `forward`/`reverse`-adjacent to the current highlight, and toward
 * a dim value otherwise — fighting that decision's OUTPUT every frame (an
 * earlier approach) always loses the race against that same `render()` call.
 * Instead this marks trail nodes as adjacent to the current lock (steering
 * the INPUT `GraphAdapter.markConnectedToCurrent`) and overrides each trail
 * node's own color function (`GraphAdapter.overrideFillColor`) so native code
 * converges on — and stays at — our values on its own. Both only need to be
 * applied once per path change, not every frame.
 */
export class HighlightLockBinding {
	private adapter: GraphAdapter;
	private path: string[] = [];
	private settings: GraphHighlightLockSettings;
	private onLockChanged: (path: string[]) => void;

	private stagePointerDownHandler = (e: unknown) => this.handleStagePointerDown(e);
	private windowKeyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
	private attached = false;

	// nodeId -> the currentId we faked a connection to, so it can be removed
	// precisely (and only if it was actually ours) when the path changes again.
	private fakeConnections = new Map<string, string>();
	// ids currently wearing our fill-color override, so we know what to restore.
	private recoloredNodeIds = new Set<string>();
	// Original tint of link line/arrow objects we've touched, for restore.
	private originalLinkTint = new WeakMap<object, number>();
	private tintedLinkObjects = new Set<object>();

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

		this.clearTrailVisuals();

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
		this.syncTrailVisuals();
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

	// === Trail visuals — applied once per path change, no per-frame loop ===

	/**
	 * Reconciles the fake-adjacency marks and color overrides with the
	 * current `path`. Only ever touches ids that were, are, or are about to
	 * be on the trail — bounded by path length, never the full graph.
	 */
	private syncTrailVisuals(): void {
		const currentId = this.getLockedNodeId();
		const desiredTrailIds = new Set(this.path.slice(0, -1));

		// Drop fake connections that no longer apply (node left the trail, or
		// the current lock moved on to a different node).
		for (const [nodeId, targetId] of [...this.fakeConnections]) {
			if (!desiredTrailIds.has(nodeId) || targetId !== currentId) {
				this.adapter.unmarkConnectedToCurrent(nodeId, targetId);
				this.fakeConnections.delete(nodeId);
			}
		}

		// Drop color overrides for ids no longer on the trail.
		for (const nodeId of [...this.recoloredNodeIds]) {
			if (!desiredTrailIds.has(nodeId)) {
				this.adapter.restoreFillColor(nodeId);
				this.recoloredNodeIds.delete(nodeId);
			}
		}

		// Add what's missing for the current trail.
		if (currentId) {
			for (const nodeId of desiredTrailIds) {
				if (!this.fakeConnections.has(nodeId)) {
					if (this.adapter.markConnectedToCurrent(nodeId, currentId)) {
						this.fakeConnections.set(nodeId, currentId);
					}
				}
				if (!this.recoloredNodeIds.has(nodeId)) {
					this.adapter.overrideFillColor(nodeId, TRAIL_TINT);
					this.recoloredNodeIds.add(nodeId);
				}
			}
		}

		this.syncTrailLinkTints();
	}

	/** Tints the edges directly connecting consecutive trail nodes; restores every other previously-tinted edge. */
	private syncTrailLinkTints(): void {
		const desired = new Set<object>();
		for (let i = 0; i < this.path.length - 1; i++) {
			for (const obj of this.findLinkObjectsBetween(this.path[i], this.path[i + 1])) {
				this.tintLink(obj);
				desired.add(obj);
			}
		}
		for (const obj of [...this.tintedLinkObjects]) {
			if (!desired.has(obj)) this.restoreLinkTint(obj);
		}
	}

	private findLinkObjectsBetween(a: string, b: string): { tint?: number }[] {
		const objs: { tint?: number }[] = [];
		for (const link of this.adapter.getLinks()) {
			const s = this.endpointId(link.source);
			const t = this.endpointId(link.target);
			if ((s === a && t === b) || (s === b && t === a)) {
				if (link.line) objs.push(link.line);
				if (link.arrow) objs.push(link.arrow);
			}
		}
		return objs;
	}

	private tintLink(obj: { tint?: number }): void {
		if (typeof obj.tint !== "number") return;
		if (!this.originalLinkTint.has(obj)) this.originalLinkTint.set(obj, obj.tint);
		obj.tint = TRAIL_TINT;
		this.tintedLinkObjects.add(obj);
	}

	private restoreLinkTint(obj: { tint?: number }): void {
		const original = this.originalLinkTint.get(obj);
		if (original !== undefined) obj.tint = original;
		this.tintedLinkObjects.delete(obj);
	}

	/** Undoes every trail override this instance holds (called on clear/detach). */
	private clearTrailVisuals(): void {
		for (const [nodeId, targetId] of this.fakeConnections) {
			this.adapter.unmarkConnectedToCurrent(nodeId, targetId);
		}
		this.fakeConnections.clear();

		for (const nodeId of this.recoloredNodeIds) {
			this.adapter.restoreFillColor(nodeId);
		}
		this.recoloredNodeIds.clear();

		for (const obj of this.tintedLinkObjects) {
			this.restoreLinkTint(obj);
		}
	}
}
