import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { LogScope } from './logScope';

function TryQueryLocationFromRegistry(hive: 'HKEY_CURRENT_USER' | 'HKEY_LOCAL_MACHINE', log: LogScope): string | undefined {
	const regPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\CodeVROOM.exe';
	const fullKey = `${hive}\\${regPath}`;
	log.log(`Trying (registry) ${fullKey}\\Path`);
	try {
		const output = child_process.execSync(`reg query "${fullKey}" /v Path`, { encoding: 'utf8' });
		const match = /Path\s+REG_SZ\s+(.+)/.exec(output);
		if (match) {
			const fullPath = match[1].trim();
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

function findCodeVROOMWindows(log: LogScope): string | undefined {
	const fromHKCU = TryQueryLocationFromRegistry('HKEY_CURRENT_USER', log);
	if (fromHKCU)
		return fromHKCU;

	const fromHKLM = TryQueryLocationFromRegistry('HKEY_LOCAL_MACHINE', log);
	if (fromHKLM)
		return fromHKLM;

	return undefined;
}

function findCodeVROOMMac(log: LogScope): string | undefined {
	return undefined;
}

function findCodeVROOMLinux(log: LogScope): string | undefined {
	const versionFilePath = path.join(os.homedir(), '.codevroom', 'bin', 'version.txt');
	log.log(`Loading ${versionFilePath}...`);
	try {
		const contents = fs.readFileSync(versionFilePath, 'utf8');
		const match = /^main=([0-9.]+)$/m.exec(contents);
		if (!match) {
			log.log(`Could not parse version from ${versionFilePath}`);
			return undefined;
		}
		const version = match[1];
		const binaryPath = path.join(os.homedir(), '.codevroom', 'bin', version, 'SysprogsAIWorkbench');
		log.log(`Trying ${binaryPath}...`);
		try {
			fs.accessSync(binaryPath, fs.constants.X_OK);
			return binaryPath;
		} catch (e) {
			log.logException(e);
		}
	} catch (e) {
		log.logException(e);
	}
	return undefined;
}

export function findCodeVROOM(log: LogScope): string | undefined {
	log.log('Locating CodeVROOM executable...');

	let result: string | undefined;
	if (process.platform === 'win32')
		result = findCodeVROOMWindows(log);
	else if (process.platform === 'darwin')
		result = findCodeVROOMMac(log);
	else if (process.platform === 'linux')
		result = findCodeVROOMLinux(log);

	if (result)
		log.log(`Found ${result}`);

	return result;
}