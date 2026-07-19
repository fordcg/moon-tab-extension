import { lazy } from "react";

export const LazySessionList = lazy(() => import("./components/SessionList").then((module) => ({ default: module.SessionList })));
export const LazyPetCompanion = lazy(() => import("./components/PetCompanion").then((module) => ({ default: module.PetCompanion })));

export function preloadSidePanelLazyChunks(): void {
  void import("./components/SessionList");
  void import("./components/PetCompanion");
}
