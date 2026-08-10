import assert from "node:assert/strict";

const sourceRows = Array.from({ length: 5 }, (_, id) => ({ id }));
const requestedOffsets = [];
let inFlight = 0;
let maxInFlight = 0;

globalThis.fetch = async (url) => {
  const requestUrl = new URL(url);
  const offset = Number(requestUrl.searchParams.get("offset") || 0);
  const limit = Number(requestUrl.searchParams.get("limit") || 1000);
  requestedOffsets.push(offset);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 20));
  inFlight -= 1;
  return new Response(JSON.stringify(sourceRows.slice(offset, offset + limit)), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const { fetchSupabaseTablePaged } = await import(`../assets/js/tide_data.js?test=${Date.now()}`);
const rows = await fetchSupabaseTablePaged("test_rows", "select=id", 2);

assert.deepEqual(rows, sourceRows);
assert.deepEqual(requestedOffsets, [0, 2, 4]);
assert.equal(maxInFlight, 2, "subsequent pages should use bounded concurrency");

console.log("tide_data_paging.test.js passed");
