export const customIds = {
  submit: (challengeId: string) => `challenge:submit:${challengeId}`,
  hint: (challengeId: string) => `challenge:hint:${challengeId}`,
  approve: (challengeId: string) => `challenge:approve:${challengeId}`,
  reject: (challengeId: string) => `challenge:reject:${challengeId}`,
  complete: (submissionId: string) => `submission:complete:${submissionId}`,
};

export function parseCustomId(customId: string): {
  action: string;
  resourceId: string;
} | null {
  const [scope, action, resourceId] = customId.split(":");
  if (!scope || !action || !resourceId) return null;
  return { action: `${scope}:${action}`, resourceId };
}
