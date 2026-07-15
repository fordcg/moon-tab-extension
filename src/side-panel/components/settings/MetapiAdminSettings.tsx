import { useAppStore } from "../../state/appStore";
import { useComposedTextInput } from "../useComposedTextInput";

export function MetapiAdminSettingsPanel() {
  const metapiAdminSettings = useAppStore((state) => state.metapiAdminSettings);
  const updateMetapiAdminSettings = useAppStore((state) => state.updateMetapiAdminSettings);
  const addNotification = useAppStore((state) => state.addNotification);

  const baseUrlInput = useComposedTextInput(metapiAdminSettings.baseUrl, (baseUrl) => {
    void updateMetapiAdminSettings({ baseUrl });
  });
  const authTokenInput = useComposedTextInput(metapiAdminSettings.authToken, (authToken) => {
    void updateMetapiAdminSettings({ authToken });
  });

  return (
    <section className="grid w-full gap-3" aria-label="Metapi 管理端">
      <h3 className="text-base font-semibold">Metapi 管理端</h3>
      <p className="ui-muted text-xs">
        用于 `/收录中转站` 等运维命令调用本地 Metapi 管理 API。请求由扩展后台直接 fetch，不走浏览器页面。
      </p>
      <label className="grid gap-1 text-sm">
        <span>管理端地址</span>
        <input
          className="ui-input"
          type="text"
          aria-label="Metapi 管理端地址"
          placeholder="http://127.0.0.1:4000"
          value={baseUrlInput.value}
          onChange={baseUrlInput.onChange}
          onCompositionStart={baseUrlInput.onCompositionStart}
          onCompositionEnd={baseUrlInput.onCompositionEnd}
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span>管理令牌（METAPI_AUTH_TOKEN）</span>
        <input
          className="ui-input"
          type="password"
          aria-label="Metapi 管理令牌"
          placeholder="填写管理令牌"
          value={authTokenInput.value}
          onChange={authTokenInput.onChange}
          onCompositionStart={authTokenInput.onCompositionStart}
          onCompositionEnd={authTokenInput.onCompositionEnd}
          autoComplete="off"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ui-button-secondary rounded px-3 py-2 text-sm"
          onClick={() => {
            void updateMetapiAdminSettings({
              baseUrl: baseUrlInput.value.trim() || "http://127.0.0.1:4000",
              authToken: authTokenInput.value.trim(),
            }).then(() => {
              addNotification({
                type: "success",
                title: "Metapi 已保存",
                message: authTokenInput.value.trim()
                  ? "管理端地址和令牌已写入本地扩展存储"
                  : "管理端地址已保存；令牌为空，收录命令仍会要求配置",
              });
            });
          }}
        >
          保存
        </button>
        <span className="ui-muted text-xs">
          {metapiAdminSettings.authToken ? "令牌状态：已配置" : "令牌状态：未配置"}
        </span>
      </div>
    </section>
  );
}
