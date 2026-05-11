import * as fs from 'fs';
import * as path from 'path';
import propertiesReader from 'properties-reader';
import * as vscode from 'vscode';
import PACKAGE from '../../package.json';
import { getI18nConfiguration } from './configuration';

/**
 * 国际化字典
 */
let i18nMap: Record<string, string> = {};

export function getI18nValue(key: string): string | undefined {
    return i18nMap[key];
}

export function getI18nEntries(): [string, string][] {
    return Object.entries(i18nMap);
}

/**
 * 载入国际化文件
 * @param uris
 */
export async function loadI18nFiles(uris?: vscode.Uri[]): Promise<void> {
    const { i18nFileSuffixList } = getI18nConfiguration();
    const files =
        uris ??
        (await Promise.all(i18nFileSuffixList.map((i18nFileSuffix) => vscode.workspace.findFiles(`**/*${i18nFileSuffix}`, 'node_modules/**')))).flat(1);

    files.forEach((uri) => {
        const content = fs.readFileSync(uri.fsPath, 'utf-8');

        switch (path.extname(uri.fsPath)) {
            case '.properties':
                // @ts-ignore
                updateI18nMap(uri, propertiesReader(null).read(content).getAllProperties());
                break;
            case '.json': {
                updateI18nMap(uri, JSON.parse(content));
                break;
            }
            default: {
                break;
            }
        }
    });
}

function updateI18nMap(uri: vscode.Uri, newI18nMap: Record<string, string>) {
    i18nMap = {
        ...i18nMap,
        ...newI18nMap,
    };

    console.log(`[${PACKAGE.name}] i18n file updated: ${uri.path}`);
}
