import * as cheerio from 'cheerio';
import { fetchHTML } from './http_client';
import { createStateManager, BaseState } from './state_manager';
import { SlackMessage } from './notification';
import type { Block, KnownBlock } from '@slack/web-api';

const ANA_URL = 'https://www.ana.co.jp/asw/ncf_info';

export interface AnaFlightInfo {
    region: string;
    airports: {
        name: string;
        period: string;
    }[];
}

export interface AnaService {
    hasIrregularFlights: (html: string) => boolean;
    parseIrregularFlights: (html: string) => AnaFlightInfo[];
    getUpdateTime: (html: string) => string;
    formatMessage: (flightInfos: AnaFlightInfo[], updateTime: string, withMention?: boolean) => SlackMessage;
    loadState: () => Promise<BaseState<AnaFlightInfo> | null>;
    saveState: (state: BaseState<AnaFlightInfo>) => Promise<void>;
    hasStateChanged: (oldState: BaseState<AnaFlightInfo> | null, newFlightInfos: AnaFlightInfo[]) => boolean;
    fetchFlightInfo: () => Promise<string>;
}

export const createAnaService = (): AnaService => {
    const stateManager = createStateManager<AnaFlightInfo>('ana.json');

    const hasIrregularFlights = (html: string): boolean => {
        const $ = cheerio.load(html);
        // 通常運航時のメッセージを探す
        const normalMessage = $('p:contains("現在、台風などの大幅な気象の乱れにより、今後運航への影響が予測される空港はありません。")');
        return normalMessage.length === 0;
    };

    const parseIrregularFlights = (html: string): AnaFlightInfo[] => {
        const $ = cheerio.load(html);
        const flightInfos: AnaFlightInfo[] = [];
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
                // 空港情報のセル
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
    };

    const getUpdateTime = (html: string): string => {
        const $ = cheerio.load(html);
        const timeText = $('.hinichi').text().trim();
        return timeText || new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    };

    const formatMessage = (flightInfos: AnaFlightInfo[], updateTime: string, withMention: boolean = true): SlackMessage => {
        const headerText = `*特別な取り扱いの一覧 / <${ANA_URL}|ANA>* ${withMention ? ' @channel' : ''}\n`;
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
                    .map(airport => `${airport.name}: ${airport.period}`)
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
        blocks.push({
            type: 'divider',
            block_id: 'divider'
        } as Block);
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: updateTime
                }
            ]
        });

        return {
            text: headerText,
            blocks
        };
    };

    const fetchFlightInfo = async (): Promise<string> => {
        return await fetchHTML(ANA_URL);
    };

    return {
        hasIrregularFlights,
        parseIrregularFlights,
        getUpdateTime,
        formatMessage,
        loadState: stateManager.loadState,
        saveState: stateManager.saveState,
        hasStateChanged: stateManager.hasStateChanged,
        fetchFlightInfo
    };
};
