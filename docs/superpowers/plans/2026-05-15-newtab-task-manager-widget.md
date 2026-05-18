# Newtab Task Manager Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static todo note with a complete local task manager inside the newtab widget.

**Architecture:** Keep `todo-widget.mjs` as a thin mount point and split the feature into constants, pure model operations, storage, view rendering, and controller modules. Persist a versioned task payload in `chrome.storage.local`; due dates are used only for display, filtering, and sorting, with no notification or background reminder behavior.

**Tech Stack:** Native ES modules, DOM APIs, Chrome extension `chrome.storage.local`, CSS, Playwright smoke verifier

---

## File Structure

**Create:**
- `src/pages/newtab/widgets/todo/todo-constants.mjs` — storage key, version, filters, priorities, and defaults
- `src/pages/newtab/widgets/todo/todo-model.mjs` — pure task normalization, CRUD operations, filtering, sorting
- `src/pages/newtab/widgets/todo/todo-storage.mjs` — read/write wrapper for `chrome.storage.local`
- `src/pages/newtab/widgets/todo/todo-view.mjs` — DOM rendering for controls and task rows
- `src/pages/newtab/widgets/todo/todo-controller.mjs` — event binding, state management, persistence

**Modify:**
- `src/pages/newtab/widgets/definitions/todo-widget.mjs` — mount the task manager controller
- `src/pages/newtab/styles/scene.css` — task manager layout and state styling
- `src/pages/newtab/styles/responsive.css` — narrow-width task row behavior
- `.tmp/verify_newtab_extension.py` — Playwright smoke checks for add, persist, complete, filter, delete, and clear

## Tasks

- [ ] Add failing verifier coverage for task manager controls and behaviors.
- [ ] Run `python .tmp/verify_newtab_extension.py` and confirm the new task-manager check fails because controls are missing.
- [ ] Add focused todo modules and wire the widget mount point to the controller.
- [ ] Add task manager CSS without changing unrelated widget runtime behavior.
- [ ] Run `python .tmp/verify_newtab_extension.py` and fix failures until all required checks pass.
- [ ] Review changed files for scope, large-file drift, and notification-permission creep.

## Self-Review

- Spec coverage: the plan covers local CRUD, completion, priority, due date, filters, sorting, persistence, and clear-completed behavior.
- Placeholder scan: no implementation placeholder remains.
- Type consistency: task fields and module names match the design document.
