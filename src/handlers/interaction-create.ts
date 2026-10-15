import { Events, type Client, type Interaction } from "discord.js";
import { parseCustomId } from "../commands/ids.js";
import { createSubmissionChannel } from "../services/submission.service.js";
import {
  approveChallengeFromInteraction,
  rejectChallengeFromInteraction,
} from "../services/challenge-approval.service.js";
import { completeSubmission } from "../services/submission-snapshot.service.js";
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

      if (parsed.action === "challenge:approve") {
        await interaction.deferReply();
        await approveChallengeFromInteraction(interaction, parsed.resourceId);
        await interaction.message.edit({
          content: "Challenge가 승인되어 공개 채널에 게시되었습니다.",
          components: [],
        });
        await interaction.editReply("Challenge 승인 및 공개 게시가 완료되었습니다.");
        return;
      }

      if (parsed.action === "challenge:reject") {
        await interaction.deferReply();
        await rejectChallengeFromInteraction(interaction, parsed.resourceId);
        await interaction.message.edit({
          content: "Challenge가 거절되었습니다.",
          components: [],
        });
        await interaction.editReply("Challenge 거절 처리가 완료되었습니다.");
        return;
      }

      if (parsed.action === "submission:complete") {
        await interaction.deferReply({ ephemeral: true });
        const snapshot = await completeSubmission(interaction, parsed.resourceId);
        await interaction.editReply(`제출이 확정되었습니다. ${snapshot.artifacts.length}개의 제출 자료를 저장했습니다.`);
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
