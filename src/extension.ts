import * as vscode from 'vscode';
import { activateBranchLens, deactivateBranchLens } from './branchLens';
import { activateFdlWorkspaceInfo, deactivateFdlWorkspaceInfo } from './fdlWorkspaceInfo';
import { activateIconFontHint } from './icon_font_hint';
import { activateI18n } from './i18n';

export function activate(context: vscode.ExtensionContext) {
    activateBranchLens(context);
    activateFdlWorkspaceInfo(context);
    void activateAuxiliaryFeatures(context);
}

export function deactivate() {
    deactivateBranchLens();
    deactivateFdlWorkspaceInfo();
}

async function activateAuxiliaryFeatures(context: vscode.ExtensionContext): Promise<void> {
    try {
        await activateI18n(context);
        await activateIconFontHint(context);
    } catch (error) {
        console.error('[fine-i18n-tool] Auxiliary feature activation failed:', error);
    }
}
