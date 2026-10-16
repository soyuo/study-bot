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
import { deleteChallengeFromInteraction } from "../services/challenge-deletion.service.js";
import { closeChallengeFromInteraction } from "../services/challenge-close.service.js";
import { archiveChallengeFromInteraction } from "../services/challenge-archive.service.js";
import { reopenSubmissionFromInteraction } from "../services/submission-reopen.service.js";
import { getAuditLogEmbed } from "../services/audit-query.service.js";
import { deleteSubmissionFromInteraction } from "../services/submission-deletion.service.js";
import { logger } from "../logger.js";
import { getHealthEmbed } from "../services/health.service.js";
import { updateChallengeDeadlineFromInteraction } from "../services/deadline-command.service.js";
import { formatDiscordTimestamp } from "../utils/deadline.js";
import { getDeadlineChallengeAutocompleteChoices } from "../services/deadline-command.service.js";
import { getChallengeHintForInteraction } from "../services/challenge-hint.service.js";

export function resolveInteractionRoute(input: {
  kind: "chat" | "button" | "other";
  commandName?: string;
  customId?: string;
}): { kind: "chat"; commandName: string } | { kind: "button"; action: string; resourceId: string } | null {
  if (input.kind === "chat" && input.commandName) {
    return { kind: "chat", commandName: input.commandName };
  }
  if (input.kind === "button" && input.customId) {
    const parsed = parseCustomId(input.customId);
    return parsed ? { kind: "button", ...parsed } : null;
  }
  return null;
}

export function registerInteractionHandler(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        if (interaction.commandName !== "deadline" || !interaction.guild) return;
        const focused = interaction.options.getFocused(true);
        if (focused.name !== "challenge_id") return;
        const choices = await getDeadlineChallengeAutocompleteChoices(interaction.guild.id, focused.value);
        await interaction.respond(choices);
        return;
      }
      const route = resolveInteractionRoute({
        kind: interaction.isChatInputCommand() ? "chat" : interaction.isButton() ? "button" : "other",
        ...(interaction.isChatInputCommand() ? { commandName: interaction.commandName } : {}),
        ...(interaction.isButton() ? { customId: interaction.customId } : {}),
      });
      if (!route) return;

      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "health") {
          await interaction.deferReply({ ephemeral: true });
          const embed = await getHealthEmbed(interaction, client);
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        if (interaction.commandName === "submission-delete") {
          await interaction.deferReply({ ephemeral: true });
          const submissionId = interaction.options.getString("submission_id", true);
          await deleteSubmissionFromInteraction(interaction, submissionId);
          await interaction.editReply("Submission을 삭제 처리했습니다. Artifact, Snapshot, Grade 이력은 보존됩니다.");
          return;
        }
        if (interaction.commandName === "audit") {
          await interaction.deferReply({ ephemeral: true });
          const entityId = interaction.options.getString("entity_id", true);
          const embed = await getAuditLogEmbed(interaction, entityId);
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        if (interaction.commandName === "challenge-delete") {
          await interaction.deferReply({ ephemeral: true });
          const challengeId = interaction.options.getString("challenge_id", true);
          const result = await deleteChallengeFromInteraction(interaction, challengeId);
          const channelMessage = result.failedSubmissionChannelCount > 0
            ? `제출 방 ${result.deletedSubmissionChannelCount}개를 삭제했고 ${result.failedSubmissionChannelCount}개는 삭제하지 못했습니다.`
            : `제출 방 ${result.deletedSubmissionChannelCount}개도 삭제했습니다.`;
          await interaction.editReply(
            `Challenge가 삭제 처리되었습니다. ${result.deletedSubmissionCount}개의 Submission을 삭제했고 ${channelMessage} Artifact와 Grade는 보존했습니다.`,
          );
          return;
        }
        if (interaction.commandName === "challenge-close") {
          await interaction.deferReply({ ephemeral: true });
          const challengeId = interaction.options.getString("challenge_id", true);
          const result = await closeChallengeFromInteraction(interaction, challengeId);
          await interaction.editReply(
            `Challenge를 종료했습니다. ${result.lockedChannelCount}/${result.lockedChannels.length}개의 제출 방을 잠갔습니다. 다음 과제 승인 시 Archive로 이동합니다.`,
          );
          return;
        }
        if (interaction.commandName === "challenge-archive") {
          await interaction.deferReply({ ephemeral: true });
          const challengeId = interaction.options.getString("challenge_id", true);
          const result = await archiveChallengeFromInteraction(interaction, challengeId);
          await interaction.editReply(`Challenge Archive 처리: ${result.completed}/${result.total}건 완료되었습니다.${result.failed ? ` ${result.failed}건은 실패했습니다.` : ""}`);
          return;
        }
        if (interaction.commandName === "submission-reopen") {
          await interaction.deferReply({ ephemeral: true });
          const submissionId = interaction.options.getString("submission_id", true);
          const result = await reopenSubmissionFromInteraction(interaction, submissionId);
          await interaction.editReply(`제출 방을 다시 열었습니다: <#${result.channelId}>`);
          return;
        }
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
        if (interaction.commandName === "deadline") {
          await interaction.deferReply({ ephemeral: true });
          const challengeId = interaction.options.getString("challenge_id", true);
          const deadline = await updateChallengeDeadlineFromInteraction(interaction, challengeId);
          await interaction.editReply(`마감일이 설정되었습니다: ${formatDiscordTimestamp(deadline)}`);
          return;
        }
        if (interaction.commandName !== "regrade") return;
        await interaction.deferReply({ ephemeral: true });
        const submissionId = interaction.options.getString("submission_id", true);
        const result = await regradeSubmissionFromInteraction(interaction, submissionId);
        await interaction.editReply(`재채점 작업이 등록되었습니다. Job ID: ${result.jobId}`);
        return;
      }
      if (!interaction.isButton() || route.kind !== "button") return;
      const parsed = route;

      if (parsed.action === "challenge:hint") {
        await interaction.deferReply({ ephemeral: true });
        const embed = await getChallengeHintForInteraction(interaction, parsed.resourceId);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

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
