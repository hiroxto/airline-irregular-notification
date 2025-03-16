import { WebClient } from "@slack/web-api";
import type { Block, KnownBlock } from "@slack/web-api";

export interface SlackMessage {
    text: string;
    blocks: (Block | KnownBlock)[];
}

export interface SlackPostOptions {
    username: string;
    icon: string;
    token: string;
    channel: string;
}

export const postToSlack = async (message: SlackMessage, options: SlackPostOptions): Promise<void> => {
    const slack = new WebClient(options.token);

    const result = await slack.chat.postMessage({
        channel: options.channel,
        text: message.text,
        blocks: message.blocks,
        mrkdwn: true,
        username: options.username,
        icon_emoji: options.icon,
    });

    if (!result.ok) {
        throw new Error(`Failed to post to Slack: ${result.error}`);
    }
};
