import * as vscode from 'vscode';
import { activateFdlWorkspaceInfo, deactivateFdlWorkspaceInfo } from './fdlWorkspaceInfo';
import { activateIconFontHint } from './icon_font_hint';
import { activateI18n } from './i18n';

export async function activate(context: vscode.ExtensionContext) {
    await activateI18n(context);
    await activateIconFontHint(context);
    activateFdlWorkspaceInfo(context);
}

export function deactivate() {
    deactivateFdlWorkspaceInfo();
}
