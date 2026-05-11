import * as vscode from 'vscode';
import { loadI18nFiles } from './store';

/**
 * 扫描国际化文件
 */
export function registerI18nDocumentsLoad(): vscode.Disposable {
    return vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.endsWith('.properties')) {
            void loadI18nFiles([doc.uri]);
        }
    });
}
