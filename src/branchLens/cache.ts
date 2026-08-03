import * as vscode from 'vscode';

const CACHE_KEY = 'feishuBranchLens.titleCache';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface BranchTitleCacheEntry {
    title: string;
    projectKey: string;
    updatedAt: number;
}

export class BranchTitleCache {
    private readonly entries: Record<string, BranchTitleCacheEntry>;
    private persistQueue: Promise<void> = Promise.resolve();

    constructor(private readonly storage: vscode.Memento) {
        this.entries = { ...storage.get<Record<string, BranchTitleCacheEntry>>(CACHE_KEY, {}) };
    }

    getFresh(taskId: string): BranchTitleCacheEntry | undefined {
        const entry = this.entries[taskId];

        if (!entry || Date.now() - entry.updatedAt > MAX_AGE_MS) {
            return undefined;
        }

        return { ...entry };
    }

    getAny(taskId: string): BranchTitleCacheEntry | undefined {
        const entry = this.entries[taskId];
        return entry ? { ...entry } : undefined;
    }

    put(taskId: string, title: string, projectKey: string): void {
        this.entries[taskId] = {
            title,
            projectKey,
            updatedAt: Date.now(),
        };
        this.persistQueue = this.persistQueue
            .then(() => this.storage.update(CACHE_KEY, this.entries))
            .catch(() => undefined);
    }
}
