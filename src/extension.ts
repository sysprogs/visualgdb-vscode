import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';

import { VisualGDBNodeProvider } from './commandNodeTree';
import { LogScope, initOutputChannel, showErrorWithOutputChannel } from './logScope';
import { downloadCodeVROOM } from './downloadTools';
import { findCodeVROOM } from './codeVroomLocator';

export let outputChannel: vscode.OutputChannel;

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

	const vscodeVars: Record<string, unknown> = {};

	for (const cmd of commands) {
		try {
			log.log(`Evaluating ${cmd}`);
			const result = await vscode.commands.executeCommand(cmd);
			vscodeVars[`command:${cmd}`] = result;
		} catch (e) {
			log.logException(e);
			vscodeVars[`command:${cmd}`] = null;
		}
	}

	const cache = {
		'vscode-vars': vscodeVars,
		'environment': process.env,
		'diagnostics': {
			'eval_time': Date.now()
		}
	};

	log.log(`Evaluated ${commands.size} variables`);

	const cacheFilePath = path.join(vscodeDir, 'sysprogs-var-cache.json');
	try {
		fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, '\t'), 'utf8');
	} catch (e) {
		log.logException(e);
	}
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

async function handleOpenWorkspaceInVisualGDB(extensionVersion: string) {
	const log = new LogScope();

	if (vscode.debug.activeDebugSession) {
		vscode.window.showErrorMessage('Please stop debugging before launching VisualGDB');
		return;
	}

	let codeVROOM = findCodeVROOM(log);
	if (!codeVROOM) {
		const choice = await vscode.window.showWarningMessage(
			'VisualGDB requires CodeVROOM to display advanced GUI',
			'Download CodeVROOM',
			'Locate Manually'
		);

		if (choice === 'Download CodeVROOM') {
			codeVROOM = await downloadCodeVROOM(log, extensionVersion);
			if (!codeVROOM)
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
		showErrorWithOutputChannel('No workspace is open');
		return;
	}

	await evaluateAndCacheCommands(workspaceDir, log);

	log.log(`Launching ${codeVROOM}`);
	child_process.spawn(codeVROOM, ['--vscode', workspaceDir], { detached: true, stdio: 'ignore' }).unref();
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('VisualGDB');
	
	context.subscriptions.push(outputChannel);
	initOutputChannel(outputChannel);

	const extensionVersion: string = context.extension.packageJSON?.version ?? '0.0.0';

	const nodeDependenciesProvider = new VisualGDBNodeProvider(context);
	vscode.window.registerTreeDataProvider('visualgdb-commands', nodeDependenciesProvider);
	vscode.commands.registerCommand('visualgdb.openWorkspaceInVisualGDB', () => handleOpenWorkspaceInVisualGDB(extensionVersion));
	vscode.commands.registerCommand('visualgdb.analyzeCMake', analyzeCMake);
}

async function analyzeCMake() {
	const log = new LogScope();
	const separator = process.platform === 'win32' ? ';' : ':';
	const pathDirs = (process.env.PATH ?? '').split(separator);
	log.log('PATH directories:');
	for (const dir of pathDirs)
	{
		log.log(dir);
	}
}