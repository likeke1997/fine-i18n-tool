import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as vscode from 'vscode';
import { getI18nConfiguration } from './configuration';
import { formatI18nValue } from './format';
import { getI18nValue } from './store';

/**
 * 提示
 */
export function registerInlayHintsProvider(): vscode.Disposable {
    const { selector, i18nFuncName } = getI18nConfiguration();

    return vscode.languages.registerInlayHintsProvider(selector, {
        provideInlayHints(document) {
            const hints: vscode.InlayHint[] = [];
            const text = document.getText();

            try {
                const ast = parse(text, {
                    sourceType: 'module',
                    plugins: ['typescript', 'jsx'],
                });

                traverse(ast, {
                    CallExpression(callPath) {
                        if (
                            'name' in callPath.node.callee &&
                            callPath.node.callee.name === i18nFuncName &&
                            callPath.node.arguments.length > 0
                        ) {
                            const keyNode = callPath.node.arguments[0];

                            if (keyNode.type === 'StringLiteral') {
                                const key = keyNode.value;
                                const value = getI18nValue(key) ?? '';
                                const formatValue = formatI18nValue(value);

                                if (formatValue) {
                                    const hint = new vscode.InlayHint(document.positionAt(keyNode.end ?? 0), formatValue);
                                    hint.paddingLeft = true;
                                    hints.push(hint);
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
