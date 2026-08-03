import * as assert from 'assert';
import { getLocalBranchNames } from '../branchLens';
import { parseBranchTaskId } from '../branchLens/branchParser';
import { parseMcpConfig, usesStaticHeader } from '../branchLens/config';
import { parseProjectSpaces, parseWorkItem } from '../branchLens/responseParser';

suite('Feishu Branch Lens', () => {
    test('parses the last task id segment from a branch name', () => {
        assert.strictEqual(parseBranchTaskId('feature/m-6995279777'), '6995279777');
        assert.strictEqual(parseBranchTaskId('feature/g-6653379205-hotfix'), '6653379205');
        assert.strictEqual(parseBranchTaskId('feature/m-111/merge/g-222'), '222');
        assert.strictEqual(parseBranchTaskId('feature/no-task'), undefined);
    });

    test('parses URL-only and static-header MCP configurations', () => {
        const oauthConfig = parseMcpConfig(`
            [mcp_servers.FeishuProjectMcp]
            url = "https://project.feishu.cn/mcp_server/v1"
        `);
        assert.deepStrictEqual(oauthConfig, {
            url: 'https://project.feishu.cn/mcp_server/v1',
            headerName: undefined,
            token: undefined,
        });
        assert.strictEqual(usesStaticHeader(oauthConfig!), false);

        const staticConfig = parseMcpConfig(`
            [mcp_servers.Other]
            url = "https://other.example/mcp"
            [mcp_servers.FeishuProjectMcp]
            url = "https://feishu.example/mcp"
            [mcp_servers.FeishuProjectMcp.http_headers]
            X-Mcp-Token = "secret-token"
        `);
        assert.deepStrictEqual(staticConfig, {
            url: 'https://feishu.example/mcp',
            headerName: 'X-Mcp-Token',
            token: 'secret-token',
        });
        assert.strictEqual(usesStaticHeader(staticConfig!), true);
    });

    test('parses project spaces and work item responses', () => {
        assert.deepStrictEqual(
            parseProjectSpaces(JSON.stringify({
                projects: [
                    { project_key: 'project-a', name: '项目 A', simple_name: 'a' },
                    { project_key: '', name: 'ignored' },
                ],
            })),
            [{ projectKey: 'project-a', name: '项目 A', simpleName: 'a' }],
        );

        assert.deepStrictEqual(
            parseWorkItem(JSON.stringify({
                work_item_attribute: {
                    owned_project: { key: 'project-a' },
                    work_item_id: '6995279777',
                    work_item_name: '【功能】实时任务报错日志优化',
                },
            })),
            {
                id: '6995279777',
                title: '【功能】实时任务报错日志优化',
                projectKey: 'project-a',
            },
        );
        assert.strictEqual(parseWorkItem('not-json'), undefined);
    });

    test('loads local branches through the current Git API', async () => {
        let remote: boolean | undefined;
        const branchNames = await getLocalBranchNames({
            getBranches: async (query) => {
                remote = query.remote;
                return [
                    { type: 0, name: 'feature/b' },
                    { type: 0, name: 'main' },
                    { type: 0, name: 'feature/a' },
                    { type: 0, name: 'feature/a' },
                ];
            },
        }, 'main');

        assert.strictEqual(remote, false);
        assert.deepStrictEqual(branchNames, ['main', 'feature/a', 'feature/b']);
    });
});
