export async function shareUrl(
  { title, url },
  {
    share = globalThis.navigator?.share?.bind(globalThis.navigator),
    writeText = globalThis.navigator?.clipboard?.writeText?.bind(globalThis.navigator.clipboard),
  } = {},
) {
  if (!url) return "unavailable";

  if (typeof share === "function") {
    try {
      await share({ title, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }

  if (typeof writeText !== "function") return "unavailable";
  try {
    await writeText(url);
    return "copied";
  } catch {
    return "unavailable";
  }
}
