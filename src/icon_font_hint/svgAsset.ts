import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IconFontGlyph } from './store';

const SVG_SIZE = 18;
const SVG_FONT_SIZE = 16;
const SVG_FILL_COLOR = '#c9d1d9';

let assetDir: string | undefined;
const svgAssetCache = new Map<string, vscode.Uri>();
const fontBase64Cache = new Map<string, { signature: string; base64: string }>();

export function initializeIconFontSvgAssets(context: vscode.ExtensionContext): void {
    assetDir = path.join(context.globalStorageUri.fsPath, 'icon_font_hint');
}

export async function getIconFontSvgUri(glyph: IconFontGlyph): Promise<vscode.Uri | undefined> {
    if (!assetDir || !glyph.fontPath) {
        return undefined;
    }

    const fontData = await getFontData(glyph.fontPath);

    if (!fontData) {
        return undefined;
    }

    const cacheKey = createAssetKey(glyph, fontData.signature);
    const cachedUri = svgAssetCache.get(cacheKey);

    if (cachedUri && fs.existsSync(cachedUri.fsPath)) {
        return cachedUri;
    }

    await fs.promises.mkdir(assetDir, { recursive: true });

    const filePath = path.join(assetDir, `${cacheKey}.svg`);
    const svg = createIconFontSvgContent(glyph.code, fontData.base64);

    await fs.promises.writeFile(filePath, svg, 'utf-8');

    const uri = vscode.Uri.file(filePath);
    svgAssetCache.set(cacheKey, uri);

    return uri;
}

export function clearIconFontSvgAssetCache(): void {
    svgAssetCache.clear();
    fontBase64Cache.clear();
}

export function createIconFontSvgContent(code: string, fontBase64: string): string {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}">`,
        '<defs>',
        '<style>',
        '@font-face {',
        'font-family: "FineIconFontHint";',
        `src: url("data:font/ttf;base64,${fontBase64}") format("truetype");`,
        '}',
        '</style>',
        '</defs>',
        `<text x="${SVG_SIZE / 2}" y="${SVG_SIZE / 2}" fill="${SVG_FILL_COLOR}" font-family="FineIconFontHint" font-size="${SVG_FONT_SIZE}" text-anchor="middle" dominant-baseline="central">&#x${code};</text>`,
        '</svg>',
    ].join('');
}

async function getFontData(fontPath: string): Promise<{ signature: string; base64: string } | undefined> {
    try {
        const stat = await fs.promises.stat(fontPath);
        const signature = `${fontPath}:${stat.size}:${stat.mtimeMs}`;
        const cached = fontBase64Cache.get(fontPath);

        if (cached?.signature === signature) {
            return cached;
        }

        const base64 = (await fs.promises.readFile(fontPath)).toString('base64');
        const fontData = { signature, base64 };

        fontBase64Cache.set(fontPath, fontData);

        return fontData;
    } catch {
        return undefined;
    }
}

function createAssetKey(glyph: IconFontGlyph, fontSignature: string): string {
    return crypto
        .createHash('sha1')
        .update(`${glyph.code}:${fontSignature}`)
        .digest('hex');
}
