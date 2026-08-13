import * as vscode from 'vscode';
import { parseBranchTaskId } from './branchParser';
import { WorkItemInfo } from './responseParser';
import { BranchTitleService } from './service';

const COMMAND_ID = 'feishuBranchLens.show';

type LoadState = 'loading' | 'loaded' | 'notFound' | 'failed' | 'noTask';

interface BranchQuickPickItem extends vscode.QuickPickItem {
    branchName: string;
    taskId?: string;
    current: boolean;
    title?: string;
    failureMessage?: string;
    state: LoadState;
}

interface GitRef {
    type: number;
    name?: string;
}

interface GitRepositoryState {
    HEAD?: GitRef;
}

interface GitRepository {
    rootUri: vscode.Uri;
    state: GitRepositoryState;
    status(): Promise<void>;
    getBranches(query: { remote?: boolean }): Promise<GitRef[]>;
    checkout(treeish: string): Promise<void>;
}

interface GitApi {
    repositories: GitRepository[];
}

interface GitExtension {
    enabled: boolean;
    getAPI(version: 1): GitApi;
}

let branchTitleService: BranchTitleService | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function activateBranchLens(context: vscode.ExtensionContext): void {
    branchTitleService = new BranchTitleService(context);
    outputChannel = vscode.window.createOutputChannel('Feishu Branch Lens');

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBarItem.name = 'Feishu Branch Lens';
    statusBarItem.text = '$(git-branch) 飞书功能分支';
    statusBarItem.tooltip = '按分支名或飞书工作项标题搜索并切换本地分支';
    statusBarItem.command = COMMAND_ID;
    statusBarItem.show();

    context.subscriptions.push(
        branchTitleService,
        outputChannel,
        statusBarItem,
        vscode.commands.registerCommand(COMMAND_ID, () => showBranchPicker(branchTitleService as BranchTitleService)),
    );
}

export function deactivateBranchLens(): void {
    branchTitleService?.dispose();
    branchTitleService = undefined;
    outputChannel = undefined;
}

