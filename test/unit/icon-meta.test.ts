import { describe, it, expect, vi } from 'vitest'
import {
  sanitizeSegment,
  sanitizeFilename,
  toPascalCase,
  toKebabCase,
  deriveCollectionName,
  deriveTypeName,
  deriveSpriteComponentName,
  buildIconMeta,
  isValidComponentPrefix,
  resolveComponentPrefix,
} from '../../src/utils/icon-meta'

describe('sanitizeSegment', () => {
  it('lowercases the segment', () => {
    expect(sanitizeSegment('Admin')).toBe('admin')
  })
  it('replaces underscores with hyphens', () => {
    expect(sanitizeSegment('my_folder')).toBe('my-folder')
  })
  it('replaces spaces with hyphens', () => {
    expect(sanitizeSegment('admin buttons')).toBe('admin-buttons')
  })
  it('collapses consecutive special chars to one hyphen', () => {
    expect(sanitizeSegment('a__b  c')).toBe('a-b-c')
  })
  it('trims leading and trailing hyphens', () => {
    expect(sanitizeSegment('--admin--')).toBe('admin')
  })
  it('returns empty string for all-special input', () => {
    expect(sanitizeSegment('@@@')).toBe('')
    expect(sanitizeSegment('___')).toBe('')
  })
  it('passes through already clean segments', () => {
    expect(sanitizeSegment('admin')).toBe('admin')
    expect(sanitizeSegment('admin-buttons')).toBe('admin-buttons')
  })
})

describe('sanitizeFilename', () => {
  it('strips .svg and lowercases', () => {
    expect(sanitizeFilename('My Icon.svg')).toBe('my-icon')
  })
  it('replaces @ with hyphen', () => {
    expect(sanitizeFilename('icon@2x.svg')).toBe('icon-2x')
  })
  it('collapses consecutive hyphens', () => {
    expect(sanitizeFilename('arrow--right.svg')).toBe('arrow-right')
  })
  it('trims leading and trailing hyphens', () => {
    expect(sanitizeFilename('-icon-.svg')).toBe('icon')
  })
  it('passes through clean hyphenated names', () => {
    expect(sanitizeFilename('arrow-right.svg')).toBe('arrow-right')
  })
  it('passes through clean simple names', () => {
    expect(sanitizeFilename('home.svg')).toBe('home')
  })
  it('works without .svg extension', () => {
    expect(sanitizeFilename('home')).toBe('home')
  })
})

describe('toPascalCase', () => {
  it('capitalizes a single word', () => {
    expect(toPascalCase('home')).toBe('Home')
  })
  it('capitalizes hyphen-separated words', () => {
    expect(toPascalCase('admin-star')).toBe('AdminStar')
  })
  it('capitalizes three segments', () => {
    expect(toPascalCase('admin-buttons-close')).toBe('AdminButtonsClose')
  })
  it('capitalizes first letter of camelCase (no hyphens)', () => {
    expect(toPascalCase('adminButtons')).toBe('AdminButtons')
  })
  it('handles single-letter segments', () => {
    expect(toPascalCase('a-b')).toBe('AB')
  })
})

describe('toKebabCase (byte-for-byte Vue\'s own hyphenate)', () => {
  it('UseHome -> use-home', () => {
    expect(toKebabCase('UseHome')).toBe('use-home')
  })
  it('UseAdminStar -> use-admin-star', () => {
    expect(toKebabCase('UseAdminStar')).toBe('use-admin-star')
  })
  it('IconHome -> icon-home', () => {
    expect(toKebabCase('IconHome')).toBe('icon-home')
  })
  it('a digit does not force a hyphen split: Use24Hour -> use24-hour', () => {
    expect(toKebabCase('Use24Hour')).toBe('use24-hour')
  })
  it('a leading underscore is preserved: _2faIcon -> _2fa-icon', () => {
    expect(toKebabCase('_2faIcon')).toBe('_2fa-icon')
  })
  it('empty string stays empty', () => {
    expect(toKebabCase('')).toBe('')
  })
})

