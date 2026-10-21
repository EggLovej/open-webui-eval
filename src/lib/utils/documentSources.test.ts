import { describe, expect, it } from 'vitest';
import { createDocumentPreviewTracker, getDocumentPreview } from './documentSources';

const document = (id: string, name = 'notes.txt') => ({
	type: 'file',
	id,
	name,
	status: 'uploaded'
});

describe('document attachment preview', () => {
	it.each([
		'txt',
		'py',
		'md',
		'json',
		'csv',
		'doc',
		'docx',
		'odt',
		'xls',
		'xlsx',
		'ppt',
		'pptx',
		'msg'
	])('opens .%s documents in the text split-screen viewer', (extension) => {
		expect(getDocumentPreview(document('1', `source.${extension}`))).toMatchObject({
			fileId: '1',
			format: 'text'
		});
	});

	it('uses the page viewer for PDFs', () => {
		expect(getDocumentPreview(document('1', 'source.pdf'))?.format).toBe('pdf');
	});

	it('detects content types on file metadata without relying on an extension', () => {
		expect(
			getDocumentPreview({ ...document('1', 'source'), meta: { content_type: 'application/pdf' } })
				?.format
		).toBe('pdf');
		expect(
			getDocumentPreview({ ...document('2', 'source'), meta: { content_type: 'image/png' } })
		).toBeNull();
	});
});

describe('automatic document preview', () => {
	it('opens completed documents without a citation or highlight request', () => {
		const next = createDocumentPreviewTracker();
		expect(next([document('1')])).toMatchObject({
			fileId: '1',
			format: 'text',
			text: '',
			claim: null
		});
	});

	it('waits for processing to finish, including in-place attachment updates', () => {
		const next = createDocumentPreviewTracker();
		const file = { ...document('1', 'paper.PDF'), status: 'uploading' };
		expect(next([file])).toBeNull();
		file.status = 'uploaded';
		expect(next([file])).toMatchObject({ fileId: '1', format: 'pdf', page: null });
	});

	it('does not reopen a dismissed document when attachments are updated', () => {
		const next = createDocumentPreviewTracker();
		next([document('1')]);
		expect(next([{ ...document('1'), context: 'full' }])).toBeNull();
		expect(next([document('1')])).toBeNull();
		expect(next([])).toBeNull();
	});

	it('opens the newly added document after an earlier preview was dismissed', () => {
		const next = createDocumentPreviewTracker();
		next([document('1')]);
		expect(next([document('1'), document('2', 'main.py')])).toMatchObject({
			fileId: '2',
			format: 'text'
		});
		expect(next([document('1'), document('2', 'main.py')])).toBeNull();
	});

	it('allows removing and reattaching the same document', () => {
		const next = createDocumentPreviewTracker();
		next([document('1')]);
		next([]);
		expect(next([document('1')])?.fileId).toBe('1');
	});

	it('ignores media, failed uploads, web sources, and terminal paths', () => {
		const next = createDocumentPreviewTracker();
		expect(
			next([
				{ ...document('1'), type: 'image' },
				{ ...document('2'), content_type: 'audio/mpeg' },
				document('3', 'clip.mp4'),
				{ ...document('4'), status: 'error', error: 'Failed' },
				{ ...document('5'), type: 'text' },
				{ ...document('/tmp/test.txt'), type: 'filesystem' }
			])
		).toBeNull();
	});

	it('uses stored file metadata for selected library documents', () => {
		const next = createDocumentPreviewTracker();
		expect(
			next([
				{
					type: 'file',
					status: 'processed',
					file: {
						id: '1',
						meta: { name: 'paper', content_type: 'application/pdf' }
					}
				}
			])
		).toMatchObject({ fileId: '1', name: 'paper', format: 'pdf' });
	});
});
