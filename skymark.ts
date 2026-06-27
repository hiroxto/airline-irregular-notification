import type { Block, KnownBlock } from "@slack/web-api";
import * as cheerio from "cheerio";
import { fetchHTMLWithMetadata } from "./http_client";
import type { SlackMessage } from "./notification";
import { type BaseAirportInfo, type BaseFlightInfo, type BaseState, createStateManager } from "./state_manager";

const SKYMARK_URL = "https://www.skymark.co.jp/ja/news/special/dom_focnchg.html";
const SKYMARK_REGION = "対象空港";

export interface SkymarkAirportInfo extends BaseAirportInfo {
    name: string;
    targetFlights: string;
}

export interface SkymarkFlightInfo extends BaseFlightInfo {
    region: string;
    airports: SkymarkAirportInfo[];
}

export interface SkymarkService {
    hasIrregularFlights: (html: string) => boolean;
    parseIrregularFlights: (html: string) => SkymarkFlightInfo[];
    getUpdateTime: (html: string) => string;
    formatMessage: (flightInfos: SkymarkFlightInfo[], updateTime: string, withMention?: boolean) => SlackMessage;
    loadState: () => Promise<BaseState<SkymarkFlightInfo> | null>;
    saveState: (state: BaseState<SkymarkFlightInfo>) => Promise<void>;
    hasStateChanged: (oldState: BaseState<SkymarkFlightInfo> | null, newFlightInfos: SkymarkFlightInfo[]) => boolean;
    fetchFlightInfo: () => Promise<string>;
}

const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

export const createSkymarkService = (): SkymarkService => {
    const stateManager = createStateManager<SkymarkFlightInfo>("skymark.json");

    const parseIrregularFlights = (html: string): SkymarkFlightInfo[] => {
        const $ = cheerio.load(html);
        const airports: SkymarkAirportInfo[] = [];

        const targetTable = $("table.cancel_flight")
            .filter((_, table) => {
                const headerText = normalizeText($(table).find("th").text());
                return headerText.includes("対象空港") && headerText.includes("対象便");
            })
            .first();

        targetTable.find("tr").each((_, row) => {
            const $cells = $(row).find("td");

            if ($cells.length < 2) {
                return;
            }

            const name = normalizeText($cells.eq(0).text());
            const targetFlights = normalizeText($cells.eq(1).text());

            if (name === "" || targetFlights === "") {
                return;
            }

            airports.push({ name, targetFlights });
        });

        if (airports.length === 0) {
            return [];
        }

        return [
            {
                region: SKYMARK_REGION,
                airports,
            },
        ];
    };

    const hasIrregularFlights = (html: string): boolean => {
        // 対象URLがリダイレクトされた場合、fetchFlightInfo は空文字を返すため通常状態として扱う。
        return parseIrregularFlights(html).length > 0;
    };

    const getUpdateTime = (html: string): string => {
        const $ = cheerio.load(html);
        const timeText = normalizeText($(".taR").first().text());
        return timeText || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    };

    const formatMessage = (flightInfos: SkymarkFlightInfo[], updateTime: string, withMention = true): SlackMessage => {
        const headerText = `*特別な取り扱い対象空港の一覧 / <${SKYMARK_URL}|スカイマーク>* ${withMention ? " @channel" : ""}\n`;
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
                    text: "現在、航空券の特別な取り扱い対象空港はありません。",
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

                const airportList = info.airports
                    .map(airport => `${airport.name}: ${airport.targetFlights}`)
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
        const result = await fetchHTMLWithMetadata(SKYMARK_URL, { redirect: "manual" });
        return result.redirected ? "" : result.html;
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
