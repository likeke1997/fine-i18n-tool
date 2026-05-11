import * as vscode from 'vscode';
import { getIconFontHintConfiguration } from './configuration';
import { onDidChangeIconFontHints } from './events';
import { createIconFontHintRegex, getIconCodeFromRegexMatch } from './parser';
import { getIconFontSvgUri } from './svgAsset';
import { getIconGlyph, hasIconCodes } from './store';

const DECORATION_UPDATE_DEBOUNCE_MS = 80;

interface IconFontDecorationMatch {
    code: string;
    range: vscode.Range;
}

let cachedMatchRegex = '';
let cachedRegex: RegExp | undefined;
let decorationUpdateTimer: ReturnType<typeof setTimeout> | undefined;
const decorationTypes = new Map<string, vscode.TextEditorDecorationType>();

export function registerIconFontDecorations(): vscode.Disposable {
    scheduleUpdateVisibleIconFontDecorations();

    return vscode.Disposable.from(
        vscode.window.onDidChangeVisibleTextEditors(scheduleUpdateVisibleIconFontDecorations),
        vscode.window.onDidChangeTextEditorVisibleRanges(scheduleUpdateVisibleIconFontDecorations),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (vscode.window.visibleTextEditors.some((editor) => editor.document === event.document)) {
                scheduleUpdateVisibleIconFontDecorations();
            }
        }),
        onDidChangeIconFontHints(scheduleUpdateVisibleIconFontDecorations),
        {
            dispose() {
                if (decorationUpdateTimer) {
                    clearTimeout(decorationUpdateTimer);
                    decorationUpdateTimer = undefined;
                }

                decorationTypes.forEach((decorationType) => decorationType.dispose());
                decorationTypes.clear();
            },
        },
    );
}

export function scheduleUpdateVisibleIconFontDecorations(): void {
    if (decorationUpdateTimer) {
        clearTimeout(decorationUpdateTimer);
    }

    decorationUpdateTimer = setTimeout(() => {
        decorationUpdateTimer = undefined;
        void updateVisibleIconFontDecorations();
    }, DECORATION_UPDATE_DEBOUNCE_MS);
}

export function collectIconFontDecorationMatches(document: vscode.TextDocument): IconFontDecorationMatch[] {
    const { enabled, matchRegex } = getIconFontHintConfiguration();

    if (!enabled || !hasIconCodes()) {
        return [];
    }

    const regex = getCachedIconFontHintRegex(matchRegex);

    if (!regex) {
        return [];
    }

    const matches: IconFontDecorationMatch[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        collectLineIconFontDecorationMatches(line, document.lineAt(line).text, regex, matches);
    }

    return matches;
}

async function updateVisibleIconFontDecorations(): Promise<void> {
    const visibleEditors = vscode.window.visibleTextEditors;

    if (!visibleEditors.length) {
        return;
    }

    await Promise.all(visibleEditors.map((editor) => updateEditorIconFontDecorations(editor)));
}

async function updateEditorIconFontDecorations(editor: vscode.TextEditor): Promise<void> {
    const matches = collectVisibleIconFontDecorationMatches(editor);
    const groupedOptions = new Map<string, vscode.DecorationOptions[]>();
    const usedDecorationKeys = new Set<string>();

    for (const match of matches) {
        const glyph = getIconGlyph(match.code);

        if (!glyph?.fontPath) {
            continue;
        }

        const iconUri = await getIconFontSvgUri(glyph);

        if (!iconUri) {
            continue;
        }

        const decorationKey = iconUri.fsPath;
        const options = groupedOptions.get(decorationKey) ?? [];

        options.push({
            range: match.range,
            hoverMessage: new vscode.MarkdownString(`iconfont: \`${match.code}\``),
        });
        groupedOptions.set(decorationKey, options);
        usedDecorationKeys.add(decorationKey);
    }

    decorationTypes.forEach((decorationType, decorationKey) => {
        if (!usedDecorationKeys.has(decorationKey)) {
            editor.setDecorations(decorationType, []);
        }
    });

    groupedOptions.forEach((options, decorationKey) => {
        editor.setDecorations(getOrCreateDecorationType(decorationKey), options);
    });
}

function collectVisibleIconFontDecorationMatches(editor: vscode.TextEditor): IconFontDecorationMatch[] {
    const { enabled, matchRegex } = getIconFontHintConfiguration();

    if (!enabled || !hasIconCodes()) {
        clearEditorIconFontDecorations(editor);
        return [];
    }

    const regex = getCachedIconFontHintRegex(matchRegex);

    if (!regex) {
        clearEditorIconFontDecorations(editor);
        return [];
    }

    const matches: IconFontDecorationMatch[] = [];

    editor.visibleRanges.forEach((visibleRange) => {
        const startLine = Math.max(0, visibleRange.start.line);
        const endLine = Math.min(editor.document.lineCount - 1, visibleRange.end.line);

        for (let line = startLine; line <= endLine; line++) {
            collectLineIconFontDecorationMatches(line, editor.document.lineAt(line).text, regex, matches);
        }
    });

    return matches;
}

function collectLineIconFontDecorationMatches(
    line: number,
    lineText: string,
    regex: RegExp,
    matches: IconFontDecorationMatch[],
): void {
    regex.lastIndex = 0;
    let match = regex.exec(lineText);

    while (match) {
        const iconCode = getIconCodeFromRegexMatch(match);

        if (iconCode && getIconGlyph(iconCode)) {
            matches.push({
                code: iconCode,
                range: new vscode.Range(line, match.index, line, match.index + match[0].length),
            });
        }

        if (match[0].length === 0) {
            regex.lastIndex++;
        }

        match = regex.exec(lineText);
    }
}

function getCachedIconFontHintRegex(matchRegex: string): RegExp | undefined {
    if (matchRegex !== cachedMatchRegex) {
        cachedMatchRegex = matchRegex;
        cachedRegex = createIconFontHintRegex(matchRegex);
    }

    return cachedRegex;
}

function getOrCreateDecorationType(decorationKey: string): vscode.TextEditorDecorationType {
    const existingDecorationType = decorationTypes.get(decorationKey);

    if (existingDecorationType) {
        return existingDecorationType;
    }

    const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentIconPath: vscode.Uri.file(decorationKey),
            width: '1em',
            height: '1em',
            margin: '0 0 0 0.35em',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    decorationTypes.set(decorationKey, decorationType);

    return decorationType;
}

function clearEditorIconFontDecorations(editor: vscode.TextEditor): void {
    decorationTypes.forEach((decorationType) => {
        editor.setDecorations(decorationType, []);
    });
}
