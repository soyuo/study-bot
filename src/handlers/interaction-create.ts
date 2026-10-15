import { Events, type Client, type Interaction } from "discord.js";
import { parseCustomId } from "../commands/ids.js";
import { createSubmissionChannel } from "../services/submission.service.js";
import {
  approveChallengeFromInteraction,
  rejectChallengeFromInteraction,
} from "../services/challenge-approval.service.js";
import { completeSubmission } from "../services/submission-snapshot.service.js";
import { regradeSubmissionFromInteraction } from "../services/regrading.service.js";
import { retryArchivesFromInteraction } from "../services/archive-retry.service.js";
import { updateGuildConfiguration } from "../services/configuration.service.js";
import { getSubmissionQueryEmbed } from "../services/submission-query.service.js";
import { logger } from "../logger.js";

export function registerInteractionHandler(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "submission") {
          await interaction.deferReply({ ephemeral: true });
          const inspect = interaction.options.getSubcommand() === "inspect";
          const submissionId = interaction.options.getString("submission_id", true);
          const embed = await getSubmissionQueryEmbed(interaction, submissionId, inspect);
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        if (interaction.commandName === "config") {
          await interaction.deferReply({ ephemeral: true });
          const result = await updateGuildConfiguration(interaction);
          await interaction.editReply(
            `서버 설정이 저장되었습니다.\nChallenge: ${result.challengeChannelId}\n제출: ${result.submissionCategoryId}\nArchive: ${result.archiveCategoryId}\n관리자 Role: ${result.adminRoleId}`,
          );
          return;
        }
        if (interaction.commandName === "archive-retry") {
          await interaction.deferReply({ ephemeral: true });
          const result = await retryArchivesFromInteraction(interaction);
          await interaction.editReply(`Archive 재시도: ${result.completed}/${result.queued}건 완료되었습니다.`);
          return;
        }
        if (interaction.commandName !== "regrade") return;
        await interaction.deferReply({ ephemeral: true });
        const submissionId = interaction.options.getString("submission_id", true);
        const result = await regradeSubmissionFromInteraction(interaction, submissionId);
        await interaction.editReply(`재채점 작업이 등록되었습니다. Job ID: ${result.jobId}`);
        return;
      }
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
        const result = await completeSubmission(interaction, parsed.resourceId);
        await interaction.editReply(
          `제출이 확정되었습니다. ${result.snapshot.artifacts.length}개의 제출 자료를 저장했고 채점을 대기 중입니다.`,
        );
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
