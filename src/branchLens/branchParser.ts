const TASK_PATTERN = /(?:^|\/)[a-zA-Z]-(\d+)(?=$|[-_/])/g;

export function parseBranchTaskId(branchName: string): string | undefined {
    let taskId: string | undefined;
    let match = TASK_PATTERN.exec(branchName);

    while (match) {
        taskId = match[1];
        match = TASK_PATTERN.exec(branchName);
    }

    TASK_PATTERN.lastIndex = 0;
    return taskId;
}
