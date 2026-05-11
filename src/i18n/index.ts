import * as vscode from 'vscode';
import PACKAGE from '../../package.json';
import { registerCompletionItemProvider } from './completionProvider';
import { readI18nConfiguration } from './configuration';
import { registerI18nDocumentsLoad } from './documentWatcher';
import { registerInlayHintsProvider } from './inlayHintsProvider';
import { loadI18nFiles } from './store';

export async function activateI18n(context: vscode.ExtensionContext): Promise<void> {
    const configuration = readI18nConfiguration();

    console.log(`[${PACKAGE.name}] configuration: ${JSON.stringify(configuration)}`);

    await loadI18nFiles();
    context.subscriptions.push(
        registerI18nDocumentsLoad(),
        registerCompletionItemProvider(),
        registerInlayHintsProvider(),
    );
}