describe('deriveCollectionName', () => {
  it('returns "default" for empty segments', () => {
    expect(deriveCollectionName([])).toBe('default')
  })
  it('returns segment as-is for a single simple segment', () => {
    expect(deriveCollectionName(['admin'])).toBe('admin')
  })
  it('camelCases two segments', () => {
    expect(deriveCollectionName(['admin', 'buttons'])).toBe('adminButtons')
  })
  it('camelCases a hyphenated segment', () => {
    expect(deriveCollectionName(['admin-icons'])).toBe('adminIcons')
  })
  it('camelCases two segments where second is hyphenated', () => {
    expect(deriveCollectionName(['ui', 'btn-group'])).toBe('uiBtnGroup')
  })
})

describe('deriveTypeName', () => {
  it('default → DefaultIconName', () => {
    expect(deriveTypeName('default')).toBe('DefaultIconName')
  })
  it('admin → AdminIconName', () => {
    expect(deriveTypeName('admin')).toBe('AdminIconName')
  })
  it('adminButtons → AdminButtonsIconName', () => {
    expect(deriveTypeName('adminButtons')).toBe('AdminButtonsIconName')
  })
  it('a collection name starting with a digit gets an underscore prefix (valid TS identifier)', () => {
    expect(deriveTypeName('2fa')).toBe('_2faIconName')
  })
})

describe('deriveSpriteComponentName', () => {
  it('default → DefaultSprite', () => {
    expect(deriveSpriteComponentName('default')).toBe('DefaultSprite')
  })
  it('admin → AdminSprite', () => {
    expect(deriveSpriteComponentName('admin')).toBe('AdminSprite')
  })
  it('adminButtons → AdminButtonsSprite', () => {
    expect(deriveSpriteComponentName('adminButtons')).toBe('AdminButtonsSprite')
  })
  it('a collection name starting with a digit gets an underscore prefix (valid component name)', () => {
    expect(deriveSpriteComponentName('2fa')).toBe('_2faSprite')
  })
})

