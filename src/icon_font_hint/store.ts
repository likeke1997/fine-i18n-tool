import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import PACKAGE from '../../package.json';
import { getIconFontHintConfiguration } from './configuration';
import { fireIconFontHintsChanged } from './events';
import { iconCodeToCharacter, parseIconfontCssCodes } from './parser';
import { parseTtfIconfontCodes } from './ttfParser';

export interface IconFontGlyph {
    code: string;
    character: string;
    fontPath?: string;
}

interface ParsedIconfontFile {
    codes: Set<string>;
    fontPath?: string;
}

let iconGlyphs = new Map<string, IconFontGlyph>();
let loadedIconfontFilePaths = new Set<string>();

export async function loadIconfontFiles(): Promise<void> {
    const { enabled, iconfontFileGlobs } = getIconFontHintConfiguration();

    if (!enabled) {
        updateIconfontCache(new Map<string, IconFontGlyph>(), new Set<string>());
        return;
    }

    const files = await findIconfontFiles(iconfontFileGlobs);
    const nextIconGlyphs = new Map<string, IconFontGlyph>();
    const nextLoadedFilePaths = new Set<string>();

    await Promise.all(files.map(async (uri) => {
        try {
            const parsedFile = await parseIconfontFile(uri);

            parsedFile.codes.forEach((code) => {
                if (!nextIconGlyphs.has(code)) {
                    nextIconGlyphs.set(code, {
                        code,
                        character: iconCodeToCharacter(code),
                        fontPath: parsedFile.fontPath,
                    });
                }
            });
            nextLoadedFilePaths.add(uri.fsPath);
            console.log(`[${PACKAGE.name}] iconfont file loaded: ${uri.path}, codes: ${parsedFile.codes.size}`);
        } catch (error) {
            console.warn(`[${PACKAGE.name}] iconfont file load failed: ${uri.path}`, error);
        }
    }));

    updateIconfontCache(nextIconGlyphs, nextLoadedFilePaths);
}

export function hasIconCodes(): boolean {
    return iconGlyphs.size > 0;
}

export function updateIconfontCache(nextIconGlyphs: Map<string, IconFontGlyph>, nextLoadedFilePaths: Set<string>): void {
    if (areGlyphMapsEqual(iconGlyphs, nextIconGlyphs) && areSetsEqual(loadedIconfontFilePaths, nextLoadedFilePaths)) {
        return;
    }

    iconGlyphs = nextIconGlyphs;
    loadedIconfontFilePaths = nextLoadedFilePaths;
    fireIconFontHintsChanged();
}

export function hasIconCode(code: string): boolean {
    return iconGlyphs.has(code);
}

export function getIconGlyph(code: string): IconFontGlyph | undefined {
    return iconGlyphs.get(code);
}

export function isLoadedIconfontFile(uri: vscode.Uri): boolean {
    return loadedIconfontFilePaths.has(uri.fsPath);
}

async function findIconfontFiles(iconfontFileGlobs: string[]): Promise<vscode.Uri[]> {
    const filesByPath = new Map<string, vscode.Uri>();
    const fileGroups = await Promise.all(iconfontFileGlobs.map((iconfontFileGlob) => findIconfontFilesBySetting(iconfontFileGlob)));

    fileGroups.forEach((files) => {
        files.forEach((uri) => {
            filesByPath.set(uri.fsPath, uri);
        });
    });

    return Array.from(filesByPath.values());
}

async function parseIconfontFile(uri: vscode.Uri): Promise<ParsedIconfontFile> {
    const extension = path.extname(uri.fsPath).toLowerCase();

    if (extension === '.ttf') {
        return {
            codes: parseTtfIconfontCodes(await fs.promises.readFile(uri.fsPath)),
            fontPath: uri.fsPath,
        };
    }

    if (extension === '.css') {
        return {
            codes: parseIconfontCssCodes(await fs.promises.readFile(uri.fsPath, 'utf-8')),
        };
    }

    return {
        codes: new Set<string>(),
    };
}

async function findIconfontFilesBySetting(iconfontFileGlob: string): Promise<vscode.Uri[]> {
    if (path.isAbsolute(iconfontFileGlob)) {
        return fs.existsSync(iconfontFileGlob) ? [vscode.Uri.file(iconfontFileGlob)] : [];
    }

    const workspaceRelativeFile = findExistingWorkspaceRelativeFile(iconfontFileGlob);

    if (workspaceRelativeFile) {
        return [workspaceRelativeFile];
    }

    return vscode.workspace.findFiles(iconfontFileGlob.replace(/\\/g, '/'), 'node_modules/**');
}

function findExistingWorkspaceRelativeFile(relativePath: string): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

    for (const workspaceFolder of workspaceFolders) {
        const filePath = path.join(workspaceFolder.uri.fsPath, relativePath);

        if (fs.existsSync(filePath)) {
            return vscode.Uri.file(filePath);
        }
    }

    return undefined;
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
    if (left.size !== right.size) {
        return false;
    }

    for (const item of left) {
        if (!right.has(item)) {
            return false;
        }
    }

    return true;
}

function areGlyphMapsEqual(left: Map<string, IconFontGlyph>, right: Map<string, IconFontGlyph>): boolean {
    if (left.size !== right.size) {
        return false;
    }

    for (const [code, leftGlyph] of left) {
        const rightGlyph = right.get(code);

        if (!rightGlyph || leftGlyph.character !== rightGlyph.character || leftGlyph.fontPath !== rightGlyph.fontPath) {
            return false;
        }
    }

    return true;
}
