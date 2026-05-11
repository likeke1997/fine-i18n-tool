const REGEX_LITERAL_PATTERN = /^\/([\s\S]*)\/([a-z]*)$/i;
const CONTENT_CODE_PATTERN = /content\s*:\s*['"]\\(?:u\{?)?([0-9a-fA-F]{1,6})\}?['"]/g;
const ESCAPED_CODE_PATTERN = /\\(?:u\{?)?([0-9a-fA-F]{4,6})\}?/g;

export function createIconFontHintRegex(pattern: string): RegExp | undefined {
    try {
        const literalMatch = pattern.match(REGEX_LITERAL_PATTERN);

        if (literalMatch) {
            return new RegExp(literalMatch[1], ensureGlobalFlag(literalMatch[2]));
        }

        return new RegExp(pattern, 'g');
    } catch {
        return undefined;
    }
}

export function getIconCodeFromRegexMatch(match: RegExpExecArray): string | undefined {
    const namedCode = match.groups?.code;

    if (namedCode) {
        return normalizeIconCode(namedCode);
    }

    for (let index = 1; index < match.length; index++) {
        if (match[index]) {
            return normalizeIconCode(match[index]);
        }
    }

    return normalizeIconCode(match[0]);
}

export function parseIconfontCssCodes(content: string): Set<string> {
    const codes = collectIconfontCodes(content, CONTENT_CODE_PATTERN);

    if (codes.size) {
        return codes;
    }

    return collectIconfontCodes(content, ESCAPED_CODE_PATTERN);
}

export const parseIconfontCodes = parseIconfontCssCodes;

export function normalizeIconCode(value: string): string | undefined {
    let code = value.trim();

    code = code.replace(/^['"]|['"]$/g, '');
    code = code.replace(/^&#x/i, '');
    code = code.replace(/;$/, '');
    code = code.replace(/^\\u\{?/i, '');
    code = code.replace(/^\\/, '');
    code = code.replace(/^u\+/i, '');
    code = code.replace(/^u(?=[0-9a-fA-F]{1,6}$)/i, '');
    code = code.replace(/\}$/, '');

    if (!/^[0-9a-fA-F]{1,6}$/.test(code)) {
        return undefined;
    }

    const codePoint = Number.parseInt(code, 16);

    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return undefined;
    }

    return codePoint.toString(16).toLowerCase();
}

export function iconCodeToCharacter(code: string): string {
    return String.fromCodePoint(Number.parseInt(code, 16));
}

function collectIconfontCodes(content: string, pattern: RegExp): Set<string> {
    const codes = new Set<string>();
    pattern.lastIndex = 0;
    let match = pattern.exec(content);

    while (match) {
        const code = normalizeIconCode(match[1]);

        if (code) {
            codes.add(code);
        }

        match = pattern.exec(content);
    }

    return codes;
}

function ensureGlobalFlag(flags: string): string {
    return flags.includes('g') ? flags : `${flags}g`;
}
