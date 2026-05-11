const TTF_TABLE_DIRECTORY_OFFSET = 12;
const TTF_TABLE_RECORD_SIZE = 16;
const MAX_ICON_CODE_COUNT = 20000;

interface TableRecord {
    offset: number;
    length: number;
}

export function parseTtfIconfontCodes(content: Buffer): Set<string> {
    const codes = new Set<string>();
    const cmapTable = findTable(content, 'cmap');

    if (!cmapTable) {
        return codes;
    }

    const cmapEnd = cmapTable.offset + cmapTable.length;

    if (cmapTable.offset < 0 || cmapEnd > content.length || cmapTable.length < 4) {
        return codes;
    }

    const numTables = readUInt16(content, cmapTable.offset + 2);

    if (numTables === undefined) {
        return codes;
    }

    for (let index = 0; index < numTables && codes.size < MAX_ICON_CODE_COUNT; index++) {
        const recordOffset = cmapTable.offset + 4 + index * 8;
        const subtableRelativeOffset = readUInt32(content, recordOffset + 4);

        if (subtableRelativeOffset === undefined) {
            continue;
        }

        const subtableOffset = cmapTable.offset + subtableRelativeOffset;

        if (subtableOffset < cmapTable.offset || subtableOffset + 2 > cmapEnd) {
            continue;
        }

        const format = readUInt16(content, subtableOffset);

        switch (format) {
            case 0:
                collectFormat0Codes(content, subtableOffset, cmapEnd, codes);
                break;
            case 4:
                collectFormat4Codes(content, subtableOffset, cmapEnd, codes);
                break;
            case 6:
                collectFormat6Codes(content, subtableOffset, cmapEnd, codes);
                break;
            case 10:
                collectFormat10Codes(content, subtableOffset, cmapEnd, codes);
                break;
            case 12:
            case 13:
                collectSegmentedCoverageCodes(content, subtableOffset, cmapEnd, codes);
                break;
            default:
                break;
        }
    }

    return codes;
}

function findTable(content: Buffer, tag: string): TableRecord | undefined {
    if (content.length < TTF_TABLE_DIRECTORY_OFFSET) {
        return undefined;
    }

    const numTables = readUInt16(content, 4);

    if (numTables === undefined) {
        return undefined;
    }

    for (let index = 0; index < numTables; index++) {
        const recordOffset = TTF_TABLE_DIRECTORY_OFFSET + index * TTF_TABLE_RECORD_SIZE;

        if (recordOffset + TTF_TABLE_RECORD_SIZE > content.length) {
            return undefined;
        }

        if (content.toString('ascii', recordOffset, recordOffset + 4) === tag) {
            const offset = readUInt32(content, recordOffset + 8);
            const length = readUInt32(content, recordOffset + 12);

            if (offset === undefined || length === undefined) {
                return undefined;
            }

            return { offset, length };
        }
    }

    return undefined;
}

function collectFormat0Codes(content: Buffer, subtableOffset: number, cmapEnd: number, codes: Set<string>): void {
    const length = readUInt16(content, subtableOffset + 2);

    if (length === undefined || subtableOffset + length > cmapEnd || length < 262) {
        return;
    }

    for (let code = 0; code < 256 && codes.size < MAX_ICON_CODE_COUNT; code++) {
        const glyphIndex = content[subtableOffset + 6 + code];

        if (glyphIndex) {
            addCode(codes, code);
        }
    }
}

function collectFormat4Codes(content: Buffer, subtableOffset: number, cmapEnd: number, codes: Set<string>): void {
    const length = readUInt16(content, subtableOffset + 2);
    const segCountX2 = readUInt16(content, subtableOffset + 6);

    if (length === undefined || segCountX2 === undefined || subtableOffset + length > cmapEnd || segCountX2 % 2 !== 0) {
        return;
    }

    const segCount = segCountX2 / 2;
    const endCodeOffset = subtableOffset + 14;
    const reservedPadOffset = endCodeOffset + segCount * 2;
    const startCodeOffset = reservedPadOffset + 2;
    const idDeltaOffset = startCodeOffset + segCount * 2;
    const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

    if (idRangeOffsetOffset + segCount * 2 > subtableOffset + length) {
        return;
    }

    for (let segment = 0; segment < segCount && codes.size < MAX_ICON_CODE_COUNT; segment++) {
        const startCode = readUInt16(content, startCodeOffset + segment * 2);
        const endCode = readUInt16(content, endCodeOffset + segment * 2);
        const idDelta = readInt16(content, idDeltaOffset + segment * 2);
        const idRangeOffset = readUInt16(content, idRangeOffsetOffset + segment * 2);

        if (startCode === undefined || endCode === undefined || idDelta === undefined || idRangeOffset === undefined) {
            continue;
        }

        if (startCode > endCode || startCode === 0xffff) {
            continue;
        }

        for (let code = startCode; code <= endCode && codes.size < MAX_ICON_CODE_COUNT; code++) {
            if (getFormat4GlyphIndex(content, subtableOffset, length, idRangeOffsetOffset, segment, code, startCode, idDelta, idRangeOffset)) {
                addCode(codes, code);
            }
        }
    }
}

