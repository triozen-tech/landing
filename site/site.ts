import type { SiteMeta, Theme } from "@/lib/site";

// Settings for THIS site: Last Landing, an original battle-royale game lobby told in six chapters
// (story mode, docs/STORY-WORKFLOW.md). Storyboard, Clip list and Motion map: site/DESIGN.md.

export const meta: SiteMeta = {
  name: "Last Landing",
  title: "Last Landing — Drop in",
  description: "An original battle-royale game lobby in six chapters: the island, the squad, the gear, the map, the queue, the jump.",
  loaderText: "LAST LANDING",
  loader: false, // site/components/BootLoader.tsx (M17) replaces the engine loader
  // ?record=1 uses the timeline markers in site/components/Stage.tsx (section timeline, ~38 s after the 2.5 s loader)
  record: { duration: 36 },
};

export const theme: Theme = {
  bg: "#0B0D12", // near-black
  surface: "#141821",
  text: "#FFFFFF",
  muted: "#9AA3B2",
  accent: "#FF6A2B", // orange (main)
  accentText: "#0B0D12",
  line: "#232836",
  fontDisplay: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  fontBody: "'Barlow', system-ui, sans-serif",
  radius: 0,
  uppercaseHeadings: true,
  heroText: "#FFFFFF",
};
