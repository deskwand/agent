import { describe, expect, it } from 'vitest';
import {
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
  toFileUrl,
} from '../src/shared/local-file-path';

describe('localPathFromFileUrl', () => {
  it('preserves Windows drive file URLs', () => {
    expect(localPathFromFileUrl('file:///C:/Users/demo/report.docx')).toBe(
      'C:/Users/demo/report.docx'
    );
  });

  it('restores UNC hosts for Windows network share URLs on win32', () => {
    expect(localPathFromFileUrl('file://server/share/demo.txt', 'win32')).toBe(
      '\\\\server\\share\\demo.txt'
    );
  });

  it('returns forward-slash network path on non-Windows for UNC URLs', () => {
    expect(localPathFromFileUrl('file://server/share/demo.txt', 'darwin')).toBe(
      '//server/share/demo.txt'
    );
    expect(localPathFromFileUrl('file://server/share/demo.txt', 'linux')).toBe(
      '//server/share/demo.txt'
    );
  });

  it('treats file://localhost URLs as local files instead of UNC paths', () => {
    expect(localPathFromFileUrl('file://localhost/Users/demo/report.docx')).toBe(
      '/Users/demo/report.docx'
    );
  });

  it('returns null for empty or non-file URLs', () => {
    expect(localPathFromFileUrl('')).toBeNull();
    expect(localPathFromFileUrl('https://example.com')).toBeNull();
  });

  it('handles percent-encoded characters', () => {
    expect(localPathFromFileUrl('file:///home/user/my%20file.txt')).toBe(
      '/home/user/my file.txt'
    );
  });
});

describe('localPathFromAppUrlPathname', () => {
  it('keeps Windows drive pathnames local', () => {
    expect(localPathFromAppUrlPathname('/C:/Users/demo/report.docx')).toBe(
      'C:/Users/demo/report.docx'
    );
  });

  it('converts UNC-style pathnames to backslash on win32', () => {
    expect(localPathFromAppUrlPathname('//server/share/demo.txt', 'win32')).toBe(
      '\\\\server\\share\\demo.txt'
    );
  });

  it('keeps UNC-style pathnames as forward-slash on non-Windows', () => {
    expect(localPathFromAppUrlPathname('//server/share/demo.txt', 'darwin')).toBe(
      '//server/share/demo.txt'
    );
    expect(localPathFromAppUrlPathname('//server/share/demo.txt', 'linux')).toBe(
      '//server/share/demo.txt'
    );
  });

  it('allows additional absolute POSIX roots used by mounted workspaces', () => {
    expect(localPathFromAppUrlPathname('/mnt/c/work/demo.txt')).toBe('/mnt/c/work/demo.txt');
    expect(localPathFromAppUrlPathname('/Volumes/Data/demo.txt')).toBe('/Volumes/Data/demo.txt');
  });

  it('returns null for empty or unrecognized pathnames', () => {
    expect(localPathFromAppUrlPathname('')).toBeNull();
    expect(localPathFromAppUrlPathname('/random/unknown')).toBeNull();
  });
});

describe('toFileUrl', () => {
  it('builds POSIX file URLs with encoded spaces and non-ASCII', () => {
    expect(toFileUrl('/Users/a/my page.html')).toBe(
      'file:///Users/a/my%20page.html'
    );
    expect(toFileUrl('/Users/a/中文.html')).toBe(
      'file:///Users/a/%E4%B8%AD%E6%96%87.html'
    );
  });

  it('encodes characters that would otherwise change the URL', () => {
    expect(toFileUrl('/Users/a/report#1.pdf')).toBe(
      'file:///Users/a/report%231.pdf'
    );
    expect(toFileUrl('/Users/a/what?.pdf')).toBe(
      'file:///Users/a/what%3F.pdf'
    );
  });

  it('encodes percent signs so they are not read as escapes', () => {
    expect(toFileUrl('/Users/a/100%.pdf')).toBe('file:///Users/a/100%25.pdf');
  });

  it('keeps the drive colon on Windows paths', () => {
    expect(toFileUrl('C:\\Users\\a\\b.html')).toBe('file:///C:/Users/a/b.html');
  });

  it('builds UNC URLs with the host preserved', () => {
    expect(toFileUrl('\\\\server\\share\\a.html')).toBe(
      'file://server/share/a.html'
    );
  });

  it('strips line breaks and surrounding whitespace', () => {
    expect(toFileUrl('\n/Users/a/b.html\n')).toBe('file:///Users/a/b.html');
  });

  it('returns null for web-like or empty input', () => {
    expect(toFileUrl('https://example.com/a.html')).toBeNull();
    expect(toFileUrl('file:///already/a.html')).toBeNull();
    expect(toFileUrl('#anchor')).toBeNull();
    expect(toFileUrl('')).toBeNull();
  });
});
