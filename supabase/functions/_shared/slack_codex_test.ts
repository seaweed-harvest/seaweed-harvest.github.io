import { slackUserMention } from "./slack_codex.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("creates a real Slack mention for a valid app user ID", () => {
  assertEquals(slackUserMention(" U1234567890 "), "<@U1234567890> ");
});

Deno.test("returns no mention when the app user ID is missing", () => {
  assertEquals(slackUserMention(""), "");
  assertEquals(slackUserMention(undefined), "");
});

Deno.test("returns no mention for plain names or malformed IDs", () => {
  assertEquals(slackUserMention("@Codex"), "");
  assertEquals(slackUserMention("U123> <!channel"), "");
  assertEquals(slackUserMention("B0BKW5CFXFF"), "");
});
