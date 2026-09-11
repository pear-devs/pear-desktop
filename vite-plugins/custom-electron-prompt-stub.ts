const prompt = (_options: unknown, _parentWindow?: unknown): Promise<unknown> => {
	throw new Error(
		'custom-electron-prompt is only available in the main process',
	);
};

export default prompt;