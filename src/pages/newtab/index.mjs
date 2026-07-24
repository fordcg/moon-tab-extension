import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Moon Tab newtab root element is missing.");
}

createRoot(root).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);
