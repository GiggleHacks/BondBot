import type { Bot } from "@rakazo/contracts";
import { toast } from "@rakazo/ui-web";
import type { RpcClient } from "../../../lib/query/rpc";
import { errorText } from "../../../lib/query/user-error";
import type { CreateBotDialogInput } from "./create-bot-dialog";

/** Creates the bot, then turns on the VPN picked for it. A VPN failure keeps the bot. */
export async function createBotWithVpn(
  client: RpcClient,
  input: CreateBotDialogInput,
  refreshVpn: () => Promise<void>,
): Promise<Bot> {
  const { vpn, ...botInput } = input;
  // A VPN belongs to one computer, so a bot made with one gets its own.
  const bot = await client.bots.create({
    ...botInput,
    notifyOnFinish: true,
    ...(vpn ? { computerMode: "dedicated" as const } : {}),
  });
  if (vpn) {
    try {
      await client.computer.setVpn({ botId: bot.id, ...vpn, switchToDedicated: true });
    } catch (error) {
      toast.error(
        `${bot.name} was created, but its VPN could not be turned on. ${errorText(error, "Pick it again from the VPN menu.")}`,
      );
    }
    void refreshVpn();
  }
  return bot;
}
