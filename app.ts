import { Command } from 'commander';
import { createAnaService } from './ana';
import { createJalService } from './jal';
import { postToSlack } from './notification';
import assert from 'assert';

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

if (
    typeof SLACK_TOKEN !== 'string' ||
    typeof SLACK_CHANNEL !== 'string'
) {
    console.error('Error: SLACK_TOKEN and SLACK_CHANNEL must be set in environment variables');
    process.exit(1);
}

async function main() {
    const program = new Command();

    program
        .name('airline-irregular-notification')
        .description('航空会社の運航情報を取得してSlackに通知するCLIツール')
        .version('1.0.0');

    program
        .command('ana')
        .description('ANAの運航情報を取得してSlackに通知します')
        .option('--icon <emoji>', 'Slackに投稿する際のアイコン絵文字', ':ana:')
        .option('--username <name>', 'Slackに投稿する際のユーザー名', 'ANA運航情報')
        .option('--force', '強制的に通知を送信する', false)
        .action(async (options) => {
            try {
                const anaService = createAnaService();
                const html = await anaService.fetchFlightInfo();
                const lastState = await anaService.loadState();
                const hasIrregular = anaService.hasIrregularFlights(html);
                const updateTime = anaService.getUpdateTime(html);

                if (!hasIrregular) {
                    // --forceオプションが指定されている場合は通常運航のメッセージを送信
                    if (options.force) {
                        const message = anaService.formatMessage([], updateTime, false);
                        await postToSlack(message, {
                            icon: options.icon,
                            username: options.username,
                            token: SLACK_TOKEN,
                            channel: SLACK_CHANNEL
                        });

                        const newState = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await anaService.saveState(newState);
                        console.log('Posted normal operation message (forced)');
                        return;
                    }

                    // 前回の状態がない場合は何もしない
                    if (!lastState) {
                        console.log('No irregular flights found and no previous state exists');
                        const newState = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await anaService.saveState(newState);
                        return;
                    }

                    // 前回の状態がある場合、前回も空だった場合は通知しない
                    if (lastState.flightInfos.length === 0) {
                        console.log('No irregular flights found and previous state was also empty');
                        const newState = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await anaService.saveState(newState);
                        return;
                    }

                    // 前回は運航情報があり、今回はない場合のみ通常運航のメッセージを送信
                    const message = anaService.formatMessage([], updateTime, false);
                    await postToSlack(message, {
                        icon: options.icon,
                        username: options.username,
                        token: SLACK_TOKEN,
                        channel: SLACK_CHANNEL
                    });

                    const newState = {
                        lastCheck: new Date().toISOString(),
                        flightInfos: []
                    };
                    await anaService.saveState(newState);
                    console.log('Posted normal operation message');
                    return;
                }

                const flightInfos = anaService.parseIrregularFlights(html);
                const hasChanged = anaService.hasStateChanged(lastState, flightInfos);

                // 変更がない場合は通知しない (ただし--forceオプションが指定されている場合は通知する)
                if (!hasChanged && !options.force) {
                    console.log('No changes in flight information since last check');
                    return;
                }

                const message = anaService.formatMessage(flightInfos, updateTime, true);
                await postToSlack(message, {
                    icon: options.icon,
                    username: options.username,
                    token: SLACK_TOKEN,
                    channel: SLACK_CHANNEL
                });

                // 新しい状態を保存
                const newState = {
                    lastCheck: new Date().toISOString(),
                    flightInfos
                };
                await anaService.saveState(newState);

                console.log(options.force ? 'Successfully posted irregular flight information to Slack (forced)' : 'Successfully posted irregular flight information to Slack');
            } catch (error) {
                console.error('Error:', error);
                process.exit(1);
            }
        });

    program
        .command('jal')
        .description('JALの運航情報を取得してSlackに通知します')
        .option('--icon <emoji>', 'Slackに投稿する際のアイコン絵文字', ':jal:')
        .option('--username <name>', 'Slackに投稿する際のユーザー名', 'JAL運航情報')
        .option('--force', '強制的に通知を送信する', false)
        .action(async (options) => {
            try {
                const jalService = createJalService();
                const html = await jalService.fetchFlightInfo();
                const lastState = await jalService.loadState();
                const hasIrregular = jalService.hasIrregularFlights(html);
                const updateTime = jalService.getUpdateTime(html);

                if (!hasIrregular) {
                    // --forceオプションが指定されている場合は通常運航のメッセージを送信
                    if (options.force) {
                        const message = jalService.formatMessage([], updateTime, false);
                        await postToSlack(message, {
                            icon: options.icon,
                            username: options.username,
                            token: SLACK_TOKEN,
                            channel: SLACK_CHANNEL
                        });

                        const newState = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await jalService.saveState(newState);
                        console.log('Posted normal operation message (forced)');
                        return;
                    }

                    // 前回の状態がない場合は何もしない
                    if (!lastState) {
                        console.log('No irregular flights found and no previous state exists');
                        const newState = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await jalService.saveState(newState);
                        return;
                    }

                    // 前回の状態がある場合、前回も空だった場合は通知しない
                    if (lastState.flightInfos.length === 0) {
                        console.log('No irregular flights found and previous state was also empty');
                        const newState = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await jalService.saveState(newState);
                        return;
                    }

                    // 前回は運航情報があり、今回はない場合のみ通常運航のメッセージを送信
                    const message = jalService.formatMessage([], updateTime, false);
                    await postToSlack(message, {
                        icon: options.icon,
                        username: options.username,
                        token: SLACK_TOKEN,
                        channel: SLACK_CHANNEL
                    });

                    const newState = {
                        lastCheck: new Date().toISOString(),
                        flightInfos: []
                    };
                    await jalService.saveState(newState);
                    console.log('Posted normal operation message');
                    return;
                }

                const flightInfos = jalService.parseIrregularFlights(html);
                const hasChanged = jalService.hasStateChanged(lastState, flightInfos);

                // 変更がない場合は通知しない (ただし--forceオプションが指定されている場合は通知する)
                if (!hasChanged && !options.force) {
                    console.log('No changes in flight information since last check');
                    return;
                }

                const message = jalService.formatMessage(flightInfos, updateTime, true);
                await postToSlack(message, {
                    icon: options.icon,
                    username: options.username,
                    token: SLACK_TOKEN,
                    channel: SLACK_CHANNEL
                });

                // 新しい状態を保存
                const newState = {
                    lastCheck: new Date().toISOString(),
                    flightInfos
                };
                await jalService.saveState(newState);

                console.log(options.force ? 'Successfully posted irregular flight information to Slack (forced)' : 'Successfully posted irregular flight information to Slack');
            } catch (error) {
                console.error('Error:', error);
                process.exit(1);
            }
        });

    program.parse();
}

main();
