import { Keymap } from "obsidian";
import { GraphAdapter } from "./graph-adapter";
import type { GraphHighlightLockSettings } from "./settings";
import type { GraphLink, GraphNode, GraphPointerEvent, GraphView } from "./types";

/** Default trail color, used if a settings value fails to parse. */
const DEFAULT_TRAIL_TINT = 0x5c8ff5;

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
 * Nothing here runs on a per-frame loop. Both trail nodes and trail links
 * are styled by wrapping a native per-instance method (`getFillColor` for
 * nodes, `render` for links) so our values are applied deterministically
 * right after Obsidian's own computation, every time it runs — instead of
 * racing a separately-scheduled interval against native code that may
 * recompute (and for several properties, directly overwrite with no lerp)
 * the same values on its own schedule.
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
	// Links currently wearing our render() wrapper, so we know what to restore.
	private wrappedLinks = new Set<GraphLink>();

	// A few delayed repaint nudges after each path change, not a loop: the
	// data (fadeAlpha/tint) keeps animating toward its new target in the
	// background on Obsidian's own schedule, but the canvas itself is only
	// actually repainted on specific triggers. A single repaint requested
	// right when the path changes can catch the animation mid-flight (still
	// visibly dim) and then never update again until some unrelated
	// interaction happens to repaint. These nudges make sure a repaint also
	// lands once the native fade-in has had time to finish.
	private static readonly REPAINT_NUDGE_DELAYS_MS = [50, 150, 350, 600];
	private pendingRepaintTimers: number[] = [];

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

		this.clearRepaintNudges();
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
		this.scheduleRepaintNudges();
	}

	private scheduleRepaintNudges(): void {
		this.clearRepaintNudges();
		for (const delay of HighlightLockBinding.REPAINT_NUDGE_DELAYS_MS) {
			this.pendingRepaintTimers.push(
				window.setTimeout(() => this.adapter.requestRepaint(), delay)
			);
		}
	}

	private clearRepaintNudges(): void {
		for (const id of this.pendingRepaintTimers) window.clearTimeout(id);
		this.pendingRepaintTimers = [];
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

	/** Parses `settings.trailColor` ("#rrggbb") into a PIXI-style 0xRRGGBB number. */
	private trailColorRgb(): number {
		const parsed = parseInt(this.settings.trailColor.replace("#", ""), 16);
		return Number.isFinite(parsed) ? parsed : DEFAULT_TRAIL_TINT;
	}

	// === Trail visuals — reconciled once per path change ===

	/**
	 * Reconciles the fake-adjacency marks, color overrides, and link-render
	 * wrappers with the current `path`. Only ever touches ids/links that
	 * were, are, or are about to be on the trail — bounded by path length,
	 * never the full graph.
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
					this.adapter.overrideFillColor(nodeId, this.trailColorRgb());
					this.recoloredNodeIds.add(nodeId);
				}
			}
		}

		this.syncTrailLinkWrappers();
	}

	/**
	 * Reconciles which links have our `render()` wrapper applied, based on
	 * which consecutive path pairs are directly connected.
	 */
	private syncTrailLinkWrappers(): void {
		const desired = new Map<GraphLink, { fromId: string; toId: string }>();
		for (let i = 0; i < this.path.length - 1; i++) {
			const fromId = this.path[i];
			const toId = this.path[i + 1];
			for (const link of this.adapter.getLinks()) {
				const s = this.endpointId(link.source);
				const t = this.endpointId(link.target);
				if ((s === fromId && t === toId) || (s === toId && t === fromId)) {
					desired.set(link, { fromId, toId });
				}
			}
		}

		for (const link of [...this.wrappedLinks]) {
			if (!desired.has(link)) {
				this.adapter.restoreLinkRender(link);
				this.wrappedLinks.delete(link);
			}
		}

		for (const [link, { fromId, toId }] of desired) {
			if (this.wrappedLinks.has(link)) continue;
			this.adapter.overrideLinkRender(link, () => this.styleTrailEdge(link, fromId, toId));
			this.wrappedLinks.add(link);
		}
	}

	/**
	 * Runs right after the link's own native `render()` on every call it
	 * makes (native's own schedule, not ours) — guaranteed to be the last
	 * write that frame, so overriding direct (non-lerped) assignments like
	 * `line.height` or `arrow.visible` actually sticks.
	 */
	private styleTrailEdge(link: GraphLink, fromId: string, toId: string): void {
		const color = this.trailColorRgb();
		const line = link.line;
		if (line) {
			if (typeof line.tint === "number") line.tint = color;
			if (typeof line.alpha === "number") line.alpha = 1;
			if (typeof line.height === "number") line.height *= this.settings.trailLineWidth;
		}

		const arrow = link.arrow;
		if (!this.settings.showTrailArrows || !arrow) return;
		const from = this.adapter.getNode(fromId);
		const to = this.adapter.getNode(toId);
		if (
			!from ||
			!to ||
			typeof from.x !== "number" ||
			typeof from.y !== "number" ||
			typeof to.x !== "number" ||
			typeof to.y !== "number"
		) {
			return;
		}
		// Points from the OLDER to the NEWER node in click order — not
		// necessarily the note's real link direction, since the whole point
		// of the trail is to show the path the user navigated.
		arrow.visible = true;
		if (typeof arrow.tint === "number") arrow.tint = color;
		if (typeof arrow.alpha === "number") arrow.alpha = 1;
		arrow.x = (from.x + to.x) / 2;
		arrow.y = (from.y + to.y) / 2;
		arrow.rotation = Math.atan2(to.y - from.y, to.x - from.x);
		if (arrow.scale) {
			const scale = 1.5 * this.settings.trailLineWidth;
			arrow.scale.x = scale;
			arrow.scale.y = scale;
		}
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

		for (const link of this.wrappedLinks) {
			this.adapter.restoreLinkRender(link);
		}
		this.wrappedLinks.clear();
	}
}
