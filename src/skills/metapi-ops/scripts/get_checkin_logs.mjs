import { metapiRequest } from "./_common.mjs";

const limit = process.argv[2] || "100";
metapiRequest("GET", `/api/checkin/logs?limit=${encodeURIComponent(limit)}`);
