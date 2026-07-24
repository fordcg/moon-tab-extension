import type { AiSearchPreviewModel } from "./types";

interface AiPreviewPanelProps {
  preview: AiSearchPreviewModel | null;
  onAction: (action: AiSearchPreviewModel["primaryAction"]) => void;
  onWebsiteOpen: (url: string) => void;
}

export function AiPreviewPanel({ preview, onAction, onWebsiteOpen }: AiPreviewPanelProps) {
  if (!preview) {
    return null;
  }

  const relatedVisible = preview.relatedQueries.length > 0 && preview.websites.length === 0;

  return (
    <section id="ai-search-preview" className="ai-search-preview" aria-live="polite">
      <div className="ai-search-preview-content">
        <div className="ai-search-preview-header">
          <div className="ai-search-preview-header-copy">
            <p className="ai-search-preview-kicker">AI 便签</p>
            {preview.intent ? <p id="ai-search-preview-intent" className="ai-search-preview-intent">{preview.intent}</p> : null}
          </div>
        </div>

        <p id="ai-search-preview-summary" className="ai-search-preview-summary">{preview.summary}</p>

        <div className="ai-search-preview-query-map">
          <div className="ai-search-preview-query-item">
            <p className="ai-search-preview-target-label">原始输入</p>
            <p id="ai-search-preview-original-query" className="ai-search-preview-target">{preview.originalQuery}</p>
          </div>
          <div className="ai-search-preview-query-item">
            <p id="ai-search-preview-target-label" className="ai-search-preview-target-label">{preview.targetLabel}</p>
            <p id="ai-search-preview-target" className="ai-search-preview-target">{preview.target}</p>
          </div>
        </div>

        <div className="ai-search-preview-actions">
          <button id="ai-search-preview-action" className="ai-search-preview-button" type="button" onClick={() => onAction(preview.primaryAction)}>
            {preview.primaryAction.label}
          </button>
          {preview.secondaryAction ? (
            <button
              id="ai-search-preview-secondary-action"
              className="ai-search-preview-button ai-search-preview-button-secondary"
              type="button"
              onClick={() => onAction(preview.secondaryAction!)}
            >
              {preview.secondaryAction.label}
            </button>
          ) : null}
        </div>

        {preview.websites.length ? (
          <details id="ai-search-preview-websites" className="ai-search-preview-related ai-search-preview-websites">
            <summary className="ai-search-preview-related-summary">
              <span id="ai-search-preview-websites-label" className="ai-search-preview-related-label">候选网站（{preview.websites.length}）</span>
            </summary>
            <div id="ai-search-preview-websites-list" className="ai-search-preview-websites-list">
              {preview.websites.map((website) => (
                <article className="ai-search-preview-website-card" key={`${website.url}-${website.title}`}>
                  <div className="ai-search-preview-website-header">
                    <div>
                      <h3 className="ai-search-preview-website-title">{website.title}</h3>
                      <p className="ai-search-preview-website-host">{website.host || website.url}</p>
                    </div>
                    <button className="ai-search-preview-website-button" type="button" onClick={() => onWebsiteOpen(website.url)}>
                      新标签页打开
                    </button>
                  </div>
                  <p className="ai-search-preview-website-description">{website.description || "在新标签页打开该站点。"}</p>
                </article>
              ))}
            </div>
          </details>
        ) : null}

        {relatedVisible ? (
          <section id="ai-search-preview-related" className="ai-search-preview-related">
            <p className="ai-search-preview-related-label">相关搜索</p>
            <div id="ai-search-preview-suggestions" className="ai-search-preview-suggestions">
              {preview.relatedQueries.map((query) => (
                <button className="ai-search-preview-suggestion" type="button" key={query} onClick={() => onAction({ type: "search", target: query, label: query })}>
                  {query}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
