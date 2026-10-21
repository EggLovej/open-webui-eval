import type { SourceViewerState } from '$lib/stores';

const MEDIA_EXTENSION =
	/\.(?:png|jpe?g|gif|webp|svg|heic|avif|bmp|tiff?|mp3|wav|ogg|m4a|flac|mp4|webm|mov|avi)$/i;

export const getDocumentPreview = (file: any): SourceViewerState | null => {
	if (
		file?.type !== 'file' ||
		(file.status && !['uploaded', 'processed'].includes(file.status)) ||
		file.error
	)
		return null;
	const id = file.id ?? file.file?.id;
	const name = file.name ?? file.file?.meta?.name ?? file.file?.filename ?? '';
	const contentType =
		file.content_type ?? file.meta?.content_type ?? file.file?.meta?.content_type ?? '';
	if (!id || /^(image|audio|video)\//i.test(contentType) || MEDIA_EXTENSION.test(name)) return null;
	return {
		fileId: id,
		name,
		format: contentType === 'application/pdf' || /\.pdf$/i.test(name) ? 'pdf' : 'text',
		page: null,
		text: '',
		claim: null,
		model: null,
		chatId: null
	};
};

// Track additions, not panel visibility: dismissing a preview must not reopen it
// when the composer updates or the user sends the attached document.
export const createDocumentPreviewTracker = () => {
	let previous = new Set<string>();
	return (files: any[] = []): SourceViewerState | null => {
		const current = new Set<string>();
		let preview: SourceViewerState | null = null;
		for (const file of files) {
			const document = getDocumentPreview(file);
			if (!document) continue;
			current.add(document.fileId);
			if (!previous.has(document.fileId)) preview = document;
		}
		previous = current;
		return preview;
	};
};
