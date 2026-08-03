import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { fetchWithTimeout, getString, readJsonObject, summarize } from './http';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REQUEST_TIMEOUT_MS = 20_000;

export interface AuthenticationHeader {
    name: string;
    value: string;
}

export interface RequestAuthenticator {
    header(): Promise<AuthenticationHeader>;
    invalidate(): Promise<boolean>;
}

interface OAuthState {
    clientId?: string;
    clientSecret?: string;
    tokenEndpointAuthMethod?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt: number;
}

interface OAuthMetadata {
    registrationEndpoint: string;
    tokenEndpoint: string;
    deviceAuthorizationEndpoint: string;
    resource: string;
}

interface JsonResponse {
    status: number;
    body: Record<string, unknown>;
}

export class StaticRequestAuthenticator implements RequestAuthenticator {
    constructor(private readonly authenticationHeader: AuthenticationHeader) {}

    async header(): Promise<AuthenticationHeader> {
        return this.authenticationHeader;
    }

    async invalidate(): Promise<boolean> {
        return false;
    }
}

export class OAuthRequestAuthenticator implements RequestAuthenticator {
    private readonly secretKey: string;
    private authorizationPromise: Promise<AuthenticationHeader> | undefined;

    constructor(
        private readonly resourceEndpoint: string,
        private readonly secrets: vscode.SecretStorage,
    ) {
        const endpointHash = crypto.createHash('sha256').update(resourceEndpoint).digest('hex');
        this.secretKey = `feishuBranchLens.oauth.${endpointHash}`;
    }

    async header(): Promise<AuthenticationHeader> {
        if (this.authorizationPromise) {
            return this.authorizationPromise;
        }

        const pending = this.getHeader();
        this.authorizationPromise = pending;

        try {
            return await pending;
        } finally {
            if (this.authorizationPromise === pending) {
                this.authorizationPromise = undefined;
            }
        }
    }

    async invalidate(): Promise<boolean> {
        const state = await this.loadState();
        await this.saveState({
            ...state,
            accessToken: undefined,
            expiresAt: 0,
        });
        return true;
    }

    private async getHeader(): Promise<AuthenticationHeader> {
        let state = await this.loadState();

        if (state.accessToken && state.expiresAt > Date.now() + 60_000) {
            return bearer(state.accessToken);
        }

        const metadata = await this.discoverMetadata();

        if (state.clientId && state.refreshToken) {
            try {
                state = await this.refresh(metadata, state);
                await this.saveState(state);
                return bearer(state.accessToken);
            } catch (error) {
                if (!(error instanceof OAuthTokenError) || !error.requiresNewAuthorization()) {
                    throw error;
                }

                state = error.code === 'invalid_client'
                    ? emptyState()
                    : { ...state, accessToken: undefined, refreshToken: undefined, expiresAt: 0 };
                await this.saveState(state);
            }
        }

        if (!state.clientId) {
            state = await this.register(metadata, state);
            await this.saveState(state);
        }

        try {
            state = await this.authorizeDevice(metadata, state);
        } catch (error) {
            if (!(error instanceof OAuthTokenError) || error.code !== 'invalid_client') {
                throw error;
            }

            state = await this.register(metadata, emptyState());
            await this.saveState(state);
            state = await this.authorizeDevice(metadata, state);
        }

        await this.saveState(state);
        return bearer(state.accessToken);
    }

    private async discoverMetadata(): Promise<OAuthMetadata> {
        const endpoint = new URL(this.resourceEndpoint);
        const protectedResourceUrl = new URL('/.well-known/oauth-protected-resource', endpoint.origin).toString();
        const protectedResource = await this.getJson(protectedResourceUrl);
        requireSuccess(protectedResource, '飞书 OAuth 资源发现失败');

        const authorizationServers = protectedResource.body.authorization_servers;

        if (!Array.isArray(authorizationServers) || typeof authorizationServers[0] !== 'string') {
            throw new Error('飞书 OAuth 元数据中没有授权服务器');
        }

        const authorizationServer = new URL(authorizationServers[0]);
        const issuerPath = authorizationServer.pathname === '/' ? '' : authorizationServer.pathname.replace(/\/$/, '');
        const metadataUrl = new URL(
            `/.well-known/oauth-authorization-server${issuerPath}`,
            authorizationServer.origin,
        ).toString();
        const authorizationMetadata = await this.getJson(metadataUrl);
        requireSuccess(authorizationMetadata, '飞书 OAuth 授权服务发现失败');

        return {
            registrationEndpoint: requiredUrl(authorizationMetadata.body, 'registration_endpoint'),
            tokenEndpoint: requiredUrl(authorizationMetadata.body, 'token_endpoint'),
            deviceAuthorizationEndpoint: requiredUrl(
                authorizationMetadata.body,
                'device_authorization_endpoint',
            ),
            resource: getString(protectedResource.body, 'resource') || this.resourceEndpoint,
        };
    }

