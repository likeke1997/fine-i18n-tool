export async function fetchWithTimeout(
    input: string | URL,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

export async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();

    if (!text.trim()) {
        return {};
    }

    try {
        const value: unknown = JSON.parse(text);
        return isObject(value) ? value : {};
    } catch {
        return {};
    }
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getString(object: Record<string, unknown>, key: string): string {
    const value = object[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function summarize(value: unknown, maxLength = 240): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();

    if (!text) {
        return '(empty)';
    }

    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}
