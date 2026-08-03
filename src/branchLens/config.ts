import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SERVER_SECTION = '[mcp_servers.FeishuProjectMcp]';
const HEADERS_SECTION = '[mcp_servers.FeishuProjectMcp.http_headers]';

export interface McpConnectionConfig {
    url: string;
    headerName?: string;
    token?: string;
}

type ConfigSection = 'server' | 'headers' | 'other';

export function loadDefaultMcpConfig(): McpConnectionConfig | undefined {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    try {
        if (!fs.statSync(configPath).isFile()) {
            return undefined;
        }

        return parseMcpConfig(fs.readFileSync(configPath, 'utf-8'));
    } catch {
        return undefined;
    }
}

export function parseMcpConfig(content: string): McpConnectionConfig | undefined {
    let section: ConfigSection = 'other';
    let url: string | undefined;
    let headerName: string | undefined;
    let token: string | undefined;

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        if (line.startsWith('[') && line.endsWith(']')) {
            section =
                line === SERVER_SECTION ? 'server' : line === HEADERS_SECTION ? 'headers' : 'other';
            continue;
        }

        const separator = line.indexOf('=');

        if (separator <= 0) {
            continue;
        }

        const key = line.slice(0, separator).trim();
        const value = unquote(line.slice(separator + 1).trim());

        if (section === 'server' && key === 'url') {
            url = value;
        } else if (section === 'headers' && value) {
            headerName = key;
            token = value;
        }
    }

    if (!url) {
        return undefined;
    }

    return { url, headerName, token };
}

export function usesStaticHeader(config: McpConnectionConfig): boolean {
    return Boolean(config.headerName?.trim() && config.token?.trim());
}

function unquote(value: string): string {
    if (value.length < 2) {
        return value;
    }

    const first = value[0];
    const last = value[value.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    return value;
}