    private async register(metadata: OAuthMetadata, state: OAuthState): Promise<OAuthState> {
        const response = await this.postJson(metadata.registrationEndpoint, {
            client_name: 'Feishu Branch Lens for VS Code',
            grant_types: [DEVICE_GRANT, 'refresh_token'],
            token_endpoint_auth_method: 'none',
        });
        requireSuccess(response, '飞书 OAuth 客户端注册失败');

        const clientId = getString(response.body, 'client_id');

        if (!clientId) {
            throw new Error('飞书 OAuth 客户端注册未返回 client_id');
        }

        return {
            ...state,
            clientId,
            clientSecret: optionalString(response.body, 'client_secret'),
            tokenEndpointAuthMethod: optionalString(response.body, 'token_endpoint_auth_method'),
        };
    }

    private async authorizeDevice(metadata: OAuthMetadata, state: OAuthState): Promise<OAuthState> {
        const request = this.withClientAuthentication(
            {
                client_id: requiredStateValue(state.clientId, 'clientId'),
                resource: metadata.resource,
            },
            state,
        );
        const response = await this.postForm(metadata.deviceAuthorizationEndpoint, request);

        if (!isSuccessful(response.status)) {
            throw tokenError(response, '飞书 OAuth 设备授权失败');
        }

        const deviceCode = getString(response.body, 'device_code');
        const userCode = getString(response.body, 'user_code');
        const verificationUrl =
            getString(response.body, 'verification_uri_complete') || getString(response.body, 'verification_uri');

        if (!deviceCode || !userCode || !verificationUrl) {
            throw new Error('飞书 OAuth 设备授权返回数据不完整');
        }

        const verificationUri = vscode.Uri.parse(verificationUrl);
        await vscode.env.openExternal(verificationUri);
        void vscode.window
            .showInformationMessage(`请在浏览器中完成飞书授权（验证码：${userCode}）`, '重新打开授权页')
            .then((selection) => {
                if (selection === '重新打开授权页') {
                    return vscode.env.openExternal(verificationUri);
                }
                return undefined;
            });

        const expiresIn = positiveNumber(response.body.expires_in, 900);
        let interval = positiveNumber(response.body.interval, 5);
        const deadline = Date.now() + expiresIn * 1000;

        while (Date.now() < deadline) {
            await sleep(interval * 1000);
            const tokenResponse = await this.postForm(
                metadata.tokenEndpoint,
                this.withClientAuthentication(
                    {
                        grant_type: DEVICE_GRANT,
                        device_code: deviceCode,
                        client_id: requiredStateValue(state.clientId, 'clientId'),
                        resource: metadata.resource,
                    },
                    state,
                ),
            );

            if (isSuccessful(tokenResponse.status)) {
                return withTokenResponse(state, tokenResponse.body);
            }

            const code = getString(tokenResponse.body, 'error');

            if (code === 'authorization_pending') {
                continue;
            }

            if (code === 'slow_down') {
                interval += 5;
                continue;
            }

            throw tokenError(tokenResponse, '飞书 OAuth 授权失败');
        }

        throw new Error('飞书 OAuth 授权超时');
    }

    private async refresh(metadata: OAuthMetadata, state: OAuthState): Promise<OAuthState> {
        const response = await this.postForm(
            metadata.tokenEndpoint,
            this.withClientAuthentication(
                {
                    grant_type: 'refresh_token',
                    refresh_token: requiredStateValue(state.refreshToken, 'refreshToken'),
                    client_id: requiredStateValue(state.clientId, 'clientId'),
                    resource: metadata.resource,
                },
                state,
            ),
        );

        if (!isSuccessful(response.status)) {
            throw tokenError(response, '飞书 OAuth 令牌刷新失败');
        }

        return withTokenResponse(state, response.body);
    }

