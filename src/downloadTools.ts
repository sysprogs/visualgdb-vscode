import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

import { LogScope } from './logScope';
import { findCodeVROOM, showErrorWithOutputChannel } from './extension';

function downloadFile(url: string, destPath: string, log: LogScope, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
	return new Promise((resolve, reject) => {
		log.log(`Downloading ${url} -> ${destPath}`);
		const file = fs.createWriteStream(destPath);

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
					fs.unlink(destPath, () => { });
					reject(err);
				});
			}).on('error', err => {
				fs.unlink(destPath, () => { });
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

export async function downloadCodeVROOM(log: LogScope, extensionVersion: string): Promise<string | undefined> {
	const platform = process.platform;
	const url = `https://sysprogs.com/CodeVROOM/download/vscode-get?platform=${encodeURIComponent(platform)}&ver=${encodeURIComponent(extensionVersion)}`;
	const isWindows = platform === 'win32';
	const exeName = isWindows ? 'CodeVROOM-setup.exe' : 'CodeVROOM-setup';
	const destPath = path.join(os.tmpdir(), exeName);

	log.log(`CodeVROOM download URL: ${url}`);

	const installSucceeded = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Downloading CodeVROOM',
			cancellable: false
		},
		async progress => {
			progress.report({ increment: 0 });
			try {
				await downloadFile(url, destPath, log, progress);
			} catch (e) {
				log.logException(e);
				return false;
			}

			log.log('Download complete, running installer...');
			progress.report({ message: 'Installing...', increment: 100 });

			if (!isWindows) {
				try {
					fs.chmodSync(destPath, 0o755);
				} catch (e) {
					log.logException(e);
				}
			}

			let exitCode: number;
			try {
				exitCode = await runProcessAndWait(destPath, ['--vscodeinstall'], log);
			} catch (e) {
				log.logException(e);
				return false;
			} finally {
				try {
					fs.unlinkSync(destPath);
				} catch (e) {
					log.logException(e);
				}
			}

			log.log(`Installer exited with code ${exitCode}`);
			return exitCode === 0;
		}
	);

	if (!installSucceeded) {
		showErrorWithOutputChannel('Failed to install CodeVROOM');
		return undefined;
	}

	return findCodeVROOM(log);
}