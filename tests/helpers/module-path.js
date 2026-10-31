// Bundler module IDs and generated imports need forward slashes, including
// when fixtures are built on Windows. Keep native paths for filesystem APIs.
export const modulePath = (filePath) => filePath.replaceAll('\\', '/');
