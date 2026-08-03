export interface ProjectSpace {
    projectKey: string;
    name: string;
    simpleName: string;
}

export interface WorkItemInfo {
    id: string;
    title: string;
    projectKey: string;
}

export function parseProjectSpaces(text: string): ProjectSpace[] {
    const root = parseObject(text);
    const projects = root?.projects;

    if (!Array.isArray(projects)) {
        return [];
    }

    return projects.flatMap((value) => {
        const project = asObject(value);
        const projectKey = getString(project, 'project_key');

        if (!projectKey) {
            return [];
        }

        return [
            {
                projectKey,
                name: getString(project, 'name'),
                simpleName: getString(project, 'simple_name'),
            },
        ];
    });
}

export function parseWorkItem(text: string): WorkItemInfo | undefined {
    const root = parseObject(text);
    const attribute = asObject(root?.work_item_attribute);
    const ownedProject = asObject(attribute?.owned_project);
    const id = getString(attribute, 'work_item_id');
    const title = getString(attribute, 'work_item_name');
    const projectKey = getString(ownedProject, 'key');

    if (!id || !title || !projectKey) {
        return undefined;
    }

    return { id, title, projectKey };
}

function parseObject(text: string): Record<string, unknown> | undefined {
    try {
        return asObject(JSON.parse(text));
    } catch {
        return undefined;
    }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function getString(object: Record<string, unknown> | undefined, key: string): string {
    const value = object?.[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
