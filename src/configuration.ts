/**
 * 配置项
 */
let configuration = {
    selector: [
        { language: 'typescript', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
    ],
    i18nFileSuffixList: [''],
    i18nFuncName: '',
};

export function getConfiguration() {
    return configuration;
}

export function setConfiguration(v: Partial<typeof configuration>) {
    configuration = {
        ...configuration,
        ...v,
    };

    return configuration;
}
