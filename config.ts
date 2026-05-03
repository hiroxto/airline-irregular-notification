type Config = {
    slackToken: string;
    slackChannel: string;
    userAgent: string;
};

const requiredEnvNames = ["SLACK_TOKEN", "SLACK_CHANNEL", "USER_AGENT"] as const;

let config: Config | undefined;

export function getConfig(): Config {
    if (config) {
        return config;
    }

    const missingEnvNames = requiredEnvNames.filter(
        name => typeof process.env[name] !== "string" || process.env[name] === "",
    );

    if (missingEnvNames.length > 0) {
        throw new Error(`Required environment variables are missing: ${missingEnvNames.join(", ")}`);
    }

    config = {
        slackToken: process.env.SLACK_TOKEN as string,
        slackChannel: process.env.SLACK_CHANNEL as string,
        userAgent: process.env.USER_AGENT as string,
    };

    return config;
}
