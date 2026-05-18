const DEFAULT_STAGE_ROTATION_BY_SLOT = Object.freeze({
  "left-lower": -1.5,
  "right-lower": 1.5,
  "lower-center": 0.6,
});
const MIN_WIDGET_WIDTH = 180;
const MAX_WIDGET_WIDTH = 520;

export const WIDGET_STAGE_TRANSFORM_PREF = "stageTransform";

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const readFiniteNumber = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export const sanitizeStageTransform = (value = {}) => ({
  offsetX: clampNumber(readFiniteNumber(value.offsetX, 0), -900, 900),
  offsetY: clampNumber(readFiniteNumber(value.offsetY, 0), -700, 700),
  width: value.width === null || value.width === undefined
    ? null
    : clampNumber(readFiniteNumber(value.width, MIN_WIDGET_WIDTH), MIN_WIDGET_WIDTH, MAX_WIDGET_WIDTH),
  rotation: value.rotation === null || value.rotation === undefined
    ? null
    : clampNumber(readFiniteNumber(value.rotation, 0), -25, 25),
});

export const getDefaultStageTransform = (article) => ({
  offsetX: 0,
  offsetY: 0,
  width: null,
  rotation: DEFAULT_STAGE_ROTATION_BY_SLOT[article.dataset.widgetSlot] ?? 0,
});

export const applyWidgetTransform = ({ article, transform }) => {
  const nextTransform = sanitizeStageTransform({
    ...getDefaultStageTransform(article),
    ...transform,
  });

  article.style.setProperty("--widget-stage-x", `${nextTransform.offsetX}px`);
  article.style.setProperty("--widget-stage-y", `${nextTransform.offsetY}px`);
  article.style.setProperty("--widget-stage-rotation", `${nextTransform.rotation ?? 0}deg`);

  if (nextTransform.width) {
    article.style.setProperty("--widget-stage-width", `${nextTransform.width}px`);
  } else {
    article.style.removeProperty("--widget-stage-width");
  }

  return nextTransform;
};

const isInteractiveDragBlocker = (target) =>
  target instanceof Element &&
  Boolean(target.closest(
    "a, button, input, textarea, select, [contenteditable='true'], [data-widget-transform-control], [data-widget-action]",
  ));

const resolveTransformAction = ({ event, article, isEditMode }) => {
  if (!isEditMode || article.dataset.widgetTransformable !== "true") {
    return "";
  }

  const control =
    event.target instanceof Element
      ? event.target.closest("[data-widget-transform-control]")
      : null;
  const controlAction = control?.getAttribute("data-widget-transform-control") ?? "";
  if (["resize", "rotate"].includes(controlAction)) {
    return controlAction;
  }

  if (event.target instanceof Element && event.target.closest(".todo-drawer-toggle")) {
    return "drag";
  }

  if (isInteractiveDragBlocker(event.target)) {
    return "";
  }

  return "drag";
};

export const createWidgetTransformController = ({
  documentRef,
  getIsEditMode,
  getTransformPrefs,
  persistTransform,
}) => {
  const install = ({ article, widgetId }) => {
    article.addEventListener("pointerdown", (event) => {
      const action = resolveTransformAction({
        event,
        article,
        isEditMode: getIsEditMode(),
      });

      if (!action) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const startRect = article.getBoundingClientRect();
      const startTransform = sanitizeStageTransform({
        ...getDefaultStageTransform(article),
        ...getTransformPrefs(widgetId),
      });
      const startPointer = { x: event.clientX, y: event.clientY };
      const startCenter = {
        x: startRect.left + startRect.width / 2,
        y: startRect.top + startRect.height / 2,
      };
      const startAngle =
        Math.atan2(startPointer.y - startCenter.y, startPointer.x - startCenter.x) * 180 / Math.PI;
      let draftTransform = startTransform;

      const onPointerMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startPointer.x;
        const deltaY = moveEvent.clientY - startPointer.y;

        if (action === "drag") {
          draftTransform = {
            ...startTransform,
            offsetX: startTransform.offsetX + deltaX,
            offsetY: startTransform.offsetY + deltaY,
          };
        } else if (action === "resize") {
          const diagonalDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
          draftTransform = {
            ...startTransform,
            width: clampNumber(
              (startTransform.width ?? startRect.width) + diagonalDelta,
              MIN_WIDGET_WIDTH,
              MAX_WIDGET_WIDTH,
            ),
          };
        } else if (action === "rotate") {
          const currentAngle =
            Math.atan2(moveEvent.clientY - startCenter.y, moveEvent.clientX - startCenter.x)
            * 180 / Math.PI;
          draftTransform = {
            ...startTransform,
            rotation: clampNumber(startTransform.rotation + currentAngle - startAngle, -25, 25),
          };
        }

        draftTransform = applyWidgetTransform({ article, transform: draftTransform });
      };

      const onPointerUp = async () => {
        article.classList.remove("is-widget-transforming");
        article.releasePointerCapture?.(event.pointerId);
        documentRef.removeEventListener("pointermove", onPointerMove);
        documentRef.removeEventListener("pointerup", onPointerUp);
        await persistTransform({ widgetId, transform: draftTransform });
      };

      article.classList.add("is-widget-transforming");
      article.setPointerCapture?.(event.pointerId);
      documentRef.addEventListener("pointermove", onPointerMove);
      documentRef.addEventListener("pointerup", onPointerUp, { once: true });
    });
  };

  return { install };
};
