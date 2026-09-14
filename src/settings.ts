import { App, PluginSettingTab, Setting } from "obsidian";
import type { Modifier, SettingDefinitionItem } from "obsidian";
import type GraphHighlightLockPlugin from "./main";

export interface GraphHighlightLockSettings {
	/** Modifier key that must be held for the lock click/unlock click. */
	lockModifier: Modifier;
	/** Show a visual marker on the locked node. */
	showLockMarker: boolean;
	/** Color (hex, e.g. "#5c8ff5") applied to trail nodes and edges. */
	trailColor: string;
	/** Multiplier on the trail edges' native line thickness. 1 = native thickness. */
	trailLineWidth: number;
	/** Show a direction arrow on each trail edge, pointing in the order the nodes were locked. */
	showTrailArrows: boolean;
}

export const DEFAULT_SETTINGS: GraphHighlightLockSettings = {
	lockModifier: "Alt",
	showLockMarker: true,
	trailColor: "#5c8ff5",
	trailLineWidth: 2,
	showTrailArrows: true,
};

const MODIFIER_OPTIONS: Record<Modifier, string> = {
	Mod: "Ctrl/Cmd",
	Ctrl: "Ctrl",
	Meta: "Cmd/Win",
	Shift: "Shift",
	Alt: "Alt",
};

export class GraphHighlightLockSettingTab extends PluginSettingTab {
	plugin: GraphHighlightLockPlugin;

	constructor(app: App, plugin: GraphHighlightLockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Declarative settings for Obsidian 1.13+ (rendering and settings search).
	// `display()` below stays as a fallback for older Obsidian versions — it
	// is only called when this returns an empty array.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Lock trigger",
				desc: "Modifier key + Left Click on a hovered node to lock its highlight. The same modifier + click on empty space unlocks it.",
				control: {
					type: "dropdown",
					key: "lockModifier",
					defaultValue: DEFAULT_SETTINGS.lockModifier,
					options: MODIFIER_OPTIONS,
				},
			},
			{
				name: "Locked node marker",
				desc: "Show a thin outline ring around the currently locked node.",
				control: {
					type: "toggle",
					key: "showLockMarker",
					defaultValue: DEFAULT_SETTINGS.showLockMarker,
				},
			},
			{
				name: "Trail color",
				desc: "Color used for the navigation trail (previously-locked nodes and their connecting edges). Applies from the next lock action onward.",
				control: {
					type: "color",
					key: "trailColor",
					defaultValue: DEFAULT_SETTINGS.trailColor,
				},
			},
			{
				name: "Trail edge thickness",
				desc: "Thickness of trail edges, as a multiple of the native line thickness.",
				control: {
					type: "slider",
					key: "trailLineWidth",
					defaultValue: DEFAULT_SETTINGS.trailLineWidth,
					min: 1,
					max: 5,
					step: 0.5,
				},
			},
			{
				name: "Trail direction arrows",
				desc: "Show an arrow on each trail edge pointing in the order you locked the nodes.",
				control: {
					type: "toggle",
					key: "showTrailArrows",
					defaultValue: DEFAULT_SETTINGS.showTrailArrows,
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof GraphHighlightLockSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		Object.assign(this.plugin.settings, { [key]: value });
		await this.plugin.saveSettings();
		if (key === "showLockMarker") this.plugin.refreshMarkers();
	}

	// Fallback for Obsidian versions older than 1.13.0. Not called on 1.13+,
	// where the tab is rendered from getSettingDefinitions() instead.
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Lock trigger")
			.setDesc(
				"Modifier key + Left Click on a hovered node to lock its highlight. The same modifier + click on empty space unlocks it."
			)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(MODIFIER_OPTIONS)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings.lockModifier);
				dropdown.onChange(async (value) => {
					this.plugin.settings.lockModifier = value as Modifier;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Locked node marker")
			.setDesc("Show a thin outline ring around the currently locked node.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showLockMarker);
				toggle.onChange(async (value) => {
					this.plugin.settings.showLockMarker = value;
					await this.plugin.saveSettings();
					this.plugin.refreshMarkers();
				});
			});

		new Setting(containerEl)
			.setName("Trail color")
			.setDesc(
				"Color used for the navigation trail (previously-locked nodes and their connecting edges). Applies from the next lock action onward."
			)
			.addColorPicker((picker) => {
				picker.setValue(this.plugin.settings.trailColor);
				picker.onChange(async (value) => {
					this.plugin.settings.trailColor = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Trail edge thickness")
			.setDesc("Thickness of trail edges, as a multiple of the native line thickness.")
			.addSlider((slider) => {
				slider
					.setLimits(1, 5, 0.5)
					.setValue(this.plugin.settings.trailLineWidth)
					.onChange(async (value) => {
						this.plugin.settings.trailLineWidth = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Trail direction arrows")
			.setDesc("Show an arrow on each trail edge pointing in the order you locked the nodes.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showTrailArrows);
				toggle.onChange(async (value) => {
					this.plugin.settings.showTrailArrows = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
