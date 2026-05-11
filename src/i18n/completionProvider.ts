import * as vscode from 'vscode';
import { getI18nConfiguration } from './configuration';
import { formatI18nValue } from './format';
import { getI18nEntries } from './store';

const TRIGGER_CHAR_LIST = ['"', "'", '`'];

/**
 * 自动补全
 */
export function registerCompletionItemProvider(): vscode.Disposable {
    const { selector, i18nFuncName } = getI18nConfiguration();

    return vscode.languages.registerCompletionItemProvider(
        selector,
        {
            provideCompletionItems: async function (document, position) {
                const linePrefix = document.lineAt(position).text.substr(0, position.character);
                if (TRIGGER_CHAR_LIST.some((char) => linePrefix.endsWith(`${i18nFuncName}(${char}`))) {
                    return getI18nEntries().map(([key, value]) => {
                        const formatValue = formatI18nValue(value);
                        const item = new vscode.CompletionItem(`${key}(${formatValue})`);
                        item.kind = vscode.CompletionItemKind.Value;
                        item.detail = `${key}: ${formatValue}`;
                        item.insertText = key;

                        return item;
                    });
                }

                return undefined;
            },
        },
        ...TRIGGER_CHAR_LIST,
    );
}
