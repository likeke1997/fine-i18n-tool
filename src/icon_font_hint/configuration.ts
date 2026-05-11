import * as vscode from 'vscode';

const CONFIGURATION_SECTION = 'fineI18nTool';
const DEFAULT_ICONFONT_FILE_GLOB = '**/iconfont.ttf';
const DEFAULT_MATCH_REGEX = '(?:fdl-)?icon-\\[([0-9a-fA-F]+)\\]';

export interface IconFontHintConfiguration {
    selector: vscode.DocumentSelector;
    enabled: boolean;
    iconfontFileGlobs: string[];
    matchRegex: string;
}

let configuration: IconFontHintConfiguration = {
    selector: [
        { language: 'typescript', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
    ],
    enabled: true,
    iconfontFileGlobs: [DEFAULT_ICONFONT_FILE_GLOB],
    matchRegex: DEFAULT_MATCH_REGEX,
};

export function getIconFontHintConfiguration(): IconFontHintConfiguration {
    return configuration;
}

export function readIconFontHintConfiguration(): IconFontHintConfiguration {
    const vscodeConfiguration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const iconfontFileGlob = vscodeConfiguration.get<string>('icon_font_hint.iconfontFileGlob', DEFAULT_ICONFONT_FILE_GLOB);
    const matchRegex = vscodeConfiguration.get<string>('icon_font_hint.matchRegex', DEFAULT_MATCH_REGEX);

    configuration = {
        ...configuration,
        enabled: vscodeConfiguration.get<boolean>('icon_font_hint.enabled', true) !== false,
        iconfontFileGlobs: splitCommaSeparatedSetting(iconfontFileGlob, DEFAULT_ICONFONT_FILE_GLOB),
        matchRegex: matchRegex || DEFAULT_MATCH_REGEX,
    };

    return configuration;
}

export function affectsIconFontHintConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
    return (
        event.affectsConfiguration(`${CONFIGURATION_SECTION}.icon_font_hint`) ||
        event.affectsConfiguration(`${CONFIGURATION_SECTION}.icon_font_hint.enabled`) ||
        event.affectsConfiguration(`${CONFIGURATION_SECTION}.icon_font_hint.iconfontFileGlob`) ||
        event.affectsConfiguration(`${CONFIGURATION_SECTION}.icon_font_hint.matchRegex`)
    );
}

function splitCommaSeparatedSetting(value: string, defaultValue: string): string[] {
    const items = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    return items.length ? items : [defaultValue];
}
