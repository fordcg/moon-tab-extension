import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { newtabAssets } from "../assets";
import {
  createDefaultWidgetLayout,
  hideWidget,
  normalizeWidgetLayout,
  loadWidgetLayout,
  restoreWidget,
  updateWidgetPrefs,
} from "../widgets/layout-state.mjs";
import {
  WIDGET_STAGE_TRANSFORM_PREF,
  sanitizeStageTransform,
} from "../widgets/widget-transform.mjs";
import { SaveIcon } from "./icons";
import { TodoWidget } from "./TodoWidget";
import type { WidgetDefinition, WidgetLayout } from "./types";

interface WidgetBoardProps {
  searchNode: ReactNode;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
}

const WIDGETS: WidgetDefinition[] = [
  { id: "search", title: "搜索", core: true, canHide: false, defaultVisible: true },
  { id: "quicksites", title: "快捷站点", core: false, canHide: true, defaultVisible: true },
  { id: "calendar", title: "日历", core: false, canHide: true, defaultVisible: true },
  { id: "todo", title: "待办", core: false, canHide: true, defaultVisible: true },
];

const SLOT_BY_WIDGET_ID: Record<string, string> = {
  search: "center",
  todo: "left-lower",
  calendar: "right-lower",
  quicksites: "lower-center",
};

type WidgetId = WidgetDefinition["id"];
interface WidgetStageTransform {
  offsetX: number;
  offsetY: number;
  width: number | null;
  rotation: number | null;
}

type TransformAction = "drag" | "resize" | "rotate";

const DEFAULT_STAGE_ROTATION_BY_SLOT: Record<string, number> = {
  "left-lower": -1.5,
  "right-lower": 1.5,
  "lower-center": 0.6,
};

const isWidgetId = (value: string): value is WidgetId => value === "search" || value === "quicksites" || value === "calendar" || value === "todo";

function readWidgetStageTransform(layout: WidgetLayout, widgetId: WidgetId): WidgetStageTransform {
  return sanitizeStageTransform(layout.widgetPrefs?.[widgetId]?.[WIDGET_STAGE_TRANSFORM_PREF] ?? {}) as WidgetStageTransform;
}

function resolveDefaultStageTransform(widgetSlot: string): WidgetStageTransform {
  return {
    offsetX: 0,
    offsetY: 0,
    width: null,
    rotation: DEFAULT_STAGE_ROTATION_BY_SLOT[widgetSlot] ?? 0,
  };
}

function resolveStageTransform(widgetSlot: string, transform: Partial<WidgetStageTransform>): WidgetStageTransform {
  return sanitizeStageTransform({
    ...resolveDefaultStageTransform(widgetSlot),
    ...transform,
  }) as WidgetStageTransform;
}

function createStageTransformStyle(widgetSlot: string, transform: Partial<WidgetStageTransform>): CSSProperties {
  const normalized = resolveStageTransform(widgetSlot, transform);
  const style = {
    "--widget-stage-x": `${normalized.offsetX}px`,
    "--widget-stage-y": `${normalized.offsetY}px`,
    "--widget-stage-rotation": `${normalized.rotation ?? 0}deg`,
  } as CSSProperties;

  if (normalized.width) {
    return {
      ...style,
      "--widget-stage-width": `${normalized.width}px`,
    } as CSSProperties;
  }

  return style;
}

function isInteractiveDragBlocker(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "a, button, input, textarea, select, [contenteditable='true'], [data-widget-transform-control], [data-widget-action]",
  ));
}

