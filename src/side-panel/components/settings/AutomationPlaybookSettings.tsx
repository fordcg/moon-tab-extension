import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  getRegisteredAutomationPlaybooks,
} from "../../../shared/automationPlaybooks";
import { getSkillPlaybooks } from "../../../skills/loadSkills";
import type {
  AutomationPlaybookRisk,
  AutomationPlaybookSource,
  ImportedAutomationPlaybook,
} from "../../../shared/types";
import { useAppStore } from "../../state/appStore";
import { MetapiAdminSettingsPanel } from "./MetapiAdminSettings";

const sourceLabels: Record<AutomationPlaybookSource, string> = {
  builtin: "内置策略",
  skill: "Skill 策略",
  user: "我的策略",
};

const riskLabels: Record<AutomationPlaybookRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "最高风险",
};

export function AutomationPlaybookSettings() {
  const settings = useAppStore((state) => state.automationPlaybookSettings);
  const importedSkillPlaybooks = useAppStore((state) => state.importedSkillPlaybooks);
  const metapiAdminSettings = useAppStore((state) => state.metapiAdminSettings);
  const updateAutomationPlaybookSettings = useAppStore((state) => state.updateAutomationPlaybookSettings);
  const importSkillPlaybooksFromJson = useAppStore((state) => state.importSkillPlaybooksFromJson);
  const removeImportedSkillPlaybook = useAppStore((state) => state.removeImportedSkillPlaybook);
  const addNotification = useAppStore((state) => state.addNotification);
  const [expandedPlaybookIds, setExpandedPlaybookIds] = useState<Set<string>>(() => new Set());
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disabledIds = new Set(settings.disabledPlaybookIds);

  // Core builtins only — skill packages and imported JSON live under "Skill 策略".
  const skillPackagePlaybooks = getSkillPlaybooks();
  const skillPackageIds = new Set(skillPackagePlaybooks.map((playbook) => playbook.id));
  const builtinPlaybooks = getRegisteredAutomationPlaybooks().filter(
    (playbook) => playbook.source === "builtin" && !skillPackageIds.has(playbook.id),
  );
  const skillPlaybooks = [
    ...skillPackagePlaybooks,
    ...importedSkillPlaybooks.filter((playbook) => !skillPackageIds.has(playbook.id)),
  ];
  const metapiConfigured = Boolean(metapiAdminSettings.authToken);

  const handleToggle = (playbookId: string, checked: boolean) => {
    const nextIds = checked
      ? settings.disabledPlaybookIds.filter((id) => id !== playbookId)
      : Array.from(new Set([...settings.disabledPlaybookIds, playbookId]));
    void updateAutomationPlaybookSettings({ disabledPlaybookIds: nextIds });
  };

  const handleToggleDetails = (playbookId: string) => {
    setExpandedPlaybookIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(playbookId)) {
        nextIds.delete(playbookId);
      } else {
        nextIds.add(playbookId);
      }
      return nextIds;
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setImporting(true);
    try {
      const text = await file.text();
      const result = await importSkillPlaybooksFromJson(text);
      if (!result.ok) {
        setImportError(result.message);
        return;
      }
      setImportError("");
      addNotification({
        type: "success",
        title: "Skill 策略已导入",
        message: `已导入 ${result.importedCount} 条 Skill 策略`,
      });
    } catch {
      setImportError("无法读取文件");
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="grid w-full gap-3" aria-label="任务策略">
      <h3 className="text-base font-semibold">任务策略</h3>
      <div className="grid gap-2">
        <div className="ui-panel grid gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>内置策略</span>
            <span className="ui-muted text-xs">系统核心策略，仅支持启用或禁用</span>
          </div>
          <div className="grid gap-2">
            {builtinPlaybooks.map((playbook) => (
              <PlaybookCard
                key={playbook.id}
                playbook={playbook}
                enabled={!disabledIds.has(playbook.id)}
                detailsExpanded={expandedPlaybookIds.has(playbook.id)}
                onToggle={(checked) => handleToggle(playbook.id, checked)}
                onToggleDetails={() => handleToggleDetails(playbook.id)}
              />
            ))}
          </div>
        </div>

        <div className="ui-panel grid gap-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-0.5">
              <h4 className="text-sm font-semibold">Skill 策略</h4>
              <p className="ui-muted text-xs">
                包含扩展内 skill 包（如 Metapi 运维）和你导入的 JSON 策略
              </p>
            </div>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              onClick={handleImportClick}
              disabled={importing}
            >
              导入 JSON
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              aria-label="导入 Skill 策略 JSON 文件"
              onChange={(event) => {
                void handleImportFile(event);
              }}
            />
          </div>

          {importError ? (
            <p className="text-xs text-red-600" role="alert">
              {importError}
            </p>
          ) : null}

          {skillPlaybooks.length === 0 ? (
            <p className="ui-muted text-xs">暂无 Skill 策略。可导入 JSON，或安装 skill 包。</p>
          ) : (
            <div className="grid gap-2">
              {skillPlaybooks.map((playbook) => {
                const isImported = importedSkillPlaybooks.some((item) => item.id === playbook.id);
                const showMetapiConfig = playbook.id === "register_relay_site";
                return (
                  <PlaybookCard
                    key={playbook.id}
                    playbook={playbook}
                    enabled={!disabledIds.has(playbook.id)}
                    detailsExpanded={expandedPlaybookIds.has(playbook.id)}
                    onToggle={(checked) => handleToggle(playbook.id, checked)}
                    onToggleDetails={() => handleToggleDetails(playbook.id)}
                    onDelete={
                      isImported
                        ? () => {
                            void removeImportedSkillPlaybook(playbook.id);
                          }
                        : undefined
                    }
                    footerBadge={
                      showMetapiConfig
                        ? metapiConfigured
                          ? "Metapi 已配置"
                          : "Metapi 未配置"
                        : undefined
                    }
                    extraDetails={
                      showMetapiConfig ? (
                        <div className="grid gap-2 border-t border-slate-200 pt-3">
                          <MetapiAdminSettingsPanel compact />
                        </div>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="ui-panel grid gap-2 p-3">
          <h4 className="text-sm font-semibold">我的策略</h4>
          <p className="ui-muted text-xs">暂未开放。第一版不支持编辑、克隆或用户自建 Playbook。</p>
        </div>
      </div>
    </section>
  );
}

interface PlaybookCardProps {
  playbook: {
    id: string;
    title: string;
    description: string;
    tags: string[];
    source: AutomationPlaybookSource;
    defaultEnabled: boolean;
    risk: AutomationPlaybookRisk;
    recommendedCapabilities: string[];
    selectionHints: string[];
    prompt: string;
  } | ImportedAutomationPlaybook;
  enabled: boolean;
  detailsExpanded: boolean;
  onToggle: (checked: boolean) => void;
  onToggleDetails: () => void;
  onDelete?: () => void;
  footerBadge?: string;
  extraDetails?: ReactNode;
}

function PlaybookCard({
  playbook,
  enabled,
  detailsExpanded,
  onToggle,
  onToggleDetails,
  onDelete,
  footerBadge,
  extraDetails,
}: PlaybookCardProps) {
  return (
    <article className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h4 className="text-sm font-semibold">{playbook.title}</h4>
          <p className="ui-muted text-xs">{playbook.description}</p>
        </div>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            aria-label={`启用任务策略 ${playbook.title}`}
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">{enabled ? "已启用" : "已禁用"}</span>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-slate-200 px-2 py-1">{sourceLabels[playbook.source]}</span>
        <span className="rounded border border-slate-200 px-2 py-1">{riskLabels[playbook.risk]}</span>
        {footerBadge ? (
          <span className="rounded border border-slate-200 px-2 py-1">{footerBadge}</span>
        ) : null}
        {playbook.recommendedCapabilities.map((capability) => (
          <span key={capability} className="rounded border border-slate-200 px-2 py-1">{capability}</span>
        ))}
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          aria-expanded={detailsExpanded}
          aria-label={`${detailsExpanded ? "收起" : "查看"}任务策略 ${playbook.title} 详细信息`}
          onClick={onToggleDetails}
        >
          {detailsExpanded ? "收起" : "详细"}
        </button>
        {onDelete ? (
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
            aria-label={`删除任务策略 ${playbook.title}`}
            onClick={onDelete}
          >
            删除
          </button>
        ) : null}
      </div>
      {detailsExpanded ? (
        <div
          className="mt-3 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs"
          role="region"
          aria-label={`${playbook.title}详细信息`}
        >
          {extraDetails}
          <dl className="grid gap-2">
            <div className="grid gap-1">
              <dt className="font-medium">策略 ID</dt>
              <dd className="ui-muted break-all">{playbook.id}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">来源</dt>
              <dd className="ui-muted">{sourceLabels[playbook.source]}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">风险</dt>
              <dd className="ui-muted">{riskLabels[playbook.risk]}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">默认启用</dt>
              <dd className="ui-muted">{playbook.defaultEnabled ? "是" : "否"}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">标签</dt>
              <dd className="flex flex-wrap gap-1">
                {playbook.tags.map((tag) => (
                  <span key={tag} className="rounded border border-slate-200 bg-white px-2 py-1">{tag}</span>
                ))}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">推荐能力</dt>
              <dd className="flex flex-wrap gap-1">
                {playbook.recommendedCapabilities.map((capability) => (
                  <span key={capability} className="rounded border border-slate-200 bg-white px-2 py-1">{capability}</span>
                ))}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium">适用提示</dt>
              <dd className="flex flex-wrap gap-1">
                {playbook.selectionHints.map((hint) => (
                  <span key={hint} className="rounded border border-slate-200 bg-white px-2 py-1">{hint}</span>
                ))}
              </dd>
            </div>
          </dl>
          <div className="grid gap-1">
            <h5 className="font-medium">完整策略提示</h5>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700">
              {playbook.prompt}
            </pre>
          </div>
        </div>
      ) : null}
    </article>
  );
}
