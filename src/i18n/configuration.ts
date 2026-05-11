import * as vscode from 'vscode';

/**
 * 配置项
 */
interface I18nConfiguration {
    selector: vscode.DocumentSelector;
    i18nFileSuffixList: string[];
    i18nFuncName: string;
}

let configuration: I18nConfiguration = {
    selector: [
        { language: 'typescript', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
    ],
    i18nFileSuffixList: [''],
    i18nFuncName: '',
};

export function getI18nConfiguration(): I18nConfiguration {
    return configuration;
}

export function readI18nConfiguration(): I18nConfiguration {
    const vscodeConfiguration = vscode.workspace.getConfiguration('fineI18nTool');

    return setI18nConfiguration({
        i18nFileSuffixList: (vscodeConfiguration.get('i18nFileSuffix') as string).split(',').map((str) => str.trim()),
        i18nFuncName: vscodeConfiguration.get('i18nFuncName') as string,
    });
}

function setI18nConfiguration(v: Partial<I18nConfiguration>): I18nConfiguration {
    configuration = {
        ...configuration,
        ...v,
    };

    return configuration;
}
