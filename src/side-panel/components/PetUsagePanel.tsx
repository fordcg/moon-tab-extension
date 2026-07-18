import { useMemo, useState } from "react";
import type { ChatSession } from "../../shared/types";
import { buildPetUsageSummary } from "../../shared/pet/usageSummary";
import { formatTokenCount, formatUsd } from "../../shared/pet/pricing";

interface PetUsagePanelProps {
  sessions: ChatSession[];
  activeSessionId?: string;
  onClose: () => void;
}

export function PetUsagePanel({ sessions, activeSessionId, onClose }: PetUsagePanelProps) {
  const [view, setView] = useState<"hours" | "models">("hours");
  const summary = useMemo(() => buildPetUsageSummary({ sessions }), [sessions]);
  const active = sessions.find((session) => session.id === activeSessionId);

  return (
    <div className="pet-usage-overlay" role="presentation" onClick={onClose}>
      <section
        className="pet-usage-panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI 伴侣用量"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pet-usage-header">
          <div className="pet-usage-brand">
            <span className="pet-usage-logo" aria-hidden="true">
              🐱
            </span>
            <div>
              <div className="pet-usage-title">AI 伴侣</div>
              <div className="pet-usage-sub">
                {active?.title ? `${active.title}` : "等待会话…"}
              </div>
            </div>
          </div>
          <button type="button" className="pet-usage-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <section className="pet-usage-grid">
          <div className="pet-usage-stat">
            <div className="pet-usage-stat-label">今日花费</div>
            <div className="pet-usage-stat-value">{formatUsd(summary.today.costUsd)}</div>
            <div className="pet-usage-stat-foot">{formatTokenCount(summary.today.tokens)} tokens</div>
          </div>
          <div className="pet-usage-stat">
            <div className="pet-usage-stat-label">近 5 小时</div>
            <div className="pet-usage-stat-value">{formatUsd(summary.window5h.costUsd)}</div>
            <div className="pet-usage-stat-foot">{formatTokenCount(summary.window5h.tokens)} tok</div>
          </div>
        </section>

        <section className="pet-usage-block">
          <div className="pet-usage-block-title">
            <span>用量明细</span>
            <span className="pet-usage-tabs">
              <button
                type="button"
                className={view === "hours" ? "is-active" : ""}
                onClick={() => setView("hours")}
              >
                Token
              </button>
              <button
                type="button"
                className={view === "models" ? "is-active" : ""}
                onClick={() => setView("models")}
              >
                按模型
              </button>
            </span>
          </div>
          {view === "hours" ? (
            <div className="pet-usage-rows">
              <div className="pet-usage-row">
                <span>输入</span>
                <b>{formatTokenCount(summary.today.usage.inputTokens)}</b>
              </div>
              <div className="pet-usage-row">
                <span>输出</span>
                <b>{formatTokenCount(summary.today.usage.outputTokens)}</b>
              </div>
              <div className="pet-usage-row">
                <span>缓存写入</span>
                <b>{formatTokenCount(summary.today.usage.cacheWriteTokens)}</b>
              </div>
              <div className="pet-usage-row">
                <span>缓存读取</span>
                <b>{formatTokenCount(summary.today.usage.cacheReadTokens)}</b>
              </div>
              <div className="pet-usage-row is-total">
                <span>消息轮次</span>
                <b>{summary.totalMessages}</b>
              </div>
            </div>
          ) : (
            <div className="pet-usage-rows">
              {summary.byModel.length === 0 ? (
                <div className="pet-usage-empty">暂无模型用量</div>
              ) : (
                summary.byModel.map((row) => (
                  <div className="pet-usage-row" key={row.modelId}>
                    <span title={row.modelId}>{shortModel(row.modelId)}</span>
                    <b>
                      {formatUsd(row.costUsd)} · {formatTokenCount(row.tokens)}
                    </b>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        <section className="pet-usage-block">
          <div className="pet-usage-block-title">
            <span>会话</span>
          </div>
          <div className="pet-usage-rows">
            {summary.sessions.length === 0 ? (
              <div className="pet-usage-empty">暂无活跃会话用量</div>
            ) : (
              summary.sessions.map((row) => (
                <div
                  className={`pet-usage-row${row.sessionId === activeSessionId ? " is-active" : ""}`}
                  key={row.sessionId}
                >
                  <span title={row.title}>{row.title}</span>
                  <b>
                    {formatUsd(row.costUsd)} · {formatTokenCount(row.tokens)}
                  </b>
                </div>
              ))
            )}
          </div>
        </section>

        <p className="pet-usage-footnote">花费按本地估算单价计算，仅供参考。</p>
      </section>
    </div>
  );
}

function shortModel(modelId: string): string {
  if (!modelId) {
    return "unknown";
  }
  if (modelId.length <= 28) {
    return modelId;
  }
  return `${modelId.slice(0, 12)}…${modelId.slice(-10)}`;
}
