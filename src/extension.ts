import * as vscode from 'vscode';
import * as child_process from 'child_process';

import { DepNodeProvider } from './nodeDependencies';

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

export function activate(context: vscode.ExtensionContext) {
	const nodeDependenciesProvider = new DepNodeProvider(context);
	vscode.window.registerTreeDataProvider('visualgdb-commands', nodeDependenciesProvider);
	vscode.commands.registerCommand('visualgdb.openWorkspaceInVisualGDB', () => {
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

		child_process.spawn(codeVROOM, ['--vscode', workspaceDir], { detached: true, stdio: 'ignore' }).unref();
	});
}