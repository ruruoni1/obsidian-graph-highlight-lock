import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { HighlightLockBinding } from "./highlight-lock";
import {
	DEFAULT_SETTINGS,
	GraphHighlightLockSettingTab,
	GraphHighlightLockSettings,
} from "./settings";
import { GraphAdapter } from "./graph-adapter";
import type { GraphView } from "./types";

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

/** Retry cadence while waiting for a freshly opened Graph View's PIXI renderer to initialize. */
const ATTACH_RETRY_MS = 300;
const MAX_ATTACH_RETRIES = 8;

interface ViewBinding {
	binding: HighlightLockBinding;
	markerEl: HTMLElement;
}

export default class GraphHighlightLockPlugin extends Plugin {
	settings: GraphHighlightLockSettings;

	private bindings = new Map<WorkspaceLeaf, ViewBinding>();
	private attachTimer: number | undefined;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new GraphHighlightLockSettingTab(this.app, this));

		this.addCommand({
			id: "lock-hovered-node",
			name: "Lock hovered node",
			checkCallback: (checking) =>
				this.withActiveBinding(checking, (b) => b.lockHoveredNode()),
		});

		this.addCommand({
			id: "clear-highlight-lock",
			name: "Clear highlight lock",
			checkCallback: (checking) =>
				this.withActiveBinding(checking, (b) => b.clearLock()),
		});

		this.addCommand({
			id: "toggle-lock",
			name: "Toggle lock",
			checkCallback: (checking) =>
				this.withActiveBinding(checking, (b) => b.toggleLock()),
		});

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.reconcile())
		);

		this.app.workspace.onLayoutReady(() => {
			this.reconcile();
			this.scheduleAttachRetry(0);
		});
	}

	onunload(): void {
		if (this.attachTimer !== undefined) {
			window.clearTimeout(this.attachTimer);
			this.attachTimer = undefined;
		}
		for (const [, viewBinding] of this.bindings) {
			this.teardownViewBinding(viewBinding);
		}
		this.bindings.clear();
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<GraphHighlightLockSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Re-applies the marker visibility on every open graph view (settings change). */
	refreshMarkers(): void {
		for (const viewBinding of this.bindings.values()) {
			this.updateMarker(viewBinding, viewBinding.binding.getLockPath());
		}
	}

	private withActiveBinding(
		checking: boolean,
		action: (binding: HighlightLockBinding) => void
	): boolean {
		const leaf = this.app.workspace.getMostRecentLeaf();
		const viewBinding = leaf ? this.bindings.get(leaf) : undefined;
		if (!viewBinding) return false;
		if (!checking) action(viewBinding.binding);
		return true;
	}

	private scheduleAttachRetry(attempt: number): void {
		this.attachTimer = window.setTimeout(() => {
			this.attachTimer = undefined;
			this.reconcile();
			if (this.bindings.size === 0 && attempt + 1 < MAX_ATTACH_RETRIES) {
				this.scheduleAttachRetry(attempt + 1);
			}
		}, ATTACH_RETRY_MS);
	}

	/**
	 * Syncs `bindings` with the currently open Graph View leaves: detaches
	 * leaves that were closed (resetting their lock — SPEC section 12) and
	 * attaches newly opened ones once their renderer is ready.
	 */
	private reconcile(): void {
		const openLeaves = new Set<WorkspaceLeaf>();
		for (const type of GRAPH_VIEW_TYPES) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				openLeaves.add(leaf);
			}
		}

		for (const [leaf, viewBinding] of this.bindings) {
			if (!openLeaves.has(leaf)) {
				this.teardownViewBinding(viewBinding);
				this.bindings.delete(leaf);
			}
		}

		for (const leaf of openLeaves) {
			if (this.bindings.has(leaf)) continue;
			const view = leaf.view as unknown as GraphView;
			if (!GraphAdapter.isReady(view)) continue;

			const markerEl = this.createMarkerEl(leaf);
			const binding = new HighlightLockBinding(
				view,
				this.settings,
				(path) => {
					const vb = this.bindings.get(leaf);
					if (vb) this.updateMarker(vb, path);
				}
			);
			binding.attach();
			this.bindings.set(leaf, { binding, markerEl });
		}
	}

	private createMarkerEl(leaf: WorkspaceLeaf): HTMLElement {
		const marker = leaf.view.containerEl.createDiv({
			cls: "graph-highlight-lock-marker",
		});
		marker.hide();
		return marker;
	}

	private updateMarker(viewBinding: ViewBinding, path: string[]): void {
		if (path.length && this.settings.showLockMarker) {
			const names = path.map((id) => this.displayName(id));
			viewBinding.markerEl.setText(`🔒 ${names.join(" → ")}`);
			viewBinding.markerEl.show();
		} else {
			viewBinding.markerEl.hide();
		}
	}

	/** File path -> basename (without extension) for a readable trail marker. */
	private displayName(id: string): string {
		const file = this.app.vault.getAbstractFileByPath(id);
		return file instanceof TFile ? file.basename : id;
	}

	private teardownViewBinding(viewBinding: ViewBinding): void {
		viewBinding.binding.detach();
		viewBinding.markerEl.remove();
	}
}
