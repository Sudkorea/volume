import assert from "node:assert/strict";
import test from "node:test";
import { DcListClient, UpstreamError } from "../server/dc-client.js";
import { makeConfig } from "./helpers.js";

const validHtml = `
  <table><tr class="ub-content" data-no="10">
    <td class="gall_num">10</td>
    <td class="gall_tit"><a href="?id=volume&no=10">boost</a></td>
    <td class="gall_count">123</td>
  </tr></table>
`;

function htmlResponse(body, {
  url = "https://gall.dcinside.com/mgallery/board/lists/?id=volume&page=1",
  contentType = "text/html; charset=utf-8",
  contentLength,
} = {}) {
  const headers = { "Content-Type": contentType };
  if (contentLength !== undefined) headers["Content-Length"] = String(contentLength);
  const response = new Response(body, { headers });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

test("accepts a bounded DCInside HTML list and disables redirects", async () => {
  let options;
  const client = new DcListClient({
    fetchImpl: async (_url, received) => {
      options = received;
      return htmlResponse(validHtml);
    },
  });
  const rows = await client.fetchPage(makeConfig(), 1);
  assert.equal(rows.get(10).views, 123);
  assert.equal(options.redirect, "error");
});

test("does not let a user-controlled title mimic an access challenge", async () => {
  const html = validHtml.replace("boost", "cloudflare captcha 비정상적인 접근");
  const client = new DcListClient({ fetchImpl: async () => htmlResponse(html) });
  const rows = await client.fetchPage(makeConfig(), 1);
  assert.equal(rows.get(10).views, 123);
});

test("rejects an oversized, non-HTML, or redirected upstream response", async () => {
  const cases = [
    htmlResponse(validHtml, { contentLength: 1000 }),
    htmlResponse("{}", { contentType: "application/json" }),
    htmlResponse(validHtml, { url: "https://example.com/list" }),
  ];
  const config = makeConfig({
    polling: { ...makeConfig().polling, maxResponseBytes: 200 },
  });
  for (const response of cases) {
    const client = new DcListClient({ fetchImpl: async () => response });
    await assert.rejects(() => client.fetchPage(config, 1), UpstreamError);
  }
});

test("rejects empty and challenge HTML as an upstream sanity failure", async () => {
  for (const html of ["<html><body></body></html>", "<html>captcha 비정상적인 접근</html>"]) {
    const client = new DcListClient({ fetchImpl: async () => htmlResponse(html) });
    await assert.rejects(
      () => client.fetchPage(makeConfig(), 1),
      /no valid post rows|challenge or access-denied/,
    );
  }
});

test("accepts a structurally valid empty list page during bounded recovery", async () => {
  const html = '<table class="gall_list"><tbody class="listwrap2 "></tbody></table>';
  const client = new DcListClient({ fetchImpl: async () => htmlResponse(html) });
  const rows = await client.fetchPage(makeConfig(), 2);
  assert.equal(rows.size, 0);
});
