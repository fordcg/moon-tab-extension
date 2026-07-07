import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type PluginOption } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function copyLegacyPageStaticAssetsPlugin(): PluginOption {
  return {
    name: "copy-legacy-page-static-assets",
    apply: "build",
    closeBundle: async () => {
      const matterOutput = resolve(rootDir, "dist/src/pages/game/vendor/matter.min.js");
      await mkdir(dirname(matterOutput), { recursive: true });
      await copyFile(resolve(rootDir, "src/pages/game/vendor/matter.min.js"), matterOutput);
    },
  };
}

function buildContentScriptPlugin(): PluginOption {
  return {
    name: "build-content-script-iife",
    apply: "build",
    closeBundle: async () => {
      await build({
        configFile: false,
        plugins: [],
        build: {
          emptyOutDir: false,
          outDir: resolve(rootDir, "dist/content"),
          lib: {
            entry: resolve(rootDir, "src/content/index.ts"),
            name: "BrowserAiAssistantContent",
            formats: ["iife"],
            fileName: () => "index.js",
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        },
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), copyLegacyPageStaticAssetsPlugin(), buildContentScriptPlugin()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidePanel: resolve(rootDir, "index.html"),
        devtools: resolve(rootDir, "src/devtools/network.html"),
        newtab: resolve(rootDir, "src/pages/newtab/index.html"),
        game: resolve(rootDir, "src/pages/game/index.html"),
        "background/index": resolve(rootDir, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
