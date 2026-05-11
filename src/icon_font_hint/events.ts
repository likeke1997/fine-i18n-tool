import * as vscode from 'vscode';

export const iconFontHintChangeEmitter = new vscode.EventEmitter<void>();
export const onDidChangeIconFontHints = iconFontHintChangeEmitter.event;

export function fireIconFontHintsChanged(): void {
    iconFontHintChangeEmitter.fire();
}
