import { Events, type Client, type Interaction } from "discord.js";
import { parseCustomId } from "../commands/ids.js";
import { createSubmissionChannel } from "../services/submission.service.js";
import { logger } from "../logger.js";

export function registerInteractionHandler(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (!interaction.isButton()) return;
      const parsed = parseCustomId(interaction.customId);
      if (!parsed) return;

      if (parsed.action === "challenge:submit") {
        await interaction.deferReply({ ephemeral: true });
        await createSubmissionChannel(interaction, parsed.resourceId);
        return;
      }

      if (parsed.action === "submission:complete") {
        await interaction.reply({ content: "제출 완료 처리 골격입니다. 다음 단계에서 DB 저장·권한 잠금·채점을 연결합니다.", ephemeral: true });
      }
    } catch (error) {
      logger.error({ err: error }, "Interaction handling failed");
      const message = "요청 처리 중 오류가 발생했습니다.";
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) await interaction.editReply(message).catch(() => undefined);
        else await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
      }
    }
  });
}
