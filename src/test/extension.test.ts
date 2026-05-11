import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { readIconFontHintConfiguration } from '../icon_font_hint/configuration';
import { collectIconFontDecorationMatches } from '../icon_font_hint/decorations';
import { createIconFontHintRegex, getIconCodeFromRegexMatch, parseIconfontCodes } from '../icon_font_hint/parser';
import { createIconFontSvgContent } from '../icon_font_hint/svgAsset';
import { loadIconfontFiles } from '../icon_font_hint/store';
import { parseTtfIconfontCodes } from '../icon_font_hint/ttfParser';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Parse iconfont codes from css content declarations', () => {
		const codes = parseIconfontCodes(`
			.icon-add:before { content: "\\e67a"; }
			.icon-close:before { content: "\\E67B"; }
		`);

		assert.deepStrictEqual(Array.from(codes).sort(), ['e67a', 'e67b']);
	});

	test('Parse iconfont codes from ttf cmap table', () => {
		const codes = parseTtfIconfontCodes(createTestTtfWithFormat4Codes([0xe67a, 0xe67b]));

		assert.deepStrictEqual(Array.from(codes).sort(), ['e67a', 'e67b']);
	});

	test('Extract icon code from default regex variants', () => {
		const regex = createIconFontHintRegex('(?:fdl-)?icon-\\[([0-9a-fA-F]+)\\]');
		const text = "'flex icon-[e67a] fdl-icon-[e67b]'";
		const matches: string[] = [];
		let match = regex?.exec(text);

		while (match) {
			const code = getIconCodeFromRegexMatch(match);

			if (code) {
				matches.push(code);
			}

			match = regex?.exec(text);
		}

		assert.deepStrictEqual(matches, ['e67a', 'e67b']);
	});

	test('Collect iconfont decoration match from ttf source for configured regex match', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fine-i18n-tool-'));
		const iconfontPath = path.join(tempDir, 'iconfont.ttf');
		const sourcePath = path.join(tempDir, 'sample.js');
		const sourceText = "const className = 'flex items-center fdl-icon-[e67a]';";
		const configuration = vscode.workspace.getConfiguration('fineI18nTool');
		const previousEnabled = configuration.get<boolean>('icon_font_hint.enabled');
		const previousIconfontFileGlob = configuration.get<string>('icon_font_hint.iconfontFileGlob');
		const previousMatchRegex = configuration.get<string>('icon_font_hint.matchRegex');

		fs.writeFileSync(iconfontPath, createTestTtfWithFormat4Codes([0xe67a]));
		fs.writeFileSync(sourcePath, sourceText, 'utf-8');

		try {
			await configuration.update('icon_font_hint.enabled', true, vscode.ConfigurationTarget.Global);
			await configuration.update('icon_font_hint.iconfontFileGlob', iconfontPath, vscode.ConfigurationTarget.Global);
			await configuration.update('icon_font_hint.matchRegex', '(?:fdl-)?icon-\\[([0-9a-fA-F]+)\\]', vscode.ConfigurationTarget.Global);
			await vscode.extensions.getExtension('CauchyKe.fine-i18n-tool')?.activate();
			await sleep(300);
			readIconFontHintConfiguration();
			await loadIconfontFiles();

			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
			const matches = collectIconFontDecorationMatches(document);

			assert.strictEqual(document.languageId, 'javascript');
			assert.strictEqual(matches.length, 1);
			assert.strictEqual(matches[0].code, 'e67a');
			assert.strictEqual(matches[0].range.start.character, sourceText.indexOf('fdl-icon-[e67a]'));
			assert.strictEqual(matches[0].range.end.character, sourceText.indexOf('fdl-icon-[e67a]') + 'fdl-icon-[e67a]'.length);
		} finally {
			await configuration.update('icon_font_hint.enabled', previousEnabled, vscode.ConfigurationTarget.Global);
			await configuration.update('icon_font_hint.iconfontFileGlob', previousIconfontFileGlob, vscode.ConfigurationTarget.Global);
			await configuration.update('icon_font_hint.matchRegex', previousMatchRegex, vscode.ConfigurationTarget.Global);
			readIconFontHintConfiguration();
			await loadIconfontFiles();

			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('Create svg content with embedded ttf font data', () => {
		const svg = createIconFontSvgContent('e67a', Buffer.from('fake-font').toString('base64'));

		assert.ok(svg.includes('data:font/ttf;base64,'));
		assert.ok(svg.includes('&#xe67a;'));
		assert.ok(svg.includes('FineIconFontHint'));
	});
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function createTestTtfWithFormat4Codes(codes: number[]): Buffer {
	const sortedCodes = Array.from(new Set(codes)).sort((left, right) => left - right);
	const segCount = sortedCodes.length + 1;
	const subtableLength = 16 + segCount * 8;
	const cmapTableLength = 12 + subtableLength;
	const cmapTableOffset = 28;
	const content = Buffer.alloc(cmapTableOffset + cmapTableLength);

	content.writeUInt32BE(0x00010000, 0);
	content.writeUInt16BE(1, 4);
	content.write('cmap', 12, 'ascii');
	content.writeUInt32BE(cmapTableOffset, 20);
	content.writeUInt32BE(cmapTableLength, 24);

	content.writeUInt16BE(0, cmapTableOffset);
	content.writeUInt16BE(1, cmapTableOffset + 2);
	content.writeUInt16BE(3, cmapTableOffset + 4);
	content.writeUInt16BE(1, cmapTableOffset + 6);
	content.writeUInt32BE(12, cmapTableOffset + 8);

	const subtableOffset = cmapTableOffset + 12;
	const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
	const entrySelector = Math.floor(Math.log2(segCount));
	const rangeShift = segCount * 2 - searchRange;

	content.writeUInt16BE(4, subtableOffset);
	content.writeUInt16BE(subtableLength, subtableOffset + 2);
	content.writeUInt16BE(0, subtableOffset + 4);
	content.writeUInt16BE(segCount * 2, subtableOffset + 6);
	content.writeUInt16BE(searchRange, subtableOffset + 8);
	content.writeUInt16BE(entrySelector, subtableOffset + 10);
	content.writeUInt16BE(rangeShift, subtableOffset + 12);

	const endCodeOffset = subtableOffset + 14;
	const reservedPadOffset = endCodeOffset + segCount * 2;
	const startCodeOffset = reservedPadOffset + 2;
	const idDeltaOffset = startCodeOffset + segCount * 2;
	const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

	sortedCodes.forEach((code, index) => {
		content.writeUInt16BE(code, endCodeOffset + index * 2);
		content.writeUInt16BE(code, startCodeOffset + index * 2);
		content.writeUInt16BE((1 - code) & 0xffff, idDeltaOffset + index * 2);
		content.writeUInt16BE(0, idRangeOffsetOffset + index * 2);
	});

	const sentinelIndex = segCount - 1;

	content.writeUInt16BE(0xffff, endCodeOffset + sentinelIndex * 2);
	content.writeUInt16BE(0, reservedPadOffset);
	content.writeUInt16BE(0xffff, startCodeOffset + sentinelIndex * 2);
	content.writeUInt16BE(1, idDeltaOffset + sentinelIndex * 2);
	content.writeUInt16BE(0, idRangeOffsetOffset + sentinelIndex * 2);

	return content;
}
