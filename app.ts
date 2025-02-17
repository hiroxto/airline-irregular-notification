import * as cheerio from 'cheerio';
import { WebClient } from '@slack/web-api';
import assert from 'assert';
import type { Block, KnownBlock } from '@slack/web-api';

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

function formatMessage(flightInfos: FlightInfo[], updateTime: string): { text: string; blocks: (Block | KnownBlock)[] } {
    const headerText = `*特別な取り扱いの一覧 / <${ANA_URL}|ANA> @here*\n`;
    const blocks: (Block | KnownBlock)[] = [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: headerText
            }
        }
    ];

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

async function postToSlack(message: { text: string; blocks: (Block | KnownBlock)[] }): Promise<void> {
    const slack = new WebClient(SLACK_TOKEN);
    assert(SLACK_TOKEN && SLACK_CHANNEL);

    const result = await slack.chat.postMessage({
        channel: SLACK_CHANNEL,
        text: message.text,
        blocks: message.blocks,
        mrkdwn: true,
        username: '橙釦',
        icon_emoji: ':ana:'
    });

    if (!result.ok) {
        throw new Error(`Failed to post to Slack: ${result.error}`);
    }
}

async function main() {
    try {
        const html = await fetchHTML(ANA_URL);

        if (!hasIrregularFlights(html)) {
            console.log('No irregular flights found');
            return;
        }

        const flightInfos = parseIrregularFlights(html);
        const updateTime = getUpdateTime(html);
        const message = formatMessage(flightInfos, updateTime);
        await postToSlack(message);

        console.log('Successfully posted irregular flight information to Slack');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
