import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

import { LogScope, showErrorWithOutputChannel } from './logScope';
import { findCodeVROOM } from './codeVroomLocator';

function downloadFile(url: string, downloadedInstallerFile: string, log: LogScope, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
	return new Promise((resolve, reject) => {
		log.log(`Downloading ${url} -> ${downloadedInstallerFile}`);
		const file = fs.createWriteStream(downloadedInstallerFile);

		const request = (redirectUrl: string) => {
			https.get(redirectUrl, response => {
				if (response.statusCode === 301 || response.statusCode === 302) {
					const location = response.headers.location;
					if (!location)
						return reject(new Error('Redirect with no location header'));
					log.log(`Redirecting to ${location}`);
					request(location);
					return;
				}

				if (response.statusCode !== 200) {
					reject(new Error(`HTTP ${response.statusCode}`));
					return;
				}

				const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10);
				let downloadedBytes = 0;
				let lastReportedPercent = 0;

				response.on('data', (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					if (totalBytes > 0) {
						const percent = Math.floor((downloadedBytes / totalBytes) * 100);
						const increment = percent - lastReportedPercent;
						if (increment > 0) {
							progress.report({ message: `${percent}%`, increment });
							lastReportedPercent = percent;
						}
					}
				});

				response.pipe(file);
				file.on('finish', () => file.close(() => resolve()));
				file.on('error', err => {
					fs.unlink(downloadedInstallerFile, () => { });
					reject(err);
				});
			}).on('error', err => {
				fs.unlink(downloadedInstallerFile, () => { });
				reject(err);
			});
		};

		request(url);
	});
}

function runProcessAndWait(executable: string, args: string[], log: LogScope): Promise<number> {
	return new Promise((resolve, reject) => {
		log.log(`Running ${executable} ${args.join(' ')}`);
		const proc = child_process.spawn(executable, args, { stdio: 'ignore' });
		proc.on('error', err => reject(err));
		proc.on('close', code => resolve(code ?? -1));
	});
}

async function installOnWindows(
	downloadedInstallerFile: string,
	log: LogScope,
	progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<boolean> {
	log.log('Download complete, running Windows installer...');
	progress.report({ message: 'Installing...', increment: 100 });

	let exitCode: number;
	try {
		exitCode = await runProcessAndWait(downloadedInstallerFile, ['--autoinstall'], log);
	} catch (e) {
		log.logException(e);
		return false;
	} finally {
		try {
			fs.unlinkSync(downloadedInstallerFile);
		} catch (e) {
			log.logException(e);
		}
	}

	log.log(`Installer exited with code ${exitCode}`);
	return exitCode === 0;
}

async function installOnLinux(
	downloadedInstallerFile: string,
	log: LogScope,
	progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<boolean> {
	log.log('Download complete, extracting and running Linux installer...');
	progress.report({ message: 'Installing...', increment: 100 });

	const tempDir = path.dirname(downloadedInstallerFile);
	try {
		let exitCode: number;
		try {
			exitCode = await runProcessAndWait('tar', ['xf', downloadedInstallerFile, '-C', tempDir], log);
		} catch (e) {
			log.logException(e);
			return false;
		}

		if (exitCode !== 0) {
			log.log(`tar exited with code ${exitCode}`);
			return false;
		}

		const scriptPath = path.join(tempDir, 'content', 'SysprogsAIWorkbench');
		try {
			exitCode = await runProcessAndWait(scriptPath, ['--autoinstall'], log);
		} catch (e) {
			log.logException(e);
			return false;
		}

		log.log(`Installer script exited with code ${exitCode}`);
		return exitCode === 0;
	} finally {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch (e) {
			log.logException(e);
		}
	}
}

function installOnMac(log: LogScope): boolean {
	log.log('macOS installation is not supported');
	showErrorWithOutputChannel('CodeVROOM installation is not supported on macOS');
	return false;
}

export async function downloadCodeVROOM(log: LogScope, extensionVersion: string): Promise<string | undefined> {
	const platform = process.platform;
	const url = `https://sysprogs.com/CodeVROOM/download/autofetch/vscode?platform=${encodeURIComponent(platform)}&extver=${encodeURIComponent(extensionVersion)}`;

	log.log(`CodeVROOM download URL: ${url}`);

	let downloadedInstallerFile: string;
	if (platform === 'linux') {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codevroom-'));
		downloadedInstallerFile = path.join(tempDir, 'CodeVROOM.tar.xz');
	} else {
		const exeName = platform === 'win32' ? 'CodeVROOM-setup.exe' : 'CodeVROOM-setup';
		downloadedInstallerFile = path.join(os.tmpdir(), exeName);
	}

	const installSucceeded = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Downloading CodeVROOM',
			cancellable: false
		},
		async progress => {
			progress.report({ increment: 0 });

			if (platform === 'darwin')
				return installOnMac(log);

			try {
				await downloadFile(url, downloadedInstallerFile, log, progress);
			} catch (e) {
				log.logException(e);
				return false;
			}

			if (platform === 'win32')
				return await installOnWindows(downloadedInstallerFile, log, progress);
			else if (platform === 'linux')
				return await installOnLinux(downloadedInstallerFile, log, progress);
			else {
				log.log(`Unsupported platform: ${platform}`);
				showErrorWithOutputChannel(`CodeVROOM installation is not supported on platform: ${platform}`);
				return false;
			}
		}
	);

	if (!installSucceeded) {
		showErrorWithOutputChannel('Failed to install CodeVROOM');
		return undefined;
	}

	return findCodeVROOM(log);
}