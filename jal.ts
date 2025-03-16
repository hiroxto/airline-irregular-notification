import type { Block, KnownBlock } from "@slack/web-api";
import * as cheerio from "cheerio";
import { fetchHTML } from "./http_client";
import type { SlackMessage } from "./notification";
import { type BaseState, createStateManager } from "./state_manager";

const JAL_URL = "https://www.jal.co.jp/cms/other/ja/info.html";

export interface JalFlightInfo {
    region: string;
    airports: {
        name: string;
        date: string;
        content: string;
    }[];
}

export interface JalService {
    hasIrregularFlights: (html: string) => boolean;
    parseIrregularFlights: (html: string) => JalFlightInfo[];
    getUpdateTime: (html: string) => string;
    formatMessage: (flightInfos: JalFlightInfo[], updateTime: string, withMention?: boolean) => SlackMessage;
    loadState: () => Promise<BaseState<JalFlightInfo> | null>;
    saveState: (state: BaseState<JalFlightInfo>) => Promise<void>;
    hasStateChanged: (oldState: BaseState<JalFlightInfo> | null, newFlightInfos: JalFlightInfo[]) => boolean;
    fetchFlightInfo: () => Promise<string>;
}

export const createJalService = (): JalService => {
    const stateManager = createStateManager<JalFlightInfo>("jal.json");

    const hasIrregularFlights = (html: string): boolean => {
        const $ = cheerio.load(html);
        // 通常運航時のメッセージを探す
        const normalMessage = $('p:contains("現在、対象空港はございません")');
        return normalMessage.length === 0;
    };

    const parseIrregularFlights = (html: string): JalFlightInfo[] => {
        const $ = cheerio.load(html);
        const flightInfos: JalFlightInfo[] = [];
        let currentRegion = "";

        // 英語版のセクションを除外するため、id="en"より前のテーブルのみを対象とする
        $(".table_typeB_01 table").each((_, table) => {
            const $table = $(table);
            // 英語版のセクション内のテーブルは除外
            if ($table.closest("#en").length > 0) {
                return;
            }

            const region = $table.find("thead th").first().text().trim();
            currentRegion = region;

            const airports: { name: string; date: string; content: string }[] = [];
            $table.find("tbody tr").each((_, row) => {
                const $cells = $(row).find("td");
                if ($cells.length === 3) {
                    const name = $cells.eq(0).text().trim();
                    const date = $cells.eq(1).text().trim();
                    const content = $cells.eq(2).text().trim();

                    airports.push({ name, date, content });
                }
            });

            if (airports.length > 0) {
                flightInfos.push({
                    region: currentRegion,
                    airports,
                });
            }
        });

        return flightInfos;
    };

    const getUpdateTime = (html: string): string => {
        const $ = cheerio.load(html);
        const timeText = $(".alR").first().text().trim();
        return timeText || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    };

    const formatMessage = (flightInfos: JalFlightInfo[], updateTime: string, withMention = true): SlackMessage => {
        const headerText = `*特別な取り扱い対象空港の一覧 / <${JAL_URL}|JAL>* ${withMention ? " @channel" : ""}\n`;
        const blocks: (Block | KnownBlock)[] = [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: headerText,
                },
            },
        ];

        if (flightInfos.length === 0) {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "現在、対象空港はございません",
                },
            });
        } else {
            for (const info of flightInfos) {
                blocks.push({
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${info.region}*`,
                    },
                });

                // 空港情報のリスト
                const airportList = info.airports
                    .map(airport => `${airport.name}: ${airport.date} - ${airport.content}`)
                    .join("\n");

                blocks.push({
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: airportList,
                    },
                });
            }
        }

        // 取得日時を追加
        blocks.push({
            type: "divider",
            block_id: "divider",
        });
        blocks.push({
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: updateTime,
                },
            ],
        });

        return {
            text: headerText,
            blocks,
        };
    };

    const fetchFlightInfo = async (): Promise<string> => {
        return await fetchHTML(JAL_URL);
    };

    return {
        hasIrregularFlights,
        parseIrregularFlights,
        getUpdateTime,
        formatMessage,
        loadState: stateManager.loadState,
        saveState: stateManager.saveState,
        hasStateChanged: stateManager.hasStateChanged,
        fetchFlightInfo,
    };
};
