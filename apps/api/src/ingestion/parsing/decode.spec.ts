import { decodeUtf8 } from './decode';

describe('decodeUtf8', () => {
  it('decodes UTF-8 text', () => {
    expect(decodeUtf8(Buffer.from('héllo — order', 'utf8'))).toBe('héllo — order');
  });

  it('strips a leading BOM', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}', 'utf8')]);
    expect(decodeUtf8(buffer)).toBe('{}');
  });

  it('throws on invalid UTF-8', () => {
    expect(() => decodeUtf8(Buffer.from([0xff, 0xfe, 0x00]))).toThrow();
  });
});
