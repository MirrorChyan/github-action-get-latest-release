const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

async function runAction(inputs, api) {
    const outputs = {};
    const failures = [];
    const core = {
        getInput: name => inputs[name] || '',
        info: () => {},
        setOutput: (name, value) => { outputs[name] = value; },
        setFailed: message => { failures.push(message); },
    };
    const modules = {
        '@actions/core': core,
        '@octokit/rest': { Octokit: class { constructor() { this.repos = api; } } },
    };
    await vm.runInNewContext(source, {
        require: name => {
            assert.ok(Object.hasOwn(modules, name), `Unexpected module: ${name}`);
            return modules[name];
        },
    }, { filename: 'main.js' });
    return { outputs, failures };
}

test('looks up an older Unicode tag directly without listing recent releases', async () => {
    const tag = 'v2026.1020.23431.杂鱼';
    const result = await runAction({ repository: 'AlkaidLab/foundation-sunshine', tag }, {
        getReleaseByTag: async request => {
            assert.equal(request.owner, 'AlkaidLab');
            assert.equal(request.repo, 'foundation-sunshine');
            assert.equal(request.tag, tag);
            return { data: { tag_name: tag, id: 123, body: '中文发布说明' } };
        },
        listReleases: async () => {
            assert.fail('An explicit tag must not depend on the first page of releases');
        },
    });
    assert.deepEqual(result, {
        outputs: { release: tag, id: '123', description: '中文发布说明' },
        failures: [],
    });
});

test('keeps exclusions when selecting the latest release', async () => {
    const result = await runAction({ owner: 'owner', repo: 'repo', excludes: 'draft,prerelease' }, {
        listReleases: async () => ({ data: [
            { tag_name: 'draft', draft: true },
            { tag_name: 'preview', prerelease: true },
            { tag_name: 'v1', id: 456, body: 'Stable notes' },
        ] }),
    });
    assert.deepEqual(result, {
        outputs: { release: 'v1', id: '456', description: 'Stable notes' },
        failures: [],
    });
});

test('applies exclusions to an explicitly requested release', async () => {
    const result = await runAction({ tag: 'draft', excludes: 'draft' }, {
        getReleaseByTag: async () => ({ data: { tag_name: 'draft', draft: true } }),
    });
    assert.deepEqual(result, { outputs: {}, failures: ['No valid releases'] });
});

test('reports lookup failures without returning a different release', async () => {
    const result = await runAction({ tag: 'missing' }, {
        getReleaseByTag: async () => { throw new Error('Not Found'); },
    });
    assert.deepEqual(result, { outputs: {}, failures: ['Not Found'] });
});
