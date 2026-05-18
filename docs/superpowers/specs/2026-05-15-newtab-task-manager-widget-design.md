# Newtab Task Manager Widget Design

Date: 2026-05-15
Status: Approved for implementation

## Goal

Turn the existing static newtab todo widget into a local full task manager while keeping it inside the current widget runtime and illustrated card system.

## Scope

The task manager supports:

- create tasks
- mark tasks complete or active
- edit task titles
- delete tasks
- set priority
- set due date
- filter by all, active, completed, and overdue
- sort by due date and priority
- clear completed tasks
- persist state in `chrome.storage.local`

The task manager does not support browser notifications, background reminders, account sync, or network storage.

## Architecture

The implementation must keep the feature split across focused modules:

- `src/pages/newtab/widgets/definitions/todo-widget.mjs` mounts the widget container and decorative assets.
- `src/pages/newtab/widgets/todo/todo-constants.mjs` owns storage keys and enum-like constants.
- `src/pages/newtab/widgets/todo/todo-model.mjs` owns pure task normalization, mutation, filtering, and sorting.
- `src/pages/newtab/widgets/todo/todo-storage.mjs` owns `chrome.storage.local` reads and writes.
- `src/pages/newtab/widgets/todo/todo-view.mjs` owns DOM creation and rendering.
- `src/pages/newtab/widgets/todo/todo-controller.mjs` owns events, state transitions, and persistence.

No single module should become a large mixed controller/view/storage file.

## Interaction

The widget shows a compact task form with title, priority, due date, and add button. It shows filter chips for all, active, completed, and overdue. Each task row has a checkbox, editable title, priority selector, due date input, and delete button. A clear-completed action appears in the widget footer.

Overdue means a task is active and its due date is earlier than the current local date. Due dates are display and organization only; they do not trigger notifications.

## Data

Persist a versioned payload under `newtabTodoTasks`.

Each task stores:

- `id`
- `title`
- `completed`
- `priority` as `low`, `medium`, or `high`
- `dueDate` as `YYYY-MM-DD` or empty string
- `createdAt`
- `updatedAt`
- `completedAt`
- `order`

Malformed storage is normalized to a safe empty list.

## Testing

Extend `.tmp/verify_newtab_extension.py` with structural and behavior checks:

- task manager modules exist
- widget controls render
- adding a task creates a visible row
- task data persists after reload
- completing a task moves it into the completed filter
- overdue filter shows an active overdue task
- deleting a task removes it from storage and UI
- clear completed removes completed tasks

The existing newtab smoke checks must continue to pass.