function getFormat4GlyphIndex(
    content: Buffer,
    subtableOffset: number,
    subtableLength: number,
    idRangeOffsetOffset: number,
    segment: number,
    code: number,
    startCode: number,
    idDelta: number,
    idRangeOffset: number,
): number {
    if (idRangeOffset === 0) {
        return (code + idDelta) & 0xffff;
    }

    const glyphIndexOffset = idRangeOffsetOffset + segment * 2 + idRangeOffset + (code - startCode) * 2;

    if (glyphIndexOffset < subtableOffset || glyphIndexOffset + 2 > subtableOffset + subtableLength) {
        return 0;
    }

    const rawGlyphIndex = readUInt16(content, glyphIndexOffset) ?? 0;

    return rawGlyphIndex ? (rawGlyphIndex + idDelta) & 0xffff : 0;
}

function collectFormat6Codes(content: Buffer, subtableOffset: number, cmapEnd: number, codes: Set<string>): void {
    const length = readUInt16(content, subtableOffset + 2);
    const firstCode = readUInt16(content, subtableOffset + 6);
    const entryCount = readUInt16(content, subtableOffset + 8);

    if (length === undefined || firstCode === undefined || entryCount === undefined || subtableOffset + length > cmapEnd) {
        return;
    }

    const glyphArrayOffset = subtableOffset + 10;

    for (let index = 0; index < entryCount && codes.size < MAX_ICON_CODE_COUNT; index++) {
        const glyphIndex = readUInt16(content, glyphArrayOffset + index * 2);

        if (glyphIndex) {
            addCode(codes, firstCode + index);
        }
    }
}

function collectFormat10Codes(content: Buffer, subtableOffset: number, cmapEnd: number, codes: Set<string>): void {
    const length = readUInt32(content, subtableOffset + 4);
    const startCharCode = readUInt32(content, subtableOffset + 12);
    const numChars = readUInt32(content, subtableOffset + 16);

    if (length === undefined || startCharCode === undefined || numChars === undefined || subtableOffset + length > cmapEnd) {
        return;
    }

    const glyphArrayOffset = subtableOffset + 20;

    for (let index = 0; index < numChars && codes.size < MAX_ICON_CODE_COUNT; index++) {
        const glyphIndex = readUInt16(content, glyphArrayOffset + index * 2);

        if (glyphIndex) {
            addCode(codes, startCharCode + index);
        }
    }
}

function collectSegmentedCoverageCodes(content: Buffer, subtableOffset: number, cmapEnd: number, codes: Set<string>): void {
    const length = readUInt32(content, subtableOffset + 4);
    const numGroups = readUInt32(content, subtableOffset + 12);

    if (length === undefined || numGroups === undefined || subtableOffset + length > cmapEnd) {
        return;
    }

    for (let group = 0; group < numGroups && codes.size < MAX_ICON_CODE_COUNT; group++) {
        const groupOffset = subtableOffset + 16 + group * 12;
        const startCharCode = readUInt32(content, groupOffset);
        const endCharCode = readUInt32(content, groupOffset + 4);
        const startGlyphId = readUInt32(content, groupOffset + 8);

        if (startCharCode === undefined || endCharCode === undefined || startGlyphId === undefined || startCharCode > endCharCode) {
            continue;
        }

        for (let code = startCharCode; code <= endCharCode && codes.size < MAX_ICON_CODE_COUNT; code++) {
            if (startGlyphId || code > startCharCode) {
                addCode(codes, code);
            }
        }
    }
}

function addCode(codes: Set<string>, code: number): void {
    if (code >= 0 && code <= 0x10ffff) {
        codes.add(code.toString(16).toLowerCase());
    }
}

function readUInt16(content: Buffer, offset: number): number | undefined {
    return offset >= 0 && offset + 2 <= content.length ? content.readUInt16BE(offset) : undefined;
}

function readInt16(content: Buffer, offset: number): number | undefined {
    return offset >= 0 && offset + 2 <= content.length ? content.readInt16BE(offset) : undefined;
}

function readUInt32(content: Buffer, offset: number): number | undefined {
    return offset >= 0 && offset + 4 <= content.length ? content.readUInt32BE(offset) : undefined;
}
