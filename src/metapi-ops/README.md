# Metapi Ops

本地 Metapi 管理端运维能力：**API 请求走扩展后台 fetch / 同目录脚本 curl**，不走浏览器发管理 API。

浏览器自动化只用于中转站页面取证：
- 个人资料 → 安全 → 访问令牌
- 头像旁用户 ID

## 布局

```text
src/metapi-ops/
  README.md
  playbooks/register_relay_site.json   # skill 剧本（与扩展 builtin playbook 同步）
  scripts/                             # 同接口 curl 脚本，便于本地调试
    _common.mjs
    list_sites.mjs
    detect_site.mjs
    create_site.mjs
    verify_token.mjs
    create_account.mjs
```

扩展内实现：
- 共享逻辑：`src/shared/metapiAdmin.ts`
- 后台工具：`src/background/metapiToolRuntime.ts`（`metapi.*` tools）
- 策略注册：`src/shared/automationPlaybooks.ts` → `register_relay_site`
- 斜杠命令：`/收录中转站 ...`（ChatComposer）

## 环境变量（脚本）

```bash
export METAPI_ADMIN_BASE_URL=http://127.0.0.1:4000
export METAPI_AUTH_TOKEN=your_admin_token
```

扩展内用工具 `metapi_configure` 写入本地 storage。

## 收录流程

```text
/收录中转站 gpt(name) 开启系统代理
→ URL = 当前页
→ metapi_list_sites / create_site（已存在则 SITE_EXISTS 停止）
→ 浏览器只负责取系统访问令牌 + 用户ID
→ metapi_verify_account_token
→ metapi_create_account  (POST /api/accounts)
```
