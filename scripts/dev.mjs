import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('项目需要 Node.js 24 或更高版本');
const commands = [
  ['--import', 'tsx', 'server/index.ts'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
];
const children = commands.map(args => spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true }));
for (const child of children) {
  child.on('error', error => { throw error; });
  child.on('exit', code => { for (const sibling of children) if (sibling !== child) sibling.kill(); process.exitCode = code ?? 1; });
}
process.once('SIGINT', () => { for (const child of children) child.kill(); });
process.once('SIGTERM', () => { for (const child of children) child.kill(); });