async function showBranchPicker(service: BranchTitleService): Promise<void> {
    const repository = await getPrimaryGitRepository();

    if (!repository) {
        await vscode.window.showWarningMessage('当前工作区没有可用的 Git 仓库。');
        return;
    }

    await repository.status();
    const currentBranch = repository.state.HEAD?.name || '';
    const branchNames = await getLocalBranchNames(repository, currentBranch);

    if (!branchNames.length) {
        await vscode.window.showInformationMessage('当前仓库没有本地分支。');
        return;
    }

    const items = branchNames.map((branchName) => createBranchItem(branchName, currentBranch, service));
    const quickPick = vscode.window.createQuickPick<BranchQuickPickItem>();
    quickPick.title = '飞书功能分支';
    quickPick.placeholder = '搜索分支名或飞书工作项标题';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = items;

    let disposed = false;
    let pendingCount = 0;
    const refresh = () => {
        if (!disposed) {
            quickPick.items = [...items];
            quickPick.busy = pendingCount > 0;
        }
    };

    const eventSubscriptions: vscode.Disposable[] = [];
    eventSubscriptions.push(quickPick.onDidHide(() => {
        disposed = true;
        eventSubscriptions.forEach((subscription) => subscription.dispose());
        quickPick.dispose();
    }));
    eventSubscriptions.push(quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];

        if (!selected || selected.current) {
            quickPick.hide();
            return;
        }

        quickPick.enabled = false;
        quickPick.busy = true;
        void vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在切换到 ${selected.branchName}`,
            },
            () => repository.checkout(selected.branchName),
        ).then(
            () => quickPick.hide(),
            async (error) => {
                quickPick.enabled = true;
                quickPick.busy = pendingCount > 0;
                await vscode.window.showErrorMessage(`切换分支失败：${failureMessage(error)}`);
            },
        );
    }));

    quickPick.show();

    const pendingItems = items.filter((item) => item.state === 'loading');

    if (!pendingItems.length) {
        return;
    }

    if (!service.hasMcpConfiguration()) {
        for (const item of pendingItems) {
            setFailed(item, '~/.codex/config.toml 中缺少 FeishuProjectMcp 配置');
        }
        refresh();
        await vscode.window.showWarningMessage('未找到 FeishuProjectMcp 配置，已仅展示本地分支。');
        return;
    }

    const itemsByTaskId = new Map<string, BranchQuickPickItem[]>();

    for (const item of pendingItems) {
        const taskItems = itemsByTaskId.get(item.taskId as string) || [];
        taskItems.push(item);
        itemsByTaskId.set(item.taskId as string, taskItems);
    }

    pendingCount = itemsByTaskId.size;
    refresh();

    for (const [taskId, taskItems] of itemsByTaskId) {
        void service.resolve(taskId).then(
            (workItem) => updateResolvedItems(taskItems, workItem),
            (error) => {
                const message = failureMessage(error);
                log(`任务 ${taskId} 查询失败：${message}`);
                taskItems.forEach((item) => setFailed(item, message));
            },
        ).finally(() => {
            pendingCount -= 1;
            refresh();
        });
    }
}

export async function getLocalBranchNames(
    repository: Pick<GitRepository, 'getBranches'>,
    currentBranch: string,
): Promise<string[]> {
    const localBranches = await repository.getBranches({ remote: false });
    const branchNames = Array.from(
        new Set(
            localBranches
                .filter((ref) => ref.name)
                .map((ref) => ref.name as string),
        ),
    ).sort((left, right) => {
        if (left === currentBranch) {
            return -1;
        }
        if (right === currentBranch) {
            return 1;
        }
        return left.localeCompare(right);
    });

    return branchNames;
}

function createBranchItem(
    branchName: string,
    currentBranch: string,
    service: BranchTitleService,
): BranchQuickPickItem {
    const taskId = parseBranchTaskId(branchName);
    const title = taskId ? service.cachedTitle(taskId) : undefined;
    const item: BranchQuickPickItem = {
        label: branchName === currentBranch ? `$(check) ${branchName}` : `$(git-branch) ${branchName}`,
        branchName,
        taskId,
        current: branchName === currentBranch,
        title,
        state: !taskId ? 'noTask' : title ? 'loaded' : 'loading',
    };
    updateItemPresentation(item);
    return item;
}

function updateResolvedItems(items: BranchQuickPickItem[], workItem: WorkItemInfo | undefined): void {
    for (const item of items) {
        if (workItem) {
            item.title = workItem.title;
            item.state = 'loaded';
        } else {
            item.state = 'notFound';
        }
        updateItemPresentation(item);
    }
}

function setFailed(item: BranchQuickPickItem, message: string): void {
    item.failureMessage = message;
    item.state = 'failed';
    updateItemPresentation(item);
}

function updateItemPresentation(item: BranchQuickPickItem): void {
    item.description =
        item.state === 'loaded' ? item.title :
            item.state === 'loading' ? '获取中…' :
                item.state === 'notFound' ? '未找到工作项' :
                    item.state === 'failed' ? `获取失败：${item.failureMessage || '未知错误'}` :
                        '无任务编号';
    item.detail = item.taskId ? `飞书任务 ${item.taskId}` : undefined;
}

async function getPrimaryGitRepository(): Promise<GitRepository | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!extension) {
        return undefined;
    }

    const exports = extension.isActive ? extension.exports : await extension.activate();

    if (!exports.enabled) {
        return undefined;
    }

    return exports.getAPI(1).repositories[0];
}

function failureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const oneLine = message.replace(/\s+/g, ' ').trim() || '未知错误';
    return oneLine.length <= 120 ? oneLine : `${oneLine.slice(0, 120)}...`;
}

function log(message: string): void {
    outputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}
