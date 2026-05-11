import * as vscode from 'vscode';
import { affectsIconFontHintConfiguration, getIconFontHintConfiguration, readIconFontHintConfiguration } from './configuration';
import { registerIconFontDecorations, scheduleUpdateVisibleIconFontDecorations } from './decorations';
import { iconFontHintChangeEmitter } from './events';
import { clearIconFontSvgAssetCache, initializeIconFontSvgAssets } from './svgAsset';
import { isLoadedIconfontFile, loadIconfontFiles } from './store';

const ICONFONT_RELOAD_DEBOUNCE_MS = 150;

let iconfontWatchers: vscode.Disposable[] = [];
let iconfontReloadTimer: ReturnType<typeof setTimeout> | undefined;

export async function activateIconFontHint(context: vscode.ExtensionContext): Promise<void> {
    initializeIconFontSvgAssets(context);
    readIconFontHintConfiguration();
    await loadIconfontFiles();
    createIconfontWatchers();

    context.subscriptions.push(
        iconFontHintChangeEmitter,
        registerIconFontDecorations(),
        registerIconfontDocumentWatcher(),
        registerIconFontHintConfigurationWatcher(),
        {
            dispose() {
                disposeIconfontWatchers();
                clearIconFontSvgAssetCache();
            },
        },
    );
}

function registerIconfontDocumentWatcher(): vscode.Disposable {
    return vscode.workspace.onDidSaveTextDocument((doc) => {
        if (isLoadedIconfontFile(doc.uri)) {
            scheduleLoadIconfontFiles();
        }
    });
}

function registerIconFontHintConfigurationWatcher(): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
        if (!affectsIconFontHintConfiguration(event)) {
            return;
        }

        readIconFontHintConfiguration();
        createIconfontWatchers();
        scheduleUpdateVisibleIconFontDecorations();
        scheduleLoadIconfontFiles();
    });
}

function createIconfontWatchers(): void {
    disposeIconfontWatchers();

    const { iconfontFileGlobs } = getIconFontHintConfiguration();

    iconfontWatchers = iconfontFileGlobs
        .filter((glob) => !isAbsoluteFilePath(glob))
        .map((glob) => {
            const watcher = vscode.workspace.createFileSystemWatcher(glob.replace(/\\/g, '/'));

            watcher.onDidChange(scheduleLoadIconfontFiles);
            watcher.onDidCreate(scheduleLoadIconfontFiles);
            watcher.onDidDelete(scheduleLoadIconfontFiles);

            return watcher;
        });
}

function scheduleLoadIconfontFiles(): void {
    if (iconfontReloadTimer) {
        clearTimeout(iconfontReloadTimer);
    }

    iconfontReloadTimer = setTimeout(() => {
        iconfontReloadTimer = undefined;
        void loadIconfontFiles();
    }, ICONFONT_RELOAD_DEBOUNCE_MS);
}

function disposeIconfontWatchers(): void {
    iconfontWatchers.forEach((watcher) => watcher.dispose());
    iconfontWatchers = [];

    if (iconfontReloadTimer) {
        clearTimeout(iconfontReloadTimer);
        iconfontReloadTimer = undefined;
    }
}

function isAbsoluteFilePath(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}
