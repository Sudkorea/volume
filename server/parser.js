import * as cheerio from "cheerio";

function parseCount(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  return Number.parseInt(normalized, 10);
}

export function parseGalleryList(html, page) {
  const $ = cheerio.load(html);
  const rows = new Map();

  $("tr.ub-content").each((_, element) => {
    const row = $(element);
    const attrNo = row.attr("data-no");
    const cellNo = row.find("td.gall_num").first().text().trim();
    const postNo = Number.parseInt(attrNo || cellNo, 10);
    const views = parseCount(row.find("td.gall_count").first().text());
    if (!Number.isInteger(postNo) || postNo < 1 || views === null) return;

    const link = row.find("td.gall_tit a[href*='no=']").first();
    rows.set(postNo, {
      postNo,
      views,
      title: link.text().replace(/\s+/g, " ").trim(),
      href: link.attr("href") ?? "",
      page,
    });
  });

  return rows;
}
