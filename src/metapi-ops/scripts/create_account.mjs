import { metapiRequest } from "./_common.mjs";

function parseArgs(argv) {
  const out = { credentialMode: "session", skipModelFetch: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--siteId=")) out.siteId = Number(a.slice("--siteId=".length));
    else if (a.startsWith("--token=")) out.accessToken = a.slice("--token=".length);
    else if (a.startsWith("--userId=")) out.platformUserId = Number(a.slice("--userId=".length));
    else if (a.startsWith("--mode=")) out.credentialMode = a.slice("--mode=".length);
    else if (a === "--skipModelFetch") out.skipModelFetch = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.siteId || !args.accessToken) {
  console.error("用法: node create_account.mjs --siteId=1 --token=... [--userId=209] [--mode=session] [--skipModelFetch]");
  process.exit(1);
}
const body = {
  siteId: args.siteId,
  accessToken: args.accessToken,
  credentialMode: args.credentialMode,
  skipModelFetch: args.skipModelFetch,
};
if (args.platformUserId) body.platformUserId = args.platformUserId;
// POST /api/accounts — same payload shape as Metapi UI "添加连接"
metapiRequest("POST", "/api/accounts", body);
