import * as vscode from 'vscode';
import { McpConnectionConfig, usesStaticHeader } from './config';
import { fetchWithTimeout, getString, isObject, summarize } from './http';
import {
    OAuthRequestAuthenticator,
    RequestAuthenticator,
    StaticRequestAuthenticator,
} from './oauth';

const PROTOCOL_VERSION = '2025-03-26';
const SESSION_HEADER = 'Mcp-Session-Id';
const REQUEST_TIMEOUT_MS = 20_000;

export class FeishuMcpClient {
    private readonly authenticator: RequestAuthenticator;
    private requestId = 1;
    private sessionId: string | undefined;
    private operationQueue: Promise<void> = Promise.resolve();

    private constructor(
        private readonly config: McpConnectionConfig,
        secrets: vscode.SecretStorage,
    ) {
        this.authenticator = usesStaticHeader(config)
            ? new StaticRequestAuthenticator({
                name: config.headerName as string,
                value: config.token as string,
            })
            : new OAuthRequestAuthenticator(config.url, secrets);
    }

    static async create(config: McpConnectionConfig, secrets: vscode.SecretStorage): Promise<FeishuMcpClient> {
        const client = new FeishuMcpClient(config, secrets);
        await client.initialize();
        return client;
    }

    callTextTool(toolName: string, argumentsValue: Record<string, unknown>): Promise<string> {
        return this.enqueue(async () => {
            const response = await this.sendRequest('tools/call', {
                name: toolName,
                arguments: argumentsValue,
            });
            const result = isObject(response.result) ? response.result : undefined;
            const text = firstText(result?.content);

            if (result?.isError === true) {
                throw new Error(text || '飞书 MCP 工具返回错误');
            }

            return text;
        });
    }

    async close(): Promise<void> {
        if (!this.sessionId) {
            return;
        }

        try {
            const authentication = await this.authenticator.header();
            await fetchWithTimeout(
                this.config.url,
                {
                    method: 'DELETE',
                    headers: {
                        [authentication.name]: authentication.value,
                        [SESSION_HEADER]: this.sessionId,
                    },
                },
                3_000,
            );
        } catch {
            // Session cleanup is best-effort.
        } finally {
            this.sessionId = undefined;
        }
    }

    private async initialize(): Promise<void> {
        const response = await this.sendRequest('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: 'fine-i18n-tool',
                version: '0.0.9',
            },
        });

        if (!isObject(response.result)) {
            throw new Error('飞书 MCP 初始化未返回结果');
        }

        await this.sendNotification('notifications/initialized', {});
    }

    private async sendRequest(
        method: string,
        params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const response = await this.send({
            jsonrpc: '2.0',
            id: this.requestId++,
            method,
            params,
        });
        const error = isObject(response.error) ? response.error : undefined;

        if (error) {
            throw new Error(getString(error, 'message') || '飞书 MCP 返回 JSON-RPC 错误');
        }

        return response;
    }

    private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
        await this.send(
            {
                jsonrpc: '2.0',
                method,
                params,
            },
            true,
        );
    }

    private async send(
        payload: Record<string, unknown>,
        notification = false,
        authenticationRetried = false,
    ): Promise<Record<string, unknown>> {
        const authentication = await this.authenticator.header();
        const headers: Record<string, string> = {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': PROTOCOL_VERSION,
            [authentication.name]: authentication.value,
        };

        if (this.sessionId) {
            headers[SESSION_HEADER] = this.sessionId;
        }

        let response: Response;

        try {
            response = await fetchWithTimeout(
                this.config.url,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                },
                REQUEST_TIMEOUT_MS,
            );
        } catch (error) {
            throw new Error(`无法连接飞书 MCP：${errorMessage(error)}`);
        }

        const responseSessionId = response.headers.get(SESSION_HEADER);

        if (responseSessionId) {
            this.sessionId = responseSessionId;
        }

        if (response.status === 401 && !authenticationRetried && await this.authenticator.invalidate()) {
            return this.send(payload, notification, true);
        }

        const body = await response.text();

        if (!response.ok) {
            throw new Error(`飞书 MCP HTTP ${response.status}：${summarize(body)}`);
        }

        if (notification && !body.trim()) {
            return {};
        }

        if (!body.trim()) {
            throw new Error('飞书 MCP 返回空响应');
        }

        return parseResponse(body);
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation);
        this.operationQueue = result.then(() => undefined, () => undefined);
        return result;
    }
}

function firstText(content: unknown): string {
    if (!Array.isArray(content)) {
        return '';
    }

    for (const value of content) {
        if (!isObject(value) || getString(value, 'type') !== 'text') {
            continue;
        }

        const text = getString(value, 'text');

        if (text.trim()) {
            return text;
        }
    }

    return '';
}

function parseResponse(body: string): Record<string, unknown> {
    const trimmed = body.trim();

    if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) {
        return parseJsonObject(trimmed);
    }

    let data = '';

    for (const line of body.split(/\r?\n/)) {
        if (line.startsWith('data:')) {
            data += line.slice(5).trim();
        } else if (!line.trim() && data) {
            return parseJsonObject(data);
        }
    }

    if (data) {
        return parseJsonObject(data);
    }

    throw new Error('飞书 MCP 返回空事件流');
}

function parseJsonObject(text: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(text);

        if (isObject(value)) {
            return value;
        }
    } catch {
        // Fall through to the summarized error.
    }

    throw new Error(`无法解析飞书 MCP 响应：${summarize(text)}`);
}

function errorMessage(error: unknown): string {
    return summarize(error instanceof Error ? error.message : error);
}