    private withClientAuthentication(values: Record<string, string>, state: OAuthState): Record<string, string> {
        if (
            state.tokenEndpointAuthMethod === 'client_secret_post' &&
            state.clientSecret
        ) {
            return { ...values, client_secret: state.clientSecret };
        }

        return values;
    }

    private async getJson(url: string): Promise<JsonResponse> {
        const response = await fetchWithTimeout(
            url,
            {
                headers: {
                    Accept: 'application/json',
                    'MCP-Protocol-Version': '2025-03-26',
                },
            },
            REQUEST_TIMEOUT_MS,
        );
        return { status: response.status, body: await readJsonObject(response) };
    }

    private async postJson(url: string, body: Record<string, unknown>): Promise<JsonResponse> {
        const response = await fetchWithTimeout(
            url,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            },
            REQUEST_TIMEOUT_MS,
        );
        return { status: response.status, body: await readJsonObject(response) };
    }

    private async postForm(url: string, values: Record<string, string>): Promise<JsonResponse> {
        const form = new URLSearchParams();

        for (const [key, value] of Object.entries(values)) {
            if (value) {
                form.set(key, value);
            }
        }

        const response = await fetchWithTimeout(
            url,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: form.toString(),
            },
            REQUEST_TIMEOUT_MS,
        );
        return { status: response.status, body: await readJsonObject(response) };
    }

    private async loadState(): Promise<OAuthState> {
        const serialized = await this.secrets.get(this.secretKey);

        if (!serialized) {
            return emptyState();
        }

        try {
            const parsed: unknown = JSON.parse(serialized);

            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return { ...emptyState(), ...(parsed as Partial<OAuthState>) };
            }
        } catch {
            // Ignore corrupt state and start a new authorization flow.
        }

        return emptyState();
    }

    private async saveState(state: OAuthState): Promise<void> {
        await this.secrets.store(this.secretKey, JSON.stringify(state));
    }
}

function emptyState(): OAuthState {
    return { expiresAt: 0 };
}

function bearer(accessToken: string | undefined): AuthenticationHeader {
    if (!accessToken) {
        throw new Error('飞书 OAuth 访问令牌不可用');
    }

    return { name: 'Authorization', value: `Bearer ${accessToken}` };
}

function withTokenResponse(state: OAuthState, body: Record<string, unknown>): OAuthState {
    const accessToken = getString(body, 'access_token');

    if (!accessToken) {
        throw new Error('飞书 OAuth 未返回 access_token');
    }

    const expiresIn = positiveNumber(body.expires_in, 3600);

    return {
        ...state,
        accessToken,
        refreshToken: optionalString(body, 'refresh_token') || state.refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
    };
}

function requireSuccess(response: JsonResponse, context: string): void {
    if (!isSuccessful(response.status)) {
        throw tokenError(response, context);
    }
}

function tokenError(response: JsonResponse, context: string): OAuthTokenError {
    const code = getString(response.body, 'error');
    const description = getString(response.body, 'error_description');
    const detail = description || code;
    return new OAuthTokenError(
        `${context} (HTTP ${response.status})${detail ? `: ${summarize(detail, 200)}` : ''}`,
        code,
    );
}

function requiredUrl(body: Record<string, unknown>, key: string): string {
    const value = getString(body, key);

    if (!value) {
        throw new Error(`飞书 OAuth 元数据缺少 ${key}`);
    }

    return new URL(value).toString();
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
    return getString(body, key) || undefined;
}

function requiredStateValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`飞书 OAuth 状态缺少 ${name}`);
    }

    return value;
}

function positiveNumber(value: unknown, fallback: number): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isSuccessful(status: number): boolean {
    return status >= 200 && status < 300;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class OAuthTokenError extends Error {
    constructor(message: string, readonly code: string) {
        super(message);
    }

    requiresNewAuthorization(): boolean {
        return ['invalid_client', 'invalid_grant', 'access_denied', 'expired_token'].includes(this.code);
    }
}
