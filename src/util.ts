/**
 * 格式化国际化值
 * @param value
 * @returns
 */
export function formatI18nValue(value: string) {
    return unescape(value.replaceAll('\\', '%'));
}
