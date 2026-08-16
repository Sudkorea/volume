import { DiscordNotifier } from "../server/discord.js";

const notifier = new DiscordNotifier();
if (!notifier.configured) {
  throw new Error("DISCORD_WEBHOOK_URL is not configured in .env");
}
const result = await notifier.notifyTest();
if (!result.delivered) throw new Error(`Discord test was not delivered: ${result.reason}`);
console.log("Discord watchdog test delivered.");
