import { metapiRequest } from "./_common.mjs";

function parseArgs(argv) {
  const out = { useSystemProxy: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--proxy") out.useSystemProxy = true;
    else if (a.startsWith("--name=")) out.name = a.slice("--name=".length);
    else if (a.startsWith("--url=")) out.url = a.slice("--url=".length);
    else if (a.startsWith("--platform=")) out.platform = a.slice("--platform=".length);
    else if (!out.url && /^https?:\/\//.test(a)) out.url = a;
    else if (!out.name) out.name = a;
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.name || !args.url) {
  console.error("用法: node create_site.mjs --name=站名 --url=https://... [--platform=new-api] [--proxy]");
  process.exit(1);
}
const body = {
  name: args.name,
  url: args.url,
};
if (args.platform) body.platform = args.platform;
if (args.useSystemProxy) body.useSystemProxy = true;
metapiRequest("POST", "/api/sites", body);
