import {
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type Client,
} from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { withRetry } from "../utils/retry.js";

export function buildApplicationCommands() {
  const command = new SlashCommandBuilder()
    .setName("regrade")
    .setDescription("제출물을 관리자 권한으로 다시 채점합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("submission_id")
        .setDescription("재채점할 Submission ID")
        .setRequired(true),
    );

  const gradeFinalize = new SlashCommandBuilder()
    .setName("grade-finalize")
    .setDescription("Grade ID의 점수를 확정하고 제출을 완료 처리합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("grade_id").setDescription("확정할 Grade ID").setRequired(true),
    );

  const score = new SlashCommandBuilder()
    .setName("score")
    .setDescription("대상 사용자의 확정 총점을 조회합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) => option.setName("target").setDescription("점수를 조회할 대상").setRequired(true));

  const archiveRetry = new SlashCommandBuilder()
    .setName("archive-retry")
    .setDescription("실패한 제출 채널 Archive를 다시 실행합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  const deadline = new SlashCommandBuilder()
    .setName("deadline")
    .setDescription("Challenge 마감일을 상대 시간 또는 날짜로 설정합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("challenge_id")
        .setDescription("마감일을 설정할 Challenge ID")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption((option) =>
      option.setName("hours").setDescription("현재 시각부터 몇 시간 후인지 입력합니다.").setMinValue(1).setMaxValue(24 * 365),
    )
    .addStringOption((option) =>
      option.setName("date").setDescription("YYYY-MM-DD 또는 YYYY-MM-DD HH:mm (KST)").setMaxLength(40),
    );
  const guildConfig = new SlashCommandBuilder()
    .setName("config")
    .setDescription("현재 서버의 Study Bot 설정을 변경합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option.setName("challenge_channel").setDescription("Challenge 등록 채널").addChannelTypes(0),
    )
    .addChannelOption((option) =>
      option.setName("submission_category").setDescription("제출 채널 카테고리").addChannelTypes(4),
    )
    .addChannelOption((option) =>
      option.setName("archive_category").setDescription("Archive 카테고리").addChannelTypes(4),
    )
    .addRoleOption((option) => option.setName("admin_role").setDescription("관리자 Role"));
  const submission = new SlashCommandBuilder()
    .setName("submission")
    .setDescription("Submission 상태를 조회합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("본인 제출 상태를 조회합니다.")
        .addStringOption((option) => option.setName("submission_id").setDescription("Submission ID").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("inspect")
        .setDescription("관리자용 제출 상세 조회입니다.")
        .addStringOption((option) => option.setName("submission_id").setDescription("Submission ID").setRequired(true)),
    );
  const challengeDelete = new SlashCommandBuilder()
    .setName("challenge-delete")
    .setDescription("Challenge와 연결된 Submission을 삭제 처리합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("challenge_id").setDescription("삭제할 Challenge ID").setRequired(true),
    );
  const challengeClose = new SlashCommandBuilder()
    .setName("challenge-close")
    .setDescription("Challenge를 종료하고 제출을 잠급니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("challenge_id").setDescription("종료할 Challenge ID").setRequired(true),
    );
  const challengeArchive = new SlashCommandBuilder()
    .setName("challenge-archive")
    .setDescription("종료된 Challenge를 수동으로 Archive 처리합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("challenge_id").setDescription("아카이브할 Challenge ID").setRequired(true),
    );
  const audit = new SlashCommandBuilder()
    .setName("audit")
    .setDescription("관리자용 감사 로그를 조회합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("entity_id").setDescription("Challenge, Submission 또는 Job ID").setRequired(true),
    );
  const submissionDelete = new SlashCommandBuilder()
    .setName("submission-delete")
    .setDescription("Submission을 삭제 처리하고 이력을 보존합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("submission_id").setDescription("삭제할 Submission ID").setRequired(true),
    );
  const submissionReopen = new SlashCommandBuilder()
    .setName("submission-reopen")
    .setDescription("잠긴 제출 방을 다시 엽니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("submission_id").setDescription("다시 열 Submission ID").setRequired(true),
    );
  const health = new SlashCommandBuilder()
    .setName("health")
    .setDescription("봇과 데이터베이스의 운영 상태를 확인합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  return [
    command.toJSON(),
    gradeFinalize.toJSON(),
    score.toJSON(),
    archiveRetry.toJSON(),
    deadline.toJSON(),
    guildConfig.toJSON(),
    submission.toJSON(),
    challengeDelete.toJSON(),
    challengeClose.toJSON(),
    challengeArchive.toJSON(),
    audit.toJSON(),
    submissionDelete.toJSON(),
    submissionReopen.toJSON(),
    health.toJSON(),
  ];
}

export async function registerApplicationCommands(client: Client, restClient?: Pick<REST, "put">) {
  const body = buildApplicationCommands();
  const rest = restClient ?? new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);
  await withRetry(() => rest.put(route, { body }), {
    maxAttempts: 3,
    delayMs: 1_000,
    onRetry: (error, attempt) => {
      logger.warn({ err: error, attempt, maxAttempts: 3 }, "Application command registration will be retried");
    },
  });
  return client.user?.id;
}
