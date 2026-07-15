import { spawnSync } from "node:child_process";

export function envConfig() {
  const baseUrl = (process.env.METAPI_ADMIN_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
  const authToken = process.env.METAPI_AUTH_TOKEN || "";
  if (!authToken) {
    console.error("缺少环境变量 METAPI_AUTH_TOKEN");
    process.exit(1);
  }
  return { baseUrl, authToken };
}

export function metapiRequest(method, path, body) {
  const { baseUrl, authToken } = envConfig();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const args = [
    "-sS",
    "-X",
    method,
    "-H",
    `Authorization: Bearer ${authToken}`,
    "-H",
    "Accept: application/json",
  ];
  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  }
  args.push(url);
  const result = spawnSync("curl", args, { encoding: "utf8" });
  if (result.error) {
    console.error(String(result.error));
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(result.stderr || `curl exit ${result.status}`);
    process.exit(result.status || 1);
  }
  const text = (result.stdout || "").trim();
  try {
    const json = text ? JSON.parse(text) : null;
    console.log(JSON.stringify(json, null, 2));
    return json;
  } catch {
    console.log(text);
    return text;
  }
}