describe('buildIconMeta', () => {
  it('default collection: flat file', () => {
    const meta = buildIconMeta('home.svg', [], '/abs/home.svg', 'Use')
    expect(meta).toEqual({ id: 'home', componentName: 'UseHome', absolutePath: '/abs/home.svg' })
  })

  it('named collection: one level', () => {
    const meta = buildIconMeta('star.svg', ['admin'], '/abs/admin/star.svg', 'Use')
    expect(meta).toEqual({ id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/abs/admin/star.svg' })
  })

  it('named collection: two levels', () => {
    const meta = buildIconMeta('close.svg', ['admin', 'buttons'], '/abs/admin/buttons/close.svg', 'Use')
    expect(meta).toEqual({
      id: 'admin-buttons-close',
      componentName: 'UseAdminButtonsClose',
      absolutePath: '/abs/admin/buttons/close.svg',
    })
  })

  it('hyphenated filename in named collection', () => {
    const meta = buildIconMeta('arrow-right.svg', ['admin'], '/abs/admin/arrow-right.svg', 'Use')
    expect(meta).toEqual({
      id: 'admin-arrow-right',
      componentName: 'UseAdminArrowRight',
      absolutePath: '/abs/admin/arrow-right.svg',
    })
  })

  it('hyphenated folder segment', () => {
    const meta = buildIconMeta('star.svg', ['admin-icons'], '/abs/admin-icons/star.svg', 'Use')
    expect(meta).toEqual({
      id: 'admin-icons-star',
      componentName: 'UseAdminIconsStar',
      absolutePath: '/abs/admin-icons/star.svg',
    })
  })

  it('filename sanitization: spaces become hyphens', () => {
    const meta = buildIconMeta('My Icon.svg', [], '/abs/My Icon.svg', 'Use')
    expect(meta).toEqual({ id: 'my-icon', componentName: 'UseMyIcon', absolutePath: '/abs/My Icon.svg' })
  })

  it('absolutePath is passed through unchanged', () => {
    const absPath = '/some/deep/path/with spaces/icon.svg'
    const meta = buildIconMeta('icon.svg', [], absPath, 'Use')
    expect(meta.absolutePath).toBe(absPath)
  })

  it('custom component prefix', () => {
    const meta = buildIconMeta('star.svg', ['admin'], '/abs/admin/star.svg', 'Icon')
    expect(meta.componentName).toBe('IconAdminStar')
  })

  it('.raw.svg: sets raw=true and strips .raw from id', () => {
    const meta = buildIconMeta('home.raw.svg', [], '/abs/home.raw.svg', 'Use')
    expect(meta.id).toBe('home')
    expect(meta.componentName).toBe('UseHome')
    expect(meta.raw).toBe(true)
  })

  it('.raw.svg in named collection: id prefix is unchanged', () => {
    const meta = buildIconMeta('star.raw.svg', ['admin'], '/abs/admin/star.raw.svg', 'Use')
    expect(meta.id).toBe('admin-star')
    expect(meta.raw).toBe(true)
  })

  it('regular .svg has raw=undefined', () => {
    const meta = buildIconMeta('home.svg', [], '/abs/home.svg', 'Use')
    expect(meta.raw).toBeUndefined()
  })

  it('uppercase .SVG extension is recognized the same as .svg', () => {
    const meta = buildIconMeta('HOME.SVG', [], '/abs/HOME.SVG', 'Use')
    expect(meta.id).toBe('home')
    expect(meta.componentName).toBe('UseHome')
  })

  it('uppercase .RAW.SVG extension is recognized as raw', () => {
    const meta = buildIconMeta('Home.RAW.SVG', [], '/abs/Home.RAW.SVG', 'Use')
    expect(meta.id).toBe('home')
    expect(meta.raw).toBe(true)
  })
})

// ── componentPrefix validation ───────────────────────────────────────────────────

describe('isValidComponentPrefix', () => {
  it('accepts the default and plausible PascalCase prefixes', () => {
    expect(isValidComponentPrefix('Use')).toBe(true)
    expect(isValidComponentPrefix('Icon')).toBe(true)
  })
  it('accepts an empty prefix — a deliberately supported, already-safe value', () => {
    expect(isValidComponentPrefix('')).toBe(true)
  })
  it('accepts identifier-part characters: underscore, dollar sign, digits (anywhere, not just leading)', () => {
    expect(isValidComponentPrefix('_x')).toBe(true)
    expect(isValidComponentPrefix('$x')).toBe(true)
    expect(isValidComponentPrefix('Use2')).toBe(true)
  })
  it('accepts a leading digit — ensureValidIdentifierStart already repairs the COMBINED name one layer down', () => {
    expect(isValidComponentPrefix('2Icon')).toBe(true)
  })
  it('rejects a hyphen — the exact "icon-" case that used to produce a broken generated file', () => {
    expect(isValidComponentPrefix('icon-')).toBe(false)
  })
  it('rejects a space', () => {
    expect(isValidComponentPrefix('My Icon')).toBe(false)
    expect(isValidComponentPrefix('a b')).toBe(false)
  })
  it('rejects a period', () => {
    expect(isValidComponentPrefix('icon.')).toBe(false)
  })
  it('rejects a trailing hyphen on an otherwise-valid prefix', () => {
    expect(isValidComponentPrefix('Use-')).toBe(false)
  })
  it('rejects a newline', () => {
    expect(isValidComponentPrefix('ic\n')).toBe(false)
  })
})

describe('resolveComponentPrefix', () => {
  it('returns an invalid prefix\'s fallback ("Use") and warns, naming the value and the fallback', () => {
    const logger = { warn: vi.fn() }
    expect(resolveComponentPrefix('icon-', logger)).toBe('Use')
    expect(logger.warn).toHaveBeenCalledOnce()
    const [message] = logger.warn.mock.calls[0]!
    expect(message).toContain('icon-')
    expect(message).toContain('Use')
  })

  it('returns a valid prefix unchanged and does not warn', () => {
    const logger = { warn: vi.fn() }
    expect(resolveComponentPrefix('Icon', logger)).toBe('Icon')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns an empty prefix unchanged and does not warn — locks in the deliberate empty-prefix allowance', () => {
    const logger = { warn: vi.fn() }
    expect(resolveComponentPrefix('', logger)).toBe('')
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
