import * as vscode from 'vscode';

export class LogScope {
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

export let outputChannel: vscode.OutputChannel;

export function initOutputChannel(channel: vscode.OutputChannel): void {
	outputChannel = channel;
}

export function showErrorWithOutputChannel(message: string): void {
	vscode.window.showErrorMessage(message, 'View Diagnostic Output').then(choice => {
		if (choice === 'View Diagnostic Output')
			outputChannel.show();
	});
}