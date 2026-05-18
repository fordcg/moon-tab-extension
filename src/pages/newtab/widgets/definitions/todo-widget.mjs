import { createTodoController } from "../todo/todo-controller.mjs";

export const todoWidgetDefinition = {
  id: "todo",
  title: "待办",
  core: false,
  canHide: true,
  defaultVisible: true,
  render: ({ documentRef }) => {
    const controller = createTodoController({ documentRef });
    void controller.mount();
    return controller.root;
  },
};
