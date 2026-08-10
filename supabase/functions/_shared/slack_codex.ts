const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{8,}$/;

export function slackUserMention(userId: string | null | undefined) {
  const normalized = String(userId ?? "").trim();
  return SLACK_USER_ID_PATTERN.test(normalized) ? `<@${normalized}> ` : "";
}
