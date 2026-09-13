// Partial, minimal type declarations for Obsidian's undocumented Graph View
// internals. These shapes are NOT part of the official Obsidian API and were
// inferred from public plugin source (Lore Graph, Extended Graph,
// Graph Search Sync) rather than official documentation. They may change
// between Obsidian versions — see graph-adapter.ts for the isolation layer
// that consumes them.

/** Minimal surface of a PIXI display object, as touched by this plugin. */
export interface PixiObject {
	on(event: string, fn: (...args: unknown[]) => void): void;
	off(event: string, fn: (...args: unknown[]) => void): void;
	/** Color multiplier PIXI applies on top of the object's own draw color. */
	tint?: number;
	/** Opacity (0-1). Obsidian's native focus-dim effect rewrites this every frame. */
	alpha?: number;
}

/**
 * Minimal surface of a PIXI FederatedPointerEvent, as touched by this plugin.
 * Shares field names with the native MouseEvent so it can be passed to
 * Obsidian's `Keymap.isModifier()` via a cast.
 */
export interface GraphPointerEvent {
	button: number;
	altKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
}

/** A node in the graph (file or tag). Comes from `renderer.nodes`. */
export interface GraphNode {
	id: string;
	/** PIXI.Graphics (the node's circle) — used to tint trail nodes. */
	circle?: PixiObject;
	/** PIXI.Text (the node's label) — kept fully opaque on trail nodes. */
	text?: PixiObject;
}

/** An edge between two nodes. Comes from `renderer.links`. */
export interface GraphLink {
	source: string | GraphNode;
	target: string | GraphNode;
	/** PIXI.Graphics representing the line — used to tint trail edges. */
	line?: PixiObject;
	/** PIXI.Graphics for the directional arrow head, if arrows are enabled. */
	arrow?: PixiObject;
}

/** The renderer attached to a Graph view leaf. Lives at `leaf.view.renderer`. */
export interface GraphRenderer {
	nodeLookup: Record<string, GraphNode>;
	links: GraphLink[];
	highlightNode: GraphNode | null;
	mouseX: number;
	mouseY: number;
	onNodeClick: (e: MouseEvent | null, id: string, type: string) => void;
	getHighlightNode?: () => GraphNode | null;
	/** Flags Obsidian's render loop that the scene needs to be repainted. */
	changed: () => void;
	/** PIXI application root (stage + WebGL renderer). */
	px?: {
		stage: PixiObject;
	};
}

/** A Graph view leaf (Global or Local Graph). `leaf.view` in Obsidian terms. */
export interface GraphView {
	renderer?: GraphRenderer;
	getViewType?: () => string;
}
