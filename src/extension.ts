import * as vscode from 'vscode';
import * as fs from 'fs';
import propertiesReader from 'properties-reader';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import PACKAGE from '../package.json';

/**
 * 配置项
 */
const configuration = {
    selector: [
        { language: 'typescript', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
    ],
    i18nFileSuffix: 'i18nFileSuffix',
    i18nFuncName: 'i18nFuncName',
};

/**
 * 国际化字典
 */
let i18nMap: Record<string, string> = {};

/**
 * 扫描国际化文件
 */
function registerI18nDocumentsLoad() {
    vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.endsWith('.properties')) {
            loadI18nFiles([doc.uri]);
        }
    });
}

/**
 * 提示
 */
function registerInlayHintsProvider() {
    vscode.languages.registerInlayHintsProvider(configuration.selector, {
        provideInlayHints(document) {
            const hints: any[] = [];
            const text = document.getText();

            try {
                const ast = parse(text, {
                    sourceType: 'module',
                    plugins: ['typescript', 'jsx'],
                });

                traverse(ast, {
                    CallExpression(path) {
                        if ('name' in path.node.callee && path.node.callee.name === configuration.i18nFuncName && path.node.arguments.length > 0) {
                            const keyNode = path.node.arguments[0];

                            if (keyNode.type === 'StringLiteral') {
                                const key = keyNode.value;
                                const value = i18nMap[key] ?? '';
                                const formatValue = formatI18nValue(value);

                                if (formatValue) {
                                    const pos = document.positionAt(keyNode.end ?? 0);
                                    hints.push({
                                        position: pos,
                                        label: formatValue,
                                        paddingLeft: true,
                                    });
                                }
                            }
                        }
                    },
                });
            } catch (e) {
                // console.error(e);
            }

            return hints;
        },
    });
}

/**
 * 自动补全
 */
const TRIIGER_CHAR_LIST = ['"', "'", '`'];
function registerCompletionItemProvider() {
    vscode.languages.registerCompletionItemProvider(
        configuration.selector,
        {
            provideCompletionItems: async function (document, position) {
                const linePrefix = document.lineAt(position).text.substr(0, position.character);
                if (TRIIGER_CHAR_LIST.some((char) => linePrefix.endsWith(`${configuration.i18nFuncName}(${char}`))) {
                    return Object.entries(i18nMap).map(([key, value]) => {
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
        ...TRIIGER_CHAR_LIST
    );
}

/**
 * 载入国际化文件
 * @param uris
 */
async function loadI18nFiles(uris?: vscode.Uri[]) {
    const files = uris ?? (await vscode.workspace.findFiles(`**/*${configuration.i18nFileSuffix}`));

    files.forEach((uri) => {
        const content = fs.readFileSync(uri.fsPath, 'utf-8');
        // @ts-ignore
        const currI18nMap: Record<string, string> = propertiesReader(null).read(content).getAllProperties();

        console.log(`[${PACKAGE.name}] i18n file updated: ${uri}`);

        i18nMap = {
            ...i18nMap,
            ...currI18nMap,
        };
    });
}

/**
 * 格式化国际化值
 * @param value
 * @returns
 */
function formatI18nValue(value: string) {
    return unescape(value.replaceAll('\\', '%'));
}

export async function activate() {
    configuration.i18nFileSuffix = vscode.workspace.getConfiguration('fineI18nTool').get('i18nFileSuffix') as string;
    configuration.i18nFuncName = vscode.workspace.getConfiguration('fineI18nTool').get('i18nFuncName') as string;

    console.log(`[${PACKAGE.name}] configuration: ${JSON.stringify(configuration)}`);

    await loadI18nFiles();
    registerI18nDocumentsLoad();
    registerCompletionItemProvider();
    registerInlayHintsProvider();
}
