/* eslint-disable */
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';

import { DepNodeProvider } from './nodeDependencies';

let outputChannel: vscode.OutputChannel;

function findCodeVROOM(): string | undefined {
	const isWindows = process.platform === 'win32';
	const executable = isWindows ? 'CodeVROOM.exe' : 'CodeVROOM';

	if (isWindows) {
		try {
			const regKey = require('child_process').execSync(
				'reg query "HKCU\\SOFTWARE\\Sysprogs\\CodeVROOM" /v VSCodeLauncher',
				{ encoding: 'utf8' }
			) as string;
			const match = regKey.match(/VSCodeLauncher\s+REG_SZ\s+(.+)/);
			if (match) {
				const location = match[1].trim();
				try {
					require('fs').accessSync(location, require('fs').constants.X_OK);
					return location;
				} catch {
					// registry entry exists but file is not accessible
				}
			}
		} catch (e) {
			//vscode.window.showErrorMessage(`Registry query failed: ${e}`);
		}
	}

	const pathDirs = (process.env.PATH ?? '').split(isWindows ? ';' : ':');

	for (const dir of pathDirs) {
		const fullPath = require('path').join(dir, executable);
		try {
			require('fs').accessSync(fullPath, require('fs').constants.X_OK);
			return fullPath;
		} catch {
			// not found in this dir, continue
		}
	}
	return undefined;
}

function LoadCommandReferencesFromJSON(dir: string, filename: string, result: Set<string>): void {
	let raw: string;
	try {
		raw = fs.readFileSync(path.join(dir, filename), 'utf8');
	} catch {
		return;
	}

	const parsed = jsonc.parse(raw);

	function walk(node: unknown): void {
		if (typeof node === 'string') {
			const regex = /\$\{command:([^}]+)\}/g;
			let match: RegExpExecArray | null;
			while ((match = regex.exec(node)) !== null)
				result.add(match[1]);
		} else if (Array.isArray(node)) {
			for (const item of node)
				walk(item);
		} else if (node !== null && typeof node === 'object') {
			for (const value of Object.values(node as Record<string, unknown>))
				walk(value);
		}
	}

	walk(parsed);
}

async function evaluateAndCacheCommands(workspaceDir: string): Promise<void> {
	const vscodeDir = path.join(workspaceDir, '.vscode');
	const commands = new Set<string>();
	LoadCommandReferencesFromJSON(vscodeDir, 'launch.json', commands);
	LoadCommandReferencesFromJSON(vscodeDir, 'cmake-kits.json', commands);

	outputChannel.appendLine(`Evaluating workspace variables...`);

	const startTime = Date.now();
	const cache: Record<string, unknown> = {};

	for (const cmd of commands) {
		try {
			const result = await vscode.commands.executeCommand(cmd);
			cache[`command:${cmd}`] = result;
		} catch {
			cache[`command:${cmd}`] = null;
		}
	}

	const elapsed = Date.now() - startTime;
	cache['diagnostics:eval_time'] = elapsed;

	outputChannel.appendLine(`Evaluated ${commands.size} variables in ${elapsed} msec`);

	const cacheFilePath = path.join(vscodeDir, 'sysprogs-var-cache.json');
	fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, '\t'), 'utf8');
}

async function handleOpenWorkspaceInVisualGDB(context: vscode.ExtensionContext) {
	const codeVROOM = findCodeVROOM();
	if (!codeVROOM) {
		vscode.window.showErrorMessage('Could not locate CodeVROOM in PATH');
		return;
	}

	const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceDir) {
		vscode.window.showErrorMessage('No workspace is open');
		return;
	}

	await evaluateAndCacheCommands(workspaceDir);

	child_process.spawn(codeVROOM, ['--vscode', workspaceDir], { detached: true, stdio: 'ignore' }).unref();
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('VisualGDB');
	context.subscriptions.push(outputChannel);

	const nodeDependenciesProvider = new DepNodeProvider(context);
	vscode.window.registerTreeDataProvider('visualgdb-commands', nodeDependenciesProvider);
	vscode.commands.registerCommand('visualgdb.openWorkspaceInVisualGDB', () => handleOpenWorkspaceInVisualGDB(context));
}