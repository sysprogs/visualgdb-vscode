import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { GetStringRegKey } from '@vscode/windows-registry';

import { DepNodeProvider } from './nodeDependencies';

let outputChannel: vscode.OutputChannel;

class LogScope {
	private readonly startTime: number;

	constructor() {
		this.startTime = Date.now();
	}

	log(line: string): void {
		const elapsed = Date.now() - this.startTime;
		const elapsedStr = elapsed.toString().padStart(8, ' ');
		outputChannel.appendLine(`[+${elapsedStr}] ${line}`);
	}

	logException(e: unknown): void {
		const details = e instanceof Error ? e.message : String(e);
		this.log(`***EXCEPTION*** ${details}`);
	}
}

function TryQueryLocationFromRegistry(hive: 'HKEY_CURRENT_USER' | 'HKEY_LOCAL_MACHINE', log: LogScope): string | undefined {
	const regPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\CodeVROOM.exe';
	log.log(`Trying (registry) ${hive}\\${regPath}\\Path`);
	try {
		const fullPath = GetStringRegKey(hive, regPath, 'Path');
		if (fullPath) {
			try {
				fs.accessSync(fullPath, fs.constants.X_OK);
				return fullPath;
			} catch (e) {
				log.logException(e);
			}
		}
	} catch (e) {
		log.logException(e);
	}
	return undefined;
}

function findCodeVROOM(log: LogScope): string | undefined {
	log.log('Locating CodeVROOM executable...');

	if (process.platform !== 'win32')
		return undefined;

	const fromHKCU = TryQueryLocationFromRegistry('HKEY_CURRENT_USER', log);
	if (fromHKCU) {
		log.log(`Found ${fromHKCU}`);
		return fromHKCU;
	}

	const fromHKLM = TryQueryLocationFromRegistry('HKEY_LOCAL_MACHINE', log);
	if (fromHKLM) {
		log.log(`Found ${fromHKLM}`);
		return fromHKLM;
	}

	return undefined;
}

function LoadCommandReferencesFromJSON(dir: string, filename: string, result: Set<string>, log: LogScope): void {
	let raw: string;
	try {
		raw = fs.readFileSync(path.join(dir, filename), 'utf8');
	} catch (e) {
		log.logException(e);
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

async function evaluateAndCacheCommands(workspaceDir: string, log: LogScope): Promise<void> {
	const vscodeDir = path.join(workspaceDir, '.vscode');
	const commands = new Set<string>();
	LoadCommandReferencesFromJSON(vscodeDir, 'launch.json', commands, log);
	LoadCommandReferencesFromJSON(vscodeDir, 'cmake-kits.json', commands, log);

	log.log(`Evaluating workspace variables...`);

	const cache: Record<string, unknown> = {};

	for (const cmd of commands) {
		try {
			log.log(`Evaluating ${cmd}`);
			const result = await vscode.commands.executeCommand(cmd);
			cache[`command:${cmd}`] = result;
		} catch (e) {
			log.logException(e);
			cache[`command:${cmd}`] = null;
		}
	}

	const elapsed = Date.now();
	cache['diagnostics:eval_time'] = elapsed;

	log.log(`Evaluated ${commands.size} variables`);

	const cacheFilePath = path.join(vscodeDir, 'sysprogs-var-cache.json');
	try {
		fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, '\t'), 'utf8');
	} catch (e) {
		log.logException(e);
	}
}

async function downloadCodeVROOM(log: LogScope): Promise<void> {
	log.log('Downloading CodeVROOM...');
	// TODO
}

async function locateCodeVROOMManually(log: LogScope): Promise<string | undefined> {
	const isWindows = process.platform === 'win32';
	const executable = isWindows ? 'CodeVROOM.exe' : 'CodeVROOM';

	const filters: Record<string, string[]> = isWindows
		? { 'Executable': ['exe'] }
		: { 'All Files': ['*'] };

	const uris = await vscode.window.showOpenDialog({
		canSelectMany: false,
		openLabel: 'Select CodeVROOM',
		filters,
		title: `Locate ${executable}`
	});

	if (!uris || uris.length === 0)
		return undefined;

	const selected = uris[0].fsPath;
	log.log(`Manually located: ${selected}`);
	return selected;
}

async function handleOpenWorkspaceInVisualGDB() {
	const log = new LogScope();

	let codeVROOM = findCodeVROOM(log);
	codeVROOM = undefined;	//for testing
	if (!codeVROOM) {
		const choice = await vscode.window.showWarningMessage(
			'VisualGDB GUI requires the CodeVROOM shell',
			'Download',
			'Locate Manually',
			'Close'
		);

		if (choice === 'Download') {
			await downloadCodeVROOM(log);
			return;
		} else if (choice === 'Locate Manually') {
			codeVROOM = await locateCodeVROOMManually(log);
			if (!codeVROOM)
				return;
		} else {
			return;
		}
	}

	const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceDir) {
		vscode.window.showErrorMessage('No workspace is open');
		return;
	}

	await evaluateAndCacheCommands(workspaceDir, log);

	log.log(`Launching ${codeVROOM}`);
	child_process.spawn(codeVROOM, ['--vscode', workspaceDir], { detached: true, stdio: 'ignore' }).unref();
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('VisualGDB');
	context.subscriptions.push(outputChannel);

	const nodeDependenciesProvider = new DepNodeProvider(context);
	vscode.window.registerTreeDataProvider('visualgdb-commands', nodeDependenciesProvider);
	vscode.commands.registerCommand('visualgdb.openWorkspaceInVisualGDB', () => handleOpenWorkspaceInVisualGDB());
}