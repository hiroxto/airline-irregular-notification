import * as cheerio from 'cheerio';
import { WebClient } from '@slack/web-api';
import assert from 'assert';
import type { Block, KnownBlock } from '@slack/web-api';
import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;
if (!SLACK_TOKEN || !SLACK_CHANNEL) {
    console.error('Error: SLACK_TOKEN and SLACK_CHANNEL must be set in environment variables');
    process.exit(1);
}
assert(typeof SLACK_TOKEN === 'string' && typeof SLACK_CHANNEL === 'string');

const ANA_URL = 'https://www.ana.co.jp/asw/ncf_info';

interface FlightInfo {
    region: string;
    airports: {
        name: string;
        period: string;
    }[];
}

interface State {
    lastCheck: string;
    flightInfos: FlightInfo[];
}

const STATE_FILE = path.join('storage', 'ana.json');

async function loadLastState(): Promise<State | null> {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        return JSON.parse(data) as State;
    } catch (error) {
        // ファイルが存在しない場合やJSONパースエラーの場合はnullを返す
        return null;
    }
}

async function saveState(state: State): Promise<void> {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function hasFlightInfosChanged(oldState: State | null, newFlightInfos: FlightInfo[]): boolean {
    if (!oldState) return true;

    // 運航情報を文字列にして比較
    const stringifyAirports = (infos: FlightInfo[]) =>
        JSON.stringify(infos.map(info => ({
            ...info,
            airports: info.airports.sort((a, b) => a.name.localeCompare(b.name))
        })));

    return stringifyAirports(oldState.flightInfos) !== stringifyAirports(newFlightInfos);
}

async function fetchHTML(url: string): Promise<string> {
    const response = await fetch(url);
    return await response.text();
}

function hasIrregularFlights(html: string): boolean {
    const $ = cheerio.load(html);
    // 通常運航時のメッセージを探す
    const normalMessage = $('p:contains("現在、台風などの大幅な気象の乱れにより、今後運航への影響が予測される空港はありません。")');
    return normalMessage.length === 0;
}

function parseIrregularFlights(html: string): FlightInfo[] {
    const $ = cheerio.load(html);
    const flightInfos: FlightInfo[] = [];
    let currentRegion = '';

    // テーブル内の行を探す
    $('table tr').each((_, element) => {
        const $row = $(element);
        const $cells = $row.find('td');

        if ($cells.length === 2) {
            const firstCell = $cells.first();
            const secondCell = $cells.last();

            // 地域名のセル
            if (firstCell.hasClass('area')) {
                currentRegion = firstCell.text().trim();
            }
            // 空港情報のセル - area_top_lineクラスの有無に関わらず、空港名を含むセルを検出
            else if (firstCell.text().includes('・')) {
                const airportName = firstCell.text().trim().replace('・', '').trim();
                const period = secondCell.text().trim();

                // 空の期間情報は無視
                if (period === '&nbsp;' || period === '') {
                    return;
                }

                // 現在の地域の情報を探すか、新しく作成
                let regionInfo = flightInfos.find(info => info.region === currentRegion);
                if (!regionInfo) {
                    regionInfo = { region: currentRegion, airports: [] };
                    flightInfos.push(regionInfo);
                }

                regionInfo.airports.push({ name: airportName, period });
            }
        }
    });

    return flightInfos;
}

function getUpdateTime(html: string): string {
    const $ = cheerio.load(html);
    const timeText = $('.hinichi').text().trim();
    return timeText || new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function formatMessage(flightInfos: FlightInfo[], updateTime: string, withMention: boolean = true): { text: string; blocks: (Block | KnownBlock)[] } {
    const headerText = `*特別な取り扱いの一覧 / <${ANA_URL}|ANA>${withMention ? ' @here' : ''}*\n`;
    const blocks: (Block | KnownBlock)[] = [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: headerText
            }
        }
    ];

    if (flightInfos.length === 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: "現在、台風などの大幅な気象の乱れにより、今後運航への影響が予測される空港はありません。"
            }
        });
    } else {
        flightInfos.forEach(info => {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${info.region}*`
                }
            });

            // 空港情報のリスト
            const airportList = info.airports
                .map(airport => {
                    // 連続する空白を1つの空白に置換
                    const normalizedPeriod = airport.period.replace(/\s+/g, ' ').trim();
                    return `${airport.name}: ${normalizedPeriod}`;
                })
                .join('\n');

            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: airportList
                }
            });
        });
    }

    // 取得日時を追加
    blocks.push(
        {
            type: 'divider'
        },
        {
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: updateTime
                }
            ]
        }
    );

    return {
        text: headerText,
        blocks
    };
}

async function postToSlack(message: { text: string; blocks: (Block | KnownBlock)[] }, options: { username: string; icon: string }): Promise<void> {
    const slack = new WebClient(SLACK_TOKEN);
    assert(SLACK_TOKEN && SLACK_CHANNEL);

    const result = await slack.chat.postMessage({
        channel: SLACK_CHANNEL,
        text: message.text,
        blocks: message.blocks,
        mrkdwn: true,
        username: options.username,
        icon_emoji: options.icon
    });

    if (!result.ok) {
        throw new Error(`Failed to post to Slack: ${result.error}`);
    }
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
                const html = await fetchHTML(ANA_URL);
                const lastState = await loadLastState();
                const hasIrregular = hasIrregularFlights(html);
                const updateTime = getUpdateTime(html);

                if (!hasIrregular) {
                    // --forceオプションが指定されている場合は通常運航のメッセージを送信
                    if (options.force) {
                        const message = formatMessage([], updateTime, false);
                        await postToSlack(message, {
                            icon: options.icon,
                            username: options.username
                        });

                        const newState: State = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await saveState(newState);
                        console.log('Posted normal operation message (forced)');
                        return;
                    }

                    // 前回の状態がない場合は何もしない
                    if (!lastState) {
                        console.log('No irregular flights found and no previous state exists');
                        const newState: State = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await saveState(newState);
                        return;
                    }

                    // 前回の状態がある場合、前回も空だった場合は通知しない
                    if (lastState.flightInfos.length === 0) {
                        console.log('No irregular flights found and previous state was also empty');
                        const newState: State = {
                            lastCheck: new Date().toISOString(),
                            flightInfos: []
                        };
                        await saveState(newState);
                        return;
                    }

                    // 前回は運航情報があり、今回はない場合のみ通常運航のメッセージを送信
                    const message = formatMessage([], updateTime, false);
                    await postToSlack(message, {
                        icon: options.icon,
                        username: options.username
                    });

                    const newState: State = {
                        lastCheck: new Date().toISOString(),
                        flightInfos: []
                    };
                    await saveState(newState);
                    console.log('Posted normal operation message');
                    return;
                }

                const flightInfos = parseIrregularFlights(html);
                const hasChanged = hasFlightInfosChanged(lastState, flightInfos);

                // 変更がない場合は通知しない (ただし--forceオプションが指定されている場合は通知する)
                if (!hasChanged && !options.force) {
                    console.log('No changes in flight information since last check');
                    return;
                }

                const message = formatMessage(flightInfos, updateTime, true);
                await postToSlack(message, {
                    icon: options.icon,
                    username: options.username
                });

                // 新しい状態を保存
                const newState: State = {
                    lastCheck: new Date().toISOString(),
                    flightInfos
                };
                await saveState(newState);

                console.log(options.force ? 'Successfully posted irregular flight information to Slack (forced)' : 'Successfully posted irregular flight information to Slack');
            } catch (error) {
                console.error('Error:', error);
                process.exit(1);
            }
        });

    program.parse();
}

main();
