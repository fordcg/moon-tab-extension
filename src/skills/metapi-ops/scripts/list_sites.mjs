import { metapiRequest } from "./_common.mjs";

const url = process.argv[2];
metapiRequest("GET", url ? `/api/sites` : "/api/sites");
// If url provided, still returns full list; filter client-side for debugging.
if (url) {
  // no-op: list endpoint has no server filter; consumer matches url
}
