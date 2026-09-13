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
	/** PIXI.Graphics (the node's circle). */
	circle?: PixiObject;
	/** PIXI.Text (the node's label). */
	text?: PixiObject;
	/**
	 * Obsidian's own per-node target opacity (0-1). Its per-frame `render()`
	 * lerps this toward 1 if the node is the current highlight (or genuinely
	 * `forward`/`reverse`-adjacent to it) and toward a dim value otherwise,
	 * then derives `circle.alpha` from it. Fighting this value directly every
	 * frame loses the race against that same `render()` call — see
	 * `forward`/`reverse` below for the actual fix.
	 */
	fadeAlpha?: number;
	/** Adjacency: `forward[neighborId]` is present iff this node links TO neighborId. */
	forward?: Record<string, unknown>;
	/** Adjacency: `reverse[neighborId]` is present iff neighborId links TO this node. */
	reverse?: Record<string, unknown>;
	/**
	 * Returns this node's own display color `{ rgb, a }`. `render()` always
	 * lerps `circle.tint` toward `rgb` and factors `a` into both fill and
	 * text alpha — overriding this method (per node instance, not the shared
	 * prototype) is the reliable way to recolor a node, instead of fighting
	 * `circle.tint` every frame.
	 */
	getFillColor?: () => { rgb: number; a: number };
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
