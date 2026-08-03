import * as vscode from 'vscode';
import { BranchTitleCache } from './cache';
import { loadDefaultMcpConfig } from './config';
import { FeishuMcpClient } from './mcpClient';
import { parseProjectSpaces, parseWorkItem, ProjectSpace, WorkItemInfo } from './responseParser';

export class BranchTitleService implements vscode.Disposable {
    private readonly cache: BranchTitleCache;
    private readonly inFlight = new Map<string, Promise<WorkItemInfo | undefined>>();
    private clientPromise: Promise<FeishuMcpClient> | undefined;
    private spacesPromise: Promise<ProjectSpace[]> | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.cache = new BranchTitleCache(context.globalState);
    }

    hasMcpConfiguration(): boolean {
        return loadDefaultMcpConfig() !== undefined;
    }

    cachedTitle(taskId: string): string | undefined {
        return this.cache.getFresh(taskId)?.title;
    }

    resolve(taskId: string): Promise<WorkItemInfo | undefined> {
        const cached = this.cache.getFresh(taskId);

        if (cached) {
            return Promise.resolve({
                id: taskId,
                title: cached.title,
                projectKey: cached.projectKey,
            });
        }

        const current = this.inFlight.get(taskId);

        if (current) {
            return current;
        }

        const pending = this.fetch(taskId).finally(() => this.inFlight.delete(taskId));
        this.inFlight.set(taskId, pending);
        return pending;
    }

    dispose(): void {
        const clientPromise = this.clientPromise;
        this.clientPromise = undefined;
        this.spacesPromise = undefined;

        if (clientPromise) {
            void clientPromise.then((client) => client.close(), () => undefined);
        }
    }

    private async fetch(taskId: string): Promise<WorkItemInfo | undefined> {
        const projectKeys = new Set<string>();
        const previousProjectKey = this.cache.getAny(taskId)?.projectKey;

        if (previousProjectKey) {
            projectKeys.add(previousProjectKey);
        }

        for (const space of await this.loadSpaces()) {
            projectKeys.add(space.projectKey);
        }

        let lastFailure: unknown;

        for (const projectKey of projectKeys) {
            try {
                const response = await (await this.getClient()).callTextTool('get_workitem_brief', {
                    project_key: projectKey,
                    work_item_id: taskId,
                });
                const workItem = parseWorkItem(response);

                if (workItem) {
                    this.cache.put(taskId, workItem.title, workItem.projectKey);
                    return workItem;
                }
            } catch (error) {
                lastFailure = error;
            }
        }

        if (lastFailure) {
            throw lastFailure;
        }

        return undefined;
    }

    private loadSpaces(): Promise<ProjectSpace[]> {
        if (!this.spacesPromise) {
            this.spacesPromise = this.fetchSpaces().catch((error) => {
                this.spacesPromise = undefined;
                throw error;
            });
        }

        return this.spacesPromise;
    }

    private async fetchSpaces(): Promise<ProjectSpace[]> {
        const response = await (await this.getClient()).callTextTool('search_project_info', { page_num: 1 });
        const spaces = parseProjectSpaces(response);

        if (!spaces.length) {
            throw new Error('飞书 MCP 未返回可访问的项目空间');
        }

        return spaces;
    }

    private getClient(): Promise<FeishuMcpClient> {
        if (!this.clientPromise) {
            const config = loadDefaultMcpConfig();

            if (!config) {
                return Promise.reject(new Error('~/.codex/config.toml 中缺少 FeishuProjectMcp 配置'));
            }

            this.clientPromise = FeishuMcpClient.create(config, this.context.secrets).catch((error) => {
                this.clientPromise = undefined;
                throw error;
            });
        }

        return this.clientPromise;
    }
}
