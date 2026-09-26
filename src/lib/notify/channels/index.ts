import type { NotificationChannelDriver } from "../../connectors/types";
import { discordDriver } from "./discord";
import { emailDriver } from "./email";
import { slackDriver } from "./slack";
import { smsDriver } from "./sms";
import { teamsDriver } from "./teams";
import { webhookDriver } from "./webhook";

/** Notification channel drivers (one file per channel in this folder). */
export const NOTIFICATION_DRIVERS: NotificationChannelDriver[] = [
  emailDriver,
  slackDriver,
  discordDriver,
  teamsDriver,
  webhookDriver,
  smsDriver,
];
