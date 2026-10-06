// B-DROPS-125: a coach attaching a PDF or video picks or uploads it in the form.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));
const mockPick = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockPick(...a),
}));
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MediaAssetPicker = require('../screens/coach/payments/contents/MediaAssetPicker').default;

async function renderPicker(kind: 'pdf' | 'video', onSelect = jest.fn(), title = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = await render(
    <QueryClientProvider client={qc}>
      <MediaAssetPicker kind={kind} selectedId="" title={title} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { ...utils, onSelect };
}

const PDF_FILE = { uri: 'file:///cache/plan.pdf', name: 'Meal guide.pdf', mimeType: 'application/pdf', size: 1000 };

async function uploadPdf(file: object = PDF_FILE) {
  mockGet.mockResolvedValue({ data: { media: [] } });
  mockPick.mockResolvedValue({ canceled: false, assets: [file] });
  const ui = await renderPicker('pdf');
  await ui.findByText('No PDF files ready yet. Upload one below.');
  await fireEvent.press(ui.getByTestId('media-upload-pdf'));
  return ui;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MediaAssetPicker (coach attaches a PDF or video)', () => {
  it('lists only ready files of that kind and selects one', async () => {
    mockGet.mockResolvedValue({
      data: {
        media: [
          { id: 'm1', kind: 'pdf', title: 'Starter guide', status: 'ready' },
          { id: 'm2', kind: 'pdf', title: 'Half done', status: 'uploading' },
        ],
      },
    });
    const { findByText, queryByText, onSelect } = await renderPicker('pdf');
    await fireEvent.press(await findByText('Starter guide'));
    expect(onSelect).toHaveBeenCalledWith('m1', 'Starter guide');
    expect(queryByText('Half done')).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('/v1/coach/media', { params: { kind: 'pdf' } });
  });

  it('uploads a PDF: ticket, binary PUT, confirm, then selects it', async () => {
    mockPost.mockResolvedValueOnce({ data: { media_asset_id: 'new-1', upload_url: 'https://storage.example/up' } });
    mockPost.mockResolvedValueOnce({ data: { id: 'new-1', status: 'ready' } });
    mockUpload.mockResolvedValue({ status: 200 });
    const { findByText, onSelect } = await uploadPdf();
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new-1', 'Meal guide'));
    expect(mockPost.mock.calls[0]).toEqual([
      '/v1/coach/media/pdf/upload-url',
      { title: 'Meal guide', content_type: 'application/pdf' },
    ]);
    expect(mockUpload).toHaveBeenCalledWith(
      'https://storage.example/up',
      PDF_FILE.uri,
      expect.objectContaining({ httpMethod: 'PUT', headers: { 'Content-Type': 'application/pdf' } }),
    );
    expect(mockPost.mock.calls[1]).toEqual(['/v1/coach/media/new-1/pdf/confirm', {}]);
    await findByText('Uploaded and selected.');
  });

  it('a failed transfer does not confirm or select, and says why', async () => {
    mockPost.mockResolvedValueOnce({ data: { media_asset_id: 'new-2', upload_url: 'https://storage.example/up' } });
    mockUpload.mockResolvedValue({ status: 500 });
    const { findByText, onSelect } = await uploadPdf();
    await findByText('The upload did not finish. Check the connection and try again.');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('refuses a PDF over 50 MB before asking for an upload URL', async () => {
    const { findByText } = await uploadPdf({ ...PDF_FILE, size: 60 * 1024 * 1024 });
    await findByText('PDFs can be up to 50 MB.');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a video upload goes to Mux and waits for processing instead of selecting', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { media: [] } })
      .mockResolvedValue({ data: { media: [{ id: 'v1', kind: 'video', title: 'Form check', status: 'processing' }] } });
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///v.mov', name: 'Form check.mov', mimeType: 'video/quicktime' }] });
    mockPost.mockResolvedValueOnce({ data: { media_asset_id: 'v1', upload_url: 'https://mux.example/up' } });
    mockUpload.mockResolvedValue({ status: 200 });
    const { findByText, getByTestId, onSelect } = await renderPicker('video');
    await findByText('No video files ready yet. Upload one below.');
    await fireEvent.press(getByTestId('media-upload-video'));
    await findByText('Processing: Form check');
    expect(mockPost.mock.calls[0]).toEqual(['/v1/coach/media/video/upload-url', { title: 'Form check' }]);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a specific message when uploads are unavailable (503)', async () => {
    mockPost.mockRejectedValueOnce({ response: { status: 503, data: { error: 'MEDIA_STORAGE_NOT_CONFIGURED' } } });
    const { findByText } = await uploadPdf();
    await findByText('Uploads are unavailable right now. Try again in a few minutes.');
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('ContentAttachForm wires the picker for PDF and video', () => {
  it('choosing PDF shows the media picker, not only a paste field', async () => {
    mockGet.mockResolvedValue({ data: { media: [{ id: 'm1', kind: 'pdf', title: 'Starter guide', status: 'ready' }] } });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ContentAttachForm = require('../screens/coach/payments/contents/ContentAttachForm').default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const onSubmitAttach = jest.fn();
    const ui = await render(
      <QueryClientProvider client={qc}>
        <ContentAttachForm visible onCancel={jest.fn()} onSubmitAttach={onSubmitAttach} onSubmitPatch={jest.fn()} />
      </QueryClientProvider>,
    );
    await fireEvent.press(ui.getByLabelText('PDF'));
    await fireEvent.press(await ui.findByText('Starter guide'));
    await fireEvent.press(ui.getByTestId('content-attach-submit'));
    expect(onSubmitAttach).toHaveBeenCalledWith(
      expect.objectContaining({ asset_type: 'pdf', asset_id: 'm1', display_title: 'Starter guide' }),
    );
  });
});
