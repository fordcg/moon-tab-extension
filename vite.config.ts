import { cp, mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type PluginOption } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function copyGameRuntimeStaticAssetsPlugin(): PluginOption {
  return {
    name: "copy-game-runtime-static-assets",
    apply: "build",
    closeBundle: async () => {
      const gameSource = resolve(rootDir, "src/pages/game");
      const gameOutput = resolve(rootDir, "dist/src/pages/game");
      await mkdir(gameOutput, { recursive: true });
      await cp(gameSource, gameOutput, {
        recursive: true,
        force: true,
        filter: (sourcePath) => {
          const relativePath = relative(gameSource, sourcePath).split(sep).join("/");
          if (!relativePath) return true;
          return !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(relativePath)
            && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
        },
      });
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
        },
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), copyGameRuntimeStaticAssetsPlugin(), buildContentScriptPlugin()],
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
