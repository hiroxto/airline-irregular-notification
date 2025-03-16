import * as fs from 'fs/promises';
import * as path from 'path';

export interface BaseState<T> {
    lastCheck: string;
    flightInfos: T[];
}

export interface StateManager<T> {
    loadState: () => Promise<BaseState<T> | null>;
    saveState: (state: BaseState<T>) => Promise<void>;
    hasStateChanged: (oldState: BaseState<T> | null, newFlightInfos: T[]) => boolean;
}

export const createStateManager = <T>(fileName: string): StateManager<T> => {
    const filePath = path.join('storage', fileName);

    const loadState = async (): Promise<BaseState<T> | null> => {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as BaseState<T>;
        } catch (error) {
            // ファイルが存在しない場合やJSONパースエラーの場合はnullを返す
            return null;
        }
    };

    const saveState = async (state: BaseState<T>): Promise<void> => {
        await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    };

    const hasStateChanged = (oldState: BaseState<T> | null, newFlightInfos: T[]): boolean => {
        if (!oldState) return true;

        // 運航情報を文字列にして比較
        const stringifyAirports = (infos: T[]) =>
            JSON.stringify(infos.map(info => ({
                ...info,
                airports: (info as any).airports.sort((a: any, b: any) => a.name.localeCompare(b.name))
            })));

        return stringifyAirports(oldState.flightInfos) !== stringifyAirports(newFlightInfos);
    };

    return {
        loadState,
        saveState,
        hasStateChanged
    };
};
