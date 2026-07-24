import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AiSearchPreviewModel, SearchTarget, StatusMessage, SuggestionItem } from "./types";

interface SearchPanelProps {
  query: string;
  currentTarget: SearchTarget;
  targets: SearchTarget[];
  suggestions: SuggestionItem[];
  aiEnabled: boolean;
  aiPending: boolean;
  aiActivating: boolean;
  status: StatusMessage;
  preview: AiSearchPreviewModel | null;
  onQueryChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onTargetChange: (target: SearchTarget) => void;
  onToggleAi: () => void;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
  onRunSuggestion: (item: SuggestionItem) => void;
}

export function SearchPanel({
  query,
  currentTarget,
  targets,
  suggestions,
  aiEnabled,
  aiPending,
  aiActivating,
  status,
  preview,
  onQueryChange,
  onSubmit,
  onTargetChange,
  onToggleAi,
  onOpenSettings,
  onOpenSidebar,
  onRunSuggestion,
}: SearchPanelProps) {
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [dismissedSuggestionsQuery, setDismissedSuggestionsQuery] = useState("");
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchFrameRef = useRef<HTMLDivElement | null>(null);
  const searchOutlineRef = useRef<SVGSVGElement | null>(null);
  const searchOutlineRectRef = useRef<SVGRectElement | null>(null);

  const syncSearchOutline = useCallback((complete = false) => {
    const frame = searchFrameRef.current;
    const outline = searchOutlineRef.current;
    const outlineRect = searchOutlineRectRef.current;
    if (!frame || !outline || !outlineRect) {
      return 0;
    }

    const rect = frame.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const strokeWidth = 1;
    const inset = 0;
    const halfStroke = strokeWidth / 2;
    const frameStyles = window.getComputedStyle(frame);
    const frameRadius = Number.parseFloat(frameStyles.borderTopLeftRadius) || 0;
    const x = inset + halfStroke;
    const y = inset + halfStroke;
    const outlineWidth = Math.max(1, width - inset * 2 - strokeWidth);
    const outlineHeight = Math.max(1, height - inset * 2 - strokeWidth);
    const radius = Math.max(0, frameRadius - inset - halfStroke);

    outline.setAttribute("viewBox", `0 0 ${width} ${height}`);
    outlineRect.style.strokeWidth = String(strokeWidth);
    outlineRect.setAttribute("x", String(x));
    outlineRect.setAttribute("y", String(y));
    outlineRect.setAttribute("width", String(outlineWidth));
    outlineRect.setAttribute("height", String(outlineHeight));
    outlineRect.setAttribute("rx", String(radius));
    outlineRect.setAttribute("ry", String(radius));

    const length = outlineRect.getTotalLength();
    outlineRect.style.strokeDasharray = `${length}`;
    outlineRect.style.strokeDashoffset = complete ? "0" : `${length}`;
    return length;
  }, []);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let animationFrameId = 0;
    let outlineAnimation: Animation | null = null;

    const focusSearchInputIfIdle = () => {
      const input = inputRef.current;
      if (!input || input.disabled) {
        return;
      }

      const activeElement = document.activeElement;
      const shouldFocus = !activeElement || activeElement === document.body || activeElement === document.documentElement;
      if (shouldFocus) {
        input.focus({ preventScroll: true });
      }
    };

    const completeStartup = () => {
      if (disposed) {
        return;
      }
      document.body.classList.add("is-ready");
      window.requestAnimationFrame(focusSearchInputIfIdle);
    };

    document.body.classList.remove("is-search-enhancing");
    const initialLength = syncSearchOutline(prefersReducedMotion.matches);
    if (prefersReducedMotion.matches || !initialLength) {
      completeStartup();
    } else {
      animationFrameId = window.requestAnimationFrame(() => {
        const length = syncSearchOutline(false);
        const outlineRect = searchOutlineRectRef.current;
        if (!length || !outlineRect?.animate) {
          syncSearchOutline(true);
          completeStartup();
          return;
        }

        outlineAnimation = outlineRect.animate(
          [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
          { duration: 1280, easing: "cubic-bezier(0.35, 0, 0.15, 1)" },
        );
        outlineAnimation.finished
          .then(() => {
            syncSearchOutline(true);
            completeStartup();
          })
          .catch(() => {
            syncSearchOutline(true);
            completeStartup();
          });
      });
    }

    const handleResize = () => {
      syncSearchOutline(true);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      outlineAnimation?.cancel();
      window.removeEventListener("resize", handleResize);
    };
  }, [syncSearchOutline]);

  useEffect(() => {
    setHighlightedSuggestionIndex(-1);
  }, [suggestions, suggestionsOpen]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || preview) {
      setSuggestionsOpen(false);
      setDismissedSuggestionsQuery("");
      return;
    }

    if (suggestions.length && normalizedQuery !== dismissedSuggestionsQuery) {
      setSuggestionsOpen(true);
    }
  }, [dismissedSuggestionsQuery, preview, query, suggestions.length]);

  useEffect(() => {
    if (!targetMenuOpen && !suggestionsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && formRef.current?.contains(event.target)) {
        return;
      }

      setTargetMenuOpen(false);
      setSuggestionsOpen(false);
      setDismissedSuggestionsQuery(query.trim());
      setHighlightedSuggestionIndex(-1);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [query, suggestionsOpen, targetMenuOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const suggestionsVisible = suggestionsOpen && suggestions.length > 0 && !targetMenuOpen;
    if (event.key === "ArrowDown" && suggestionsVisible) {
      event.preventDefault();
      setHighlightedSuggestionIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp" && suggestionsVisible) {
      event.preventDefault();
      setHighlightedSuggestionIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }

    if (event.key === "Tab" && suggestionsVisible) {
      const highlightedSuggestion = suggestions[highlightedSuggestionIndex];
      if (highlightedSuggestion?.type === "query") {
        event.preventDefault();
        onQueryChange(highlightedSuggestion.query);
      }
      return;
    }

    if (event.key === "Enter" && suggestionsVisible && highlightedSuggestionIndex >= 0) {
      const highlightedSuggestion = suggestions[highlightedSuggestionIndex];
      if (highlightedSuggestion) {
        event.preventDefault();
        onRunSuggestion(highlightedSuggestion);
      }
      return;
    }

    if (event.key === "Escape") {
      if (targetMenuOpen || suggestionsVisible) {
        setTargetMenuOpen(false);
        setSuggestionsOpen(false);
        setDismissedSuggestionsQuery(query.trim());
        setHighlightedSuggestionIndex(-1);
        return;
      }

      onQueryChange("");
      setTargetMenuOpen(false);
      setSuggestionsOpen(false);
    }
  };

  const suggestionGroups = [
    {
      id: "queries",
      label: "搜索建议",
      items: suggestions.filter((item) => item.type === "query"),
    },
    {
      id: "actions",
      label: "快捷操作",
      items: suggestions.filter((item) => item.type === "action"),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <section className="homepage-search-stack">
      <form ref={formRef} className="outline-search-form widget-search-shell" autoComplete="off" onSubmit={(event) => { event.preventDefault(); onSubmit(query); }}>
        <label className="visually-hidden" htmlFor="search-input">输入内容并搜索或打开</label>
          <div ref={searchFrameRef} className="outline-search-frame ui-input-shell">
            <svg ref={searchOutlineRef} className="outline-search-outline" aria-hidden="true" focusable="false">
              <rect ref={searchOutlineRectRef} className="outline-search-outline-rect" />
            </svg>
            <div className="outline-search-frame-inner">
            <div className="search-control-rail widget-search-shell__top">
              <button
                id="search-target-trigger"
                type="button"
                className="search-target-trigger"
                aria-haspopup="listbox"
                aria-expanded={targetMenuOpen}
                aria-controls="search-target-menu"
                onClick={() => setTargetMenuOpen((value) => !value)}
              >
                <span className="search-target-chip-label">目标</span>
                <span id="search-target-label">{currentTarget.label}</span>
              </button>
              <div className="search-shell-actions" role="group" aria-label="搜索操作">
                <button id="ai-toggle-btn" type="button" className="ai-toggle-btn ui-btn-primary" aria-label="切换AI增强搜索" aria-pressed={aiEnabled} onClick={onToggleAi}>
                  <span className="ai-toggle-icon" aria-hidden="true">AI</span>
                </button>
                <button type="button" className="ui-btn-secondary" onClick={onOpenSidebar}>AI 侧栏</button>
                <button type="button" className="ui-btn-secondary" onClick={onOpenSettings}>设置</button>
              </div>
            </div>

            <div className="search-main-row">
              <div className="search-input-stack widget-search-shell__input">
                <input
                  ref={inputRef}
                  id="search-input"
                  name="q"
                  type="search"
                  placeholder="例如：设计灵感、github.com、今天适合看的东西"
                  value={query}
                  disabled={aiPending}
                  onChange={(event) => onQueryChange(event.currentTarget.value)}
                  onFocus={() => {
                    if (suggestions.length) {
                      setSuggestionsOpen(true);
                      setDismissedSuggestionsQuery("");
                    }
                  }}
                  onKeyDown={handleKeyDown}
                />
                <p className="search-input-hint">支持直接打开网址，也支持 AI 先帮你整理搜索方向。</p>
              </div>
            </div>
          </div>
        </div>

        <div className="search-ai-status-line">
          <p id="search-status" className="search-status" role="status" aria-live="polite" data-tone={status.tone} hidden={!status.message}>
            {status.message}
          </p>
          <div id="ai-search-indicator" className="ai-search-indicator" role="status" aria-live="polite" data-state={aiPending ? "searching" : aiActivating ? "activating" : aiEnabled ? "ready" : "off"}>
            <span className="ai-search-indicator-dot" aria-hidden="true" />
            <span id="ai-search-indicator-text">
              {aiPending ? "AI 正在生成搜索方案…" : aiActivating ? "AI 搜索启用中…" : ""}
            </span>
          </div>
        </div>

        <div className="ai-loading-overlay" aria-hidden="true">
          <svg className="ai-loading-geometry" viewBox="0 0 720 12" preserveAspectRatio="none" role="presentation">
            <title>AI 搜索处理中</title>
            <line className="geo-track" x1="4" y1="6" x2="716" y2="6" />
            <line className="geo-scan" x1="-140" y1="6" x2="96" y2="6" />
            <circle className="geo-node geo-node-1" cx="240" cy="6" r="2" />
            <circle className="geo-node geo-node-2" cx="480" cy="6" r="2" />
          </svg>
        </div>

        {targetMenuOpen ? (
          <div id="search-target-menu" className="search-target-menu" role="listbox">
            <div className="search-target-menu-group" role="presentation">
              <p className="search-dropdown-group-label">搜索目标</p>
              {targets.map((target) => (
                <button
                  type="button"
                  className="search-target-menu-item"
                  data-target-id={target.id}
                  role="option"
                  aria-selected={target.id === currentTarget.id}
                  key={target.id}
                  onClick={() => {
                    onTargetChange(target);
                    setTargetMenuOpen(false);
                  }}
                >
                  {target.label}
                </button>
              ))}
            </div>
          </div>
        ) : suggestionsOpen && suggestions.length ? (
          <div id="search-suggestions" className="search-suggestions">
            {suggestionGroups.map((group) => (
              <div className="search-suggestions-group" data-group-id={group.id} role="presentation" key={group.id}>
                <p className="search-dropdown-group-label">{group.label}</p>
                {group.items.map((item) => {
                  const suggestionIndex = suggestions.indexOf(item);
                  return (
                    <button
                      key={`${item.type}:${item.label}:${item.targetId ?? ""}`}
                      type="button"
                      className="search-suggestion-item"
                      data-type={item.type}
                      data-highlighted={suggestionIndex === highlightedSuggestionIndex}
                      aria-selected={suggestionIndex === highlightedSuggestionIndex}
                      onClick={() => {
                        setSuggestionsOpen(false);
                        setDismissedSuggestionsQuery(query.trim());
                        onRunSuggestion(item);
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </form>
    </section>
  );
}