export function WidgetBoard({ searchNode, editMode, onEditModeChange }: WidgetBoardProps) {
  const [layout, setLayout] = useState<WidgetLayout>(() => normalizeWidgetLayout({ layout: createDefaultWidgetLayout({ registryItems: WIDGETS }), registryItems: WIDGETS }));
  const [draftTransforms, setDraftTransforms] = useState<Partial<Record<WidgetId, WidgetStageTransform>>>({});
  const widgetsById = useMemo(() => new Map<WidgetId, WidgetDefinition>(WIDGETS.map((widget) => [widget.id, widget] as const)), []);

  useEffect(() => {
    let disposed = false;
    void loadWidgetLayout({ registryItems: WIDGETS })
      .then((loadedLayout) => {
        if (!disposed) {
          setLayout(loadedLayout);
        }
      })
      .catch(() => {
        if (!disposed) {
          setLayout(normalizeWidgetLayout({ layout: createDefaultWidgetLayout({ registryItems: WIDGETS }), registryItems: WIDGETS }));
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const visibleWidgetIds = layout.orderedWidgetIds.filter((id): id is WidgetId => isWidgetId(id) && !layout.hiddenWidgetIds.includes(id) && widgetsById.has(id));

  const hideWidgetById = async (widgetId: WidgetId) => {
    const nextLayout = await hideWidget({ layout, widgetId, registryItems: WIDGETS });
    setLayout(nextLayout);
  };

  const restoreWidgetById = async (widgetId: WidgetId) => {
    const nextLayout = await restoreWidget({ layout, widgetId, registryItems: WIDGETS });
    setLayout(nextLayout);
  };

  const setDraftTransform = (widgetId: WidgetId, transform: WidgetStageTransform) => {
    setDraftTransforms((current) => ({
      ...current,
      [widgetId]: sanitizeStageTransform(transform) as WidgetStageTransform,
    }));
  };

  const commitTransform = async (widgetId: WidgetId, transform: WidgetStageTransform) => {
    const sanitizedTransform = sanitizeStageTransform(transform) as WidgetStageTransform;
    setDraftTransform(widgetId, sanitizedTransform);
    try {
      const nextLayout = await updateWidgetPrefs({
        layout,
        widgetId,
        widgetPrefs: {
          [WIDGET_STAGE_TRANSFORM_PREF]: sanitizedTransform,
        },
        registryItems: WIDGETS,
      });
      setLayout(nextLayout);
    } finally {
      setDraftTransforms((current) => {
        const next = { ...current };
        delete next[widgetId];
        return next;
      });
    }
  };

  return (
    <>
      {editMode ? (
        <section id="widget-panel" className="widget-panel" data-widget-edit-surface="true" aria-label="组件面板">
          <div id="widget-panel-list" className="widget-panel-list">
            {WIDGETS.filter((widget) => !widget.core).map((widget) => {
              const hidden = layout.hiddenWidgetIds.includes(widget.id);
              const visible = visibleWidgetIds.includes(widget.id);
              return (
                <div className="widget-panel-row" data-widget-id={widget.id} key={widget.id}>
                  <div className="widget-panel-meta">
                    <span className="widget-panel-label">{widget.title}</span>
                    <span className="widget-panel-visibility">{hidden ? "已隐藏" : visible ? "已显示" : "未显示"}</span>
                  </div>
                  <button
                    className="ui-btn-secondary widget-panel-button"
                    type="button"
                    disabled={visible && !hidden}
                    onClick={() => void (hidden || !visible ? restoreWidgetById(widget.id) : undefined)}
                  >
                    {hidden ? "恢复" : visible ? "已添加" : "添加"}
                  </button>
                </div>
              );
            })}
          </div>
          <button id="save-widget-layout" className="ui-btn-icon widget-panel-save" type="button" aria-label="保存布局" title="保存布局" onClick={() => onEditModeChange(false)}>
            <SaveIcon />
          </button>
        </section>
      ) : null}

      <div id="widget-root" className="homepage-widget-root" aria-live="polite" data-widget-edit-mode={editMode}>
        {visibleWidgetIds.map((widgetId) => {
          const widget = widgetsById.get(widgetId);
          if (!widget) {
            return null;
          }
          return (
            <WidgetShell
              widget={widget}
              editMode={editMode}
              key={widget.id}
              transform={draftTransforms[widget.id] ?? readWidgetStageTransform(layout, widget.id)}
              onHide={() => void hideWidgetById(widget.id)}
              onTransformDraft={(transform) => setDraftTransform(widget.id, transform)}
              onTransformCommit={(transform) => void commitTransform(widget.id, transform)}
            >
              {widget.id === "search" ? searchNode : widget.id === "quicksites" ? <QuickSitesWidget /> : widget.id === "calendar" ? <CalendarWidget /> : <TodoWidget />}
            </WidgetShell>
          );
        })}
      </div>

    </>
  );
}

function WidgetShell({
  widget,
  editMode,
  transform,
  onHide,
  onTransformDraft,
  onTransformCommit,
  children,
}: {
  widget: WidgetDefinition;
  editMode: boolean;
  transform: WidgetStageTransform;
  onHide: () => void;
  onTransformDraft: (transform: WidgetStageTransform) => void;
  onTransformCommit: (transform: WidgetStageTransform) => void;
  children: ReactNode;
}) {
  const canHide = widget.canHide;
  const articleRef = useRef<HTMLElement | null>(null);
  const [transforming, setTransforming] = useState(false);
  const widgetSlot = SLOT_BY_WIDGET_ID[widget.id] ?? "stack";

  const resolveAction = (event: React.PointerEvent<HTMLElement>): TransformAction | "" => {
    if (!editMode || !canHide) {
      return "";
    }

    const control = event.target instanceof Element ? event.target.closest("[data-widget-transform-control]") : null;
    const controlAction = control?.getAttribute("data-widget-transform-control") ?? "";
    if (controlAction === "resize" || controlAction === "rotate") {
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

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const action = resolveAction(event);
    const article = articleRef.current;
    if (!action || !article) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startRect = article.getBoundingClientRect();
    const startTransform = resolveStageTransform(widgetSlot, transform);
    const startPointer = { x: event.clientX, y: event.clientY };
    const startCenter = {
      x: startRect.left + startRect.width / 2,
      y: startRect.top + startRect.height / 2,
    };
    const startAngle = Math.atan2(startPointer.y - startCenter.y, startPointer.x - startCenter.x) * 180 / Math.PI;
    let draftTransform = startTransform;

    const onPointerMove = (moveEvent: PointerEvent) => {
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
          width: Math.min(520, Math.max(180, (startTransform.width ?? startRect.width) + diagonalDelta)),
        };
      } else if (action === "rotate") {
        const currentAngle = Math.atan2(moveEvent.clientY - startCenter.y, moveEvent.clientX - startCenter.x) * 180 / Math.PI;
        draftTransform = {
          ...startTransform,
          rotation: Math.min(25, Math.max(-25, (startTransform.rotation ?? 0) + currentAngle - startAngle)),
        };
      }

      draftTransform = sanitizeStageTransform(draftTransform) as WidgetStageTransform;
      onTransformDraft(draftTransform);
    };

    const pointerId = event.pointerId;
    const onPointerUp = () => {
      setTransforming(false);
      article.releasePointerCapture?.(pointerId);
      document.removeEventListener("pointermove", onPointerMove);
      onTransformCommit(draftTransform);
    };

    setTransforming(true);
    article.setPointerCapture?.(pointerId);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  };

  return (
    <article
      ref={articleRef}
      className={`ui-note-card homepage-widget-card${transforming ? " is-widget-transforming" : ""}`}
      data-widget-id={widget.id}
      data-widget-slot={widgetSlot}
      data-widget-transformable={canHide || undefined}
      data-widget-editing={editMode}
      style={createStageTransformStyle(widgetSlot, transform)}
      onPointerDown={handlePointerDown}
    >
      <div className="homepage-widget-card-header">
        <h2 className="homepage-widget-card-title">{widget.title}</h2>
        <div className="homepage-widget-card-ornament" aria-hidden="true">
          {widget.id === "quicksites" ? <img className="widget-note__sticker" src={newtabAssets.quicksitesSticker} alt="" /> : null}
          {widget.id === "calendar" ? <img className="widget-note__sticker" src={newtabAssets.calendarSticker} alt="" /> : null}
        </div>
        <div className="homepage-widget-card-actions">
          {canHide ? (
            <button className="ui-btn-icon homepage-widget-action" data-widget-action="hide" type="button" aria-label={`隐藏${widget.title}`} disabled={!editMode} tabIndex={editMode ? 0 : -1} aria-hidden={!editMode} onClick={onHide}>x</button>
          ) : null}
        </div>
      </div>
      <div className="homepage-widget-card-body">{children}</div>
      {canHide ? (
        <>
          <button
            className="widget-transform-control widget-transform-control--rotate"
            data-widget-transform-control="rotate"
            type="button"
            aria-label={`旋转${widget.title}`}
            title="旋转"
            disabled={!editMode}
            tabIndex={editMode ? 0 : -1}
            aria-hidden={!editMode}
          >
            ↻
          </button>
          <button
            className="widget-transform-control widget-transform-control--resize"
            data-widget-transform-control="resize"
            type="button"
            aria-label={`调整${widget.title}大小`}
            title="调整大小"
            disabled={!editMode}
            tabIndex={editMode ? 0 : -1}
            aria-hidden={!editMode}
          >
            ◢
          </button>
        </>
      ) : null}
    </article>
  );
}

function QuickSitesWidget() {
  const quicksites = [
    { label: "GitHub", href: "https://github.com/" },
    { label: "B站", href: "https://www.bilibili.com/" },
    { label: "少数派", href: "https://sspai.com/" },
    { label: "Figma", href: "https://www.figma.com/" },
  ];
  return (
    <section className="widget-note widget-note--quicksites widget-quicksites">
      <div className="widget-note__list widget-chip-list">
        {quicksites.map((site) => <a className="widget-chip" href={site.href} target="_blank" rel="noreferrer" key={site.href}>{site.label}</a>)}
      </div>
    </section>
  );
}

function CalendarWidget() {
  const entries = [
    { label: "今天", value: "15:30 设计评审" },
    { label: "明天", value: "整理侧栏文案" },
    { label: "周末", value: "把灵感站点收进收藏夹" },
  ];
  return (
    <section className="widget-note widget-note--calendar">
      <div className="widget-note__list widget-note-list">
        {entries.map((entry) => (
          <div className="widget-note-item" key={entry.label}>
            <p className="widget-note-label">{entry.label}</p>
            <p className="widget-note-value">{entry.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
